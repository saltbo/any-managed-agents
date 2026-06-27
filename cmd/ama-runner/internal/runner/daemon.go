package runner

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/controlplane"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/hostruntime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/layout"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runtimeworkspace "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ControlPlane interface {
	CheckHealth(ctx context.Context) (*ama.Health, error)
	CreateRunner(ctx context.Context, body ama.CreateRunnerRequest) (*ama.Runner, error)
	PutRunnerHeartbeat(ctx context.Context, runnerID string, body controlplane.PutRunnerHeartbeatRequest) error
	ListAvailableWorkItems(ctx context.Context) ([]controlplane.WorkItem, error)
	ReadWorkItem(ctx context.Context, workItemID string) (*controlplane.WorkItem, error)
	CreateLease(ctx context.Context, body controlplane.CreateLeaseRequest) (*controlplane.Lease, error)
	UpdateLease(ctx context.Context, leaseID string, body controlplane.UpdateLeaseRequest) (*controlplane.Lease, error)
	CreateSessionEvents(ctx context.Context, sessionID string, events []controlplane.SessionEvent) error
}

type RunnerSessionChannel interface {
	ReadJSON(ctx context.Context, out any) error
	WriteJSON(ctx context.Context, value any) error
	Close(statusCode int, reason string) error
}

type RunnerDaemon struct {
	Config         runnerconfig.Config
	Client         ControlPlane
	Channels       RunnerChannelOpener
	Adapter        sandbox.SandboxAdapter
	RuntimeAdapter hostruntime.Adapter
	HostRuntime    hostruntime.Service
	Workspace      runtimeworkspace.Manager
	// relayHub owns the runner's single per-runner relay channel for all sessions
	// (claude-code/codex/copilot). Started once the runner id is known and kept
	// open for the runner's lifetime; nil until Start wires it.
	relayHub *relayHub
	// LookPath resolves runtime CLI binaries on PATH; defaults to exec.LookPath.
	LookPath func(string) (string, error)
	// DetectRuntime probes the host CLI for a runtime: enumerated model ids
	// plus availability status, version, and safe diagnostic detail.
	DetectRuntime          func(ctx context.Context, runtimeName string) hostruntime.Probe
	RunnerID               string
	mu                     sync.Mutex
	activeLeases           int
	usageMu                sync.Mutex
	runtimeUsage           []ama.RuntimeUsage
	runtimeUsageLimits     map[string]string
	capabilityMu           sync.Mutex
	advertisedCapabilities []string
	advertisedInventory    []controlplane.RuntimeInventory
	probeMu                sync.Mutex
	runtimeProbes          map[string]hostruntime.Probe
}

func (d *RunnerDaemon) lookPath() func(string) (string, error) {
	if d.LookPath != nil {
		return d.LookPath
	}
	return exec.LookPath
}

func (d *RunnerDaemon) hostRuntime() hostruntime.Service {
	service := d.HostRuntime
	if service.CommandTimeout == 0 {
		service.CommandTimeout = d.Config.CommandTimeout
	}
	if service.ShutdownGraceInterval == 0 {
		service.ShutdownGraceInterval = d.Config.ShutdownGraceInterval
	}
	return service
}

func (d *RunnerDaemon) workspaceManager() runtimeworkspace.Manager {
	return d.Workspace
}

func (d *RunnerDaemon) Start(ctx context.Context) error {
	if err := os.MkdirAll(d.Config.WorkDir, 0o755); err != nil {
		return err
	}
	if err := d.workspaceManager().CleanupStaleRuntime(ctx, d.Config.WorkDir, runtimeworkspace.RuntimeRetention); err != nil {
		return err
	}
	if _, err := d.Client.CheckHealth(ctx); err != nil {
		return err
	}
	if err := d.ensureRunnerID(ctx); err != nil {
		return err
	}
	if err := d.heartbeatOrRecover(ctx); err != nil {
		return err
	}
	// One-time readiness line so `ak logs` shows the runner came up and is
	// connected/polling even when it is idle (no work in the queue). List the
	// detected runtime names only — not the full capability-token matrix
	// (runtime×provider×model), which is internal scheduling data.
	runtimeNames := make([]string, 0)
	for _, r := range d.currentRuntimeInventory() {
		runtimeNames = append(runtimeNames, r.Runtime)
	}
	slog.Info("runner ready; polling for work",
		"runnerId", d.RunnerID,
		"projectId", d.Config.ProjectID,
		"environmentId", d.Config.EnvironmentID,
		"runtimes", strings.Join(runtimeNames, ", "),
		"maxConcurrent", d.Config.MaxConcurrent,
		"pollInterval", d.Config.PollInterval.String(),
	)
	go d.runUsageCollector(ctx)
	// Open the per-runner relay channel for CLI sessions and keep it for the
	// runner's lifetime (reconnecting on drop), so a completed CLI session still
	// streams its history over the relay while the runner is online.
	d.startRelayHub(ctx)

	heartbeatTicker := time.NewTicker(d.Config.HeartbeatInterval)
	defer heartbeatTicker.Stop()
	pollTimer := time.NewTimer(0)
	defer pollTimer.Stop()
	heartbeatFailures := 0
	// Approximate consecutive-failure count: lease goroutines run while the
	// poll timer is being reset, so the backoff may briefly lag the true
	// count. That is fine — the backoff only needs to stop a broken control
	// plane from being hammered at full poll speed.
	var leaseFailures atomic.Int64
	var inFlight sync.WaitGroup
	for {
		select {
		case <-ctx.Done():
			// Wait for in-flight lease goroutines so their interrupted/failed
			// finalization reaches the control plane before the process exits;
			// otherwise recovery silently degrades to lease-expiry timing.
			d.drainInFlightLeases(&inFlight)
			_ = d.sendOfflineHeartbeat(context.Background())
			return ctx.Err()
		case <-heartbeatTicker.C:
			if err := d.heartbeat(ctx); err != nil {
				// The control plane forgot this runner (reaped or data reset):
				// re-register under a fresh id instead of heartbeating a ghost.
				if controlplane.IsRunnerGoneError(err) {
					slog.Warn("runner registration was lost; re-registering", "error", err)
					if recoverErr := d.recoverRunnerIdentity(ctx); recoverErr != nil {
						heartbeatFailures++
						slog.Warn("runner re-registration failed", "consecutiveFailures", heartbeatFailures, "error", recoverErr)
						if heartbeatFailures >= heartbeatMaxConsecutiveFailures {
							d.drainInFlightLeases(&inFlight)
							return fmt.Errorf("runner re-registration failed %d consecutive times: %w", heartbeatFailures, recoverErr)
						}
						continue
					}
					heartbeatFailures = 0
					continue
				}
				// A transient network blip must not take the runner offline and
				// interrupt every running session; give up only when the control
				// plane stays unreachable across many consecutive intervals.
				heartbeatFailures++
				slog.Warn("runner heartbeat failed", "consecutiveFailures", heartbeatFailures, "error", err)
				if heartbeatFailures >= heartbeatMaxConsecutiveFailures {
					d.drainInFlightLeases(&inFlight)
					return fmt.Errorf("runner heartbeat failed %d consecutive times: %w", heartbeatFailures, err)
				}
				continue
			}
			heartbeatFailures = 0
		case <-pollTimer.C:
			for d.tryAcquireLeaseSlot() {
				inFlight.Add(1)
				go func() {
					defer inFlight.Done()
					defer d.releaseLeaseSlot()
					err := d.runOneLease(ctx)
					if err == nil {
						leaseFailures.Store(0)
						return
					}
					// Shutdown cancellation is handled by the ctx.Done() drain
					// path, which sends the offline heartbeat once.
					if ctx.Err() != nil {
						return
					}
					if isLeaseInactive(err) {
						// A lease that is no longer active is normal: the session
						// finished or another runner took over. Not a failure to
						// back off on, and not WARN-worthy.
						leaseFailures.Store(0)
						slog.Info("runner lease ended", "error", err)
					} else {
						leaseFailures.Add(1)
						slog.Warn("runner lease failed", "consecutiveFailures", leaseFailures.Load(), "error", err)
					}
				}()
			}
			pollTimer.Reset(leasePollDelay(d.Config.PollInterval, leaseFailures.Load()))
		}
	}
}

const (
	// 10 × HeartbeatInterval (default 30s) ≈ 5 minutes of control-plane
	// unreachability before the runner gives up and exits.
	heartbeatMaxConsecutiveFailures = 10
	leaseClaimBackoffCap            = time.Minute
	leaseClaimBackoffMaxShift       = 6
)

// leasePollDelay backs the lease poll off exponentially while claims keep
// failing, so a broken control plane is not hammered at full poll speed.
func leasePollDelay(base time.Duration, consecutiveFailures int64) time.Duration {
	if consecutiveFailures <= 0 {
		return base
	}
	shift := consecutiveFailures
	if shift > leaseClaimBackoffMaxShift {
		shift = leaseClaimBackoffMaxShift
	}
	delay := base << shift
	if delay <= 0 || delay > leaseClaimBackoffCap {
		return leaseClaimBackoffCap
	}
	return delay
}

func (d *RunnerDaemon) drainInFlightLeases(inFlight *sync.WaitGroup) {
	done := make(chan struct{})
	go func() {
		inFlight.Wait()
		close(done)
	}()
	// The runtime gets ShutdownGraceInterval to exit after SIGTERM; allow that
	// plus headroom for the interrupted-status upload.
	select {
	case <-done:
	case <-time.After(d.Config.ShutdownGraceInterval + 10*time.Second):
		slog.Warn("shutdown drain timed out; in-flight lease finalization may be lost")
	}
}

func (d *RunnerDaemon) RunOnce(ctx context.Context) error {
	if err := d.ensureRunnerID(ctx); err != nil {
		return err
	}
	if err := d.heartbeatOrRecover(ctx); err != nil {
		return err
	}
	d.startRelayHub(ctx)
	if !d.tryAcquireLeaseSlot() {
		return nil
	}
	defer d.releaseLeaseSlot()
	return d.runOneLease(ctx)
}

// startRelayHub wires the per-runner relay channel once the runner id is known and
// runs it under the daemon context. Idempotent: a second call is a no-op so Start
// and RunOnce can both call it.
func (d *RunnerDaemon) startRelayHub(ctx context.Context) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.relayHub != nil {
		return
	}
	d.relayHub = newRelayHub(d.Channels, d.RunnerID, d.Config.SandboxAdapter, d.Config.WorkDir, d.Adapter)
	go d.relayHub.run(ctx)
}

func (d *RunnerDaemon) runOneLease(ctx context.Context) error {
	lease, workItem, err := d.claimLease(ctx)
	if err != nil || lease == nil {
		return err
	}
	slog.Info("claimed work item", "workItemId", lease.WorkItemID, "sessionId", workItem.SessionID, "leaseId", lease.ID)
	if err := d.executeLease(ctx, lease, workItem); err != nil {
		return err
	}
	slog.Info("work item completed", "workItemId", lease.WorkItemID, "sessionId", workItem.SessionID)
	return nil
}

// claimLease implements the v1 two-step claim: read the available work queue,
// then POST a lease for one item. There is no longer a "no work" 204 — an empty
// queue returns (nil, nil, nil). Claim races (409) and vanished items (404) skip
// to the next candidate so contention does not surface as a runner error.
func (d *RunnerDaemon) claimLease(ctx context.Context) (*controlplane.Lease, *controlplane.WorkItem, error) {
	available, err := d.Client.ListAvailableWorkItems(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, candidate := range available {
		lease, err := d.Client.CreateLease(ctx, controlplane.CreateLeaseRequest{
			WorkItemID:           candidate.ID,
			RunnerID:             d.RunnerID,
			LeaseDurationSeconds: d.Config.LeaseDurationSeconds,
		})
		if err != nil {
			if controlplane.IsClaimRaceError(err) {
				continue
			}
			return nil, nil, err
		}
		// The lease no longer embeds the work item; fetch the payload (with
		// resolved secret env) as the active lease holder.
		workItem, err := d.Client.ReadWorkItem(ctx, lease.WorkItemID)
		if err != nil {
			return nil, nil, err
		}
		return lease, workItem, nil
	}
	return nil, nil, nil
}

func (d *RunnerDaemon) tryAcquireLeaseSlot() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.activeLeases >= d.Config.MaxConcurrent {
		return false
	}
	d.activeLeases += 1
	return true
}

func (d *RunnerDaemon) releaseLeaseSlot() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.activeLeases > 0 {
		d.activeLeases -= 1
	}
}

func (d *RunnerDaemon) activeLoad() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.activeLeases
}

func (d *RunnerDaemon) ensureRunnerID(ctx context.Context) error {
	if d.RunnerID != "" {
		return nil
	}
	storedRunnerID, err := loadStoredRunnerID(d.Config)
	if err != nil {
		return err
	}
	if storedRunnerID != "" {
		d.RunnerID = storedRunnerID
		return nil
	}
	runnerID, err := d.ensureRunner(ctx)
	if err != nil {
		return err
	}
	d.RunnerID = runnerID
	if err := storeRunnerID(d.Config, runnerID); err != nil {
		return err
	}
	return nil
}

// recoverRunnerIdentity forgets the current (stale) runner id — both in memory
// and in the persisted state file — and registers a fresh runner. Called when
// the control plane reports the runner row is gone (404).
func (d *RunnerDaemon) recoverRunnerIdentity(ctx context.Context) error {
	d.RunnerID = ""
	if err := clearStoredRunnerID(d.Config); err != nil {
		return err
	}
	return d.ensureRunnerID(ctx)
}

// heartbeatOrRecover sends a heartbeat and, if the control plane reports the
// runner is gone (404), re-registers once and retries. Used on the startup
// paths where a single heartbeat must succeed before proceeding.
func (d *RunnerDaemon) heartbeatOrRecover(ctx context.Context) error {
	err := d.heartbeat(ctx)
	if err == nil || !controlplane.IsRunnerGoneError(err) {
		return err
	}
	slog.Warn("runner registration was lost; re-registering", "error", err)
	if recoverErr := d.recoverRunnerIdentity(ctx); recoverErr != nil {
		return recoverErr
	}
	return d.heartbeat(ctx)
}

func (d *RunnerDaemon) ensureRunner(ctx context.Context) (string, error) {
	machineID, err := ensureMachineID(d.Config)
	if err != nil {
		return "", err
	}
	runner, err := d.Client.CreateRunner(ctx, ama.CreateRunnerRequest{
		Name:          runnerDisplayName(),
		Capabilities:  d.refreshCapabilities(),
		EnvironmentID: d.Config.EnvironmentID,
		MaxConcurrent: d.Config.MaxConcurrent,
		Metadata: ama.JSON{
			"sandboxAdapter":  d.Config.SandboxAdapter,
			"machineId":       machineID,
			"hostname":        runnerDisplayName(),
			"runnerVersion":   runnerVersion,
			"runnerCommit":    runnerCommit,
			"runnerBuildDate": runnerBuildDate,
		},
	})
	if err != nil {
		return "", err
	}
	return runner.ID, nil
}

func (d *RunnerDaemon) heartbeat(ctx context.Context) error {
	load := d.activeLoad()
	machineID, err := ensureMachineID(d.Config)
	if err != nil {
		return err
	}
	capabilities := d.refreshCapabilities()
	return d.Client.PutRunnerHeartbeat(ctx, d.RunnerID, controlplane.PutRunnerHeartbeatRequest{
		State:            "active",
		Capabilities:     capabilities,
		CurrentLoad:      &load,
		RuntimeUsage:     d.getRuntimeUsage(),
		RuntimeInventory: d.currentRuntimeInventory(),
		Metadata: ama.JSON{
			"sandboxAdapter":  d.Config.SandboxAdapter,
			"machineId":       machineID,
			"hostname":        runnerDisplayName(),
			"runnerVersion":   runnerVersion,
			"runnerCommit":    runnerCommit,
			"runnerBuildDate": runnerBuildDate,
			"unsafe":          true,
		},
	})
}

func (d *RunnerDaemon) sendOfflineHeartbeat(ctx context.Context) error {
	load := 0
	return d.Client.PutRunnerHeartbeat(ctx, d.RunnerID, controlplane.PutRunnerHeartbeatRequest{
		State:       "offline",
		CurrentLoad: &load,
	})
}

const runnerStateFileName = "runner-state.json"

type runnerState struct {
	MachineID string               `json:"machineId"`
	Bindings  []runnerStateBinding `json:"bindings"`
}

type runnerStateBinding struct {
	Key         string `json:"key"`
	Origin      string `json:"apiServer"`
	Project     string `json:"projectId,omitempty"`
	Environment string `json:"environmentId,omitempty"`
	MachineID   string `json:"machineId"`
	Hostname    string `json:"hostname"`
	RunnerID    string `json:"runnerId"`
}

func runnerDisplayName() string {
	hostname, err := os.Hostname()
	if err == nil && strings.TrimSpace(hostname) != "" {
		return hostname
	}
	return "ama-runner"
}

func ensureMachineID(config runnerconfig.Config) (string, error) {
	state, err := loadRunnerState(runnerStatePath(config))
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(state.MachineID) != "" {
		return state.MachineID, nil
	}
	machineID, err := newMachineID()
	if err != nil {
		return "", err
	}
	state.MachineID = machineID
	if err := saveRunnerState(runnerStatePath(config), state); err != nil {
		return "", err
	}
	return machineID, nil
}

func newMachineID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return "machine_" + hex.EncodeToString(bytes[:]), nil
}

func runnerIdentityKey(config runnerconfig.Config, machineID string) string {
	parts := []string{
		strings.TrimRight(config.Origin, "/"),
		config.ProjectID,
		config.EnvironmentID,
		machineID,
	}
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(hash[:])
}

func runnerStatePath(config runnerconfig.Config) string {
	return filepath.Join(config.StateDir, runnerStateFileName)
}

func loadStoredRunnerID(config runnerconfig.Config) (string, error) {
	machineID, err := ensureMachineID(config)
	if err != nil {
		return "", err
	}
	state, err := loadRunnerState(runnerStatePath(config))
	if err != nil {
		return "", err
	}
	key := runnerIdentityKey(config, machineID)
	for _, binding := range state.Bindings {
		if binding.Key == key {
			return binding.RunnerID, nil
		}
	}
	return "", nil
}

func storeRunnerID(config runnerconfig.Config, runnerID string) error {
	if strings.TrimSpace(runnerID) == "" {
		return fmt.Errorf("runner id is required")
	}
	machineID, err := ensureMachineID(config)
	if err != nil {
		return err
	}
	path := runnerStatePath(config)
	state, err := loadRunnerState(path)
	if err != nil {
		return err
	}
	key := runnerIdentityKey(config, machineID)
	state.MachineID = machineID
	binding := runnerStateBinding{
		Key:         key,
		Origin:      strings.TrimRight(config.Origin, "/"),
		Project:     config.ProjectID,
		Environment: config.EnvironmentID,
		MachineID:   machineID,
		Hostname:    runnerDisplayName(),
		RunnerID:    runnerID,
	}
	replaced := false
	for index := range state.Bindings {
		if state.Bindings[index].Key == key {
			state.Bindings[index] = binding
			replaced = true
			break
		}
	}
	if !replaced {
		state.Bindings = append(state.Bindings, binding)
	}
	sort.Slice(state.Bindings, func(left, right int) bool {
		return state.Bindings[left].Key < state.Bindings[right].Key
	})
	return saveRunnerState(path, state)
}

// clearStoredRunnerID drops the persisted binding for the current
// (origin, project, environment, machine) key so the next ensureRunnerID
// registers a fresh runner. Used to recover from a stale runner id.
func clearStoredRunnerID(config runnerconfig.Config) error {
	machineID, err := ensureMachineID(config)
	if err != nil {
		return err
	}
	path := runnerStatePath(config)
	state, err := loadRunnerState(path)
	if err != nil {
		return err
	}
	key := runnerIdentityKey(config, machineID)
	kept := make([]runnerStateBinding, 0, len(state.Bindings))
	for _, binding := range state.Bindings {
		if binding.Key != key {
			kept = append(kept, binding)
		}
	}
	state.Bindings = kept
	return saveRunnerState(path, state)
}

func loadRunnerState(path string) (runnerState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return runnerState{}, nil
		}
		return runnerState{}, err
	}
	var state runnerState
	if err := json.Unmarshal(data, &state); err != nil {
		return runnerState{}, err
	}
	return state, nil
}

func saveRunnerState(path string, state runnerState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

// runtimeFallbackModels pins one known model per runtime. It is used only
// when host model enumeration fails, so the runner degrades to its old
// single-model declaration instead of advertising a runtime with no models.
func runtimeFallbackModels() map[string]string {
	return map[string]string{
		"codex":       "gpt-5.3-codex",
		"claude-code": "claude-sonnet-4-6",
		"copilot":     "copilot-cli",
	}
}

// runnerCapabilities builds the advertised capability strings from the
// runtimes whose CLI binaries were detected on the host and the model ids
// enumerated from each host CLI. The string format is load-bearing: the AK
// server matches on the bare runtime names and on
// "runtime-provider-model:<runtime>:*:<model>" entries.
func runnerCapabilities(availableRuntimes []string, modelsByRuntime map[string][]string) []string {
	capabilities := []string{
		"sandbox.exec",
		"ama-sandbox",
	}
	fallbackModels := runtimeFallbackModels()
	for _, runtimeName := range availableRuntimes {
		fallbackModel, ok := fallbackModels[runtimeName]
		if !ok {
			continue
		}
		models := modelsByRuntime[runtimeName]
		if len(models) == 0 {
			models = []string{fallbackModel}
		}
		capabilities = append(capabilities, runtimeName)
		for _, model := range models {
			capabilities = append(capabilities, "runtime-provider-model:"+runtimeName+":*:"+model)
		}
	}
	return capabilities
}

// refreshCapabilities re-detects which runtime CLIs are installed on the host
// so a CLI installed mid-run is picked up by the next heartbeat. The same pass
// rebuilds the runtime inventory the heartbeat reports.
func (d *RunnerDaemon) refreshCapabilities() []string {
	service := d.hostRuntime()
	available := service.DetectAvailable(d.lookPath())
	probes := d.runtimeProbesFor(available)
	capabilities := runnerCapabilities(available, modelsFromProbes(probes))
	inventory := runnerRuntimeInventory(available, probes)
	d.capabilityMu.Lock()
	changed := !slices.Equal(d.advertisedCapabilities, capabilities)
	d.advertisedCapabilities = capabilities
	d.advertisedInventory = inventory
	d.capabilityMu.Unlock()
	if changed && len(available) == 0 {
		slog.Warn("no runtime CLIs detected on PATH; runner advertises no external runtimes and will receive no runtime work",
			"binaries", []string{"claude", "codex", "copilot"})
	}
	return capabilities
}

// runtimeProbesFor returns the host probe per detected runtime. Probing spawns
// the bridge and can take seconds, so results are cached for the process lifetime.
func (d *RunnerDaemon) runtimeProbesFor(availableRuntimes []string) map[string]hostruntime.Probe {
	detect := d.DetectRuntime
	if detect == nil {
		service := d.hostRuntime()
		detect = service.DetectProbe
	}
	d.probeMu.Lock()
	defer d.probeMu.Unlock()
	if d.runtimeProbes == nil {
		d.runtimeProbes = map[string]hostruntime.Probe{}
	}
	for _, runtimeName := range availableRuntimes {
		if _, cached := d.runtimeProbes[runtimeName]; cached {
			continue
		}
		probe := detect(context.Background(), runtimeName)
		if len(probe.Models) == 0 {
			slog.Warn("host model enumeration failed; advertising the pinned fallback model", "runtime", runtimeName)
		}
		d.runtimeProbes[runtimeName] = probe
	}
	probes := make(map[string]hostruntime.Probe, len(d.runtimeProbes))
	for runtimeName, probe := range d.runtimeProbes {
		probes[runtimeName] = probe
	}
	return probes
}

func modelsFromProbes(probes map[string]hostruntime.Probe) map[string][]string {
	models := make(map[string][]string, len(probes))
	for runtimeName, probe := range probes {
		models[runtimeName] = probe.Models
	}
	return models
}

// runnerRuntimeInventory reports availability for every external runtime the
// runner can host. AMA is intentionally absent: its loop runs in the control
// plane, while this runner advertises the separate ama-sandbox capability.
func runnerRuntimeInventory(availableRuntimes []string, probes map[string]hostruntime.Probe) []controlplane.RuntimeInventory {
	inventory := []controlplane.RuntimeInventory{}
	for _, cli := range hostruntime.CLIs() {
		if !slices.Contains(availableRuntimes, cli.Runtime) {
			inventory = append(inventory, controlplane.RuntimeInventory{
				Runtime: cli.Runtime,
				State:   "missing",
				Detail:  cli.Binary + " CLI not found on PATH",
			})
			continue
		}
		probe := probes[cli.Runtime]
		state := probe.Status
		if state == "" {
			state = "unhealthy"
		}
		detail := probe.Detail
		if detail == "" {
			detail = "host runtime probe returned no diagnostics"
		}
		inventory = append(inventory, controlplane.RuntimeInventory{
			Runtime: cli.Runtime,
			Version: probe.Version,
			State:   state,
			Detail:  detail,
		})
	}
	return inventory
}

func (d *RunnerDaemon) currentCapabilities() []string {
	d.capabilityMu.Lock()
	capabilities := d.advertisedCapabilities
	d.capabilityMu.Unlock()
	if capabilities == nil {
		return d.refreshCapabilities()
	}
	return capabilities
}

func (d *RunnerDaemon) currentRuntimeInventory() []controlplane.RuntimeInventory {
	d.capabilityMu.Lock()
	inventory := append([]controlplane.RuntimeInventory(nil), d.advertisedInventory...)
	d.capabilityMu.Unlock()

	d.usageMu.Lock()
	limits := make(map[string]string, len(d.runtimeUsageLimits))
	for runtime, detail := range d.runtimeUsageLimits {
		limits[runtime] = detail
	}
	d.usageMu.Unlock()

	return runtimeInventoryWithUsageLimits(inventory, limits)
}

const runtimeUsageRefreshInterval = 5 * time.Minute

func (d *RunnerDaemon) setRuntimeUsageSnapshot(snapshot *hostruntime.UsageSnapshot) {
	if snapshot == nil {
		return
	}
	d.usageMu.Lock()
	defer d.usageMu.Unlock()
	d.runtimeUsage = snapshot.Usage
	d.runtimeUsageLimits = snapshot.Limited
}

func (d *RunnerDaemon) getRuntimeUsage() []ama.RuntimeUsage {
	d.usageMu.Lock()
	defer d.usageMu.Unlock()
	return append([]ama.RuntimeUsage(nil), d.runtimeUsage...)
}

func runtimeInventoryWithUsageLimits(inventory []controlplane.RuntimeInventory, limits map[string]string) []controlplane.RuntimeInventory {
	if len(limits) == 0 {
		return inventory
	}
	result := append([]controlplane.RuntimeInventory(nil), inventory...)
	for i, entry := range result {
		if entry.State != "ready" {
			continue
		}
		detail, limited := limits[entry.Runtime]
		if !limited {
			continue
		}
		result[i].State = "limited"
		result[i].Detail = detail
	}
	return result
}

func (d *RunnerDaemon) refreshRuntimeUsage(ctx context.Context) {
	d.setRuntimeUsageSnapshot(d.hostRuntime().CollectUsage(ctx))
}

// runUsageCollector refreshes the cached per-runtime quota windows on a slow
// schedule so each heartbeat can report them without spawning the bridge.
func (d *RunnerDaemon) runUsageCollector(ctx context.Context) {
	d.refreshRuntimeUsage(ctx)
	ticker := time.NewTicker(runtimeUsageRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.refreshRuntimeUsage(ctx)
		}
	}
}

func isCompletedLeaseRenewalRace(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Runner lease is no longer active")
}

// isLeaseInactive matches both "Lease is no longer active" and "Runner lease is
// no longer active" — the normal end-of-session signals where the lease was
// released or taken over, not a failure to alarm on.
func isLeaseInactive(err error) bool {
	return err != nil && strings.Contains(err.Error(), "is no longer active")
}

func cloneJSON(value ama.JSON) ama.JSON {
	cloned := ama.JSON{}
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

func successfulRuntimeResult(result ama.JSON) bool {
	if result == nil {
		return false
	}
	if exitCodeValue(result["exitCode"]) == 0 {
		return true
	}
	if output, ok := result["output"].(map[string]any); ok && exitCodeValue(output["exitCode"]) == 0 {
		return true
	}
	if output, ok := result["output"].(ama.JSON); ok && exitCodeValue(output["exitCode"]) == 0 {
		return true
	}
	return false
}

func exitCodeValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return -1
	}
}

// relayStamp carries a stored event's stable identity upstream so the browser can
// deduplicate live events against relayed backfill.
type relayStamp struct {
	sequence  int64
	id        string
	createdAt string
}

func (d *RunnerDaemon) renewLease(ctx context.Context, lease *controlplane.Lease, cancel context.CancelFunc, errors chan<- error, resumeTokens *resumeTokenBox) {
	ticker := time.NewTicker(d.Config.RenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := d.Client.UpdateLease(ctx, lease.ID, controlplane.UpdateLeaseRequest{
				State:                "active",
				LeaseDurationSeconds: d.Config.LeaseDurationSeconds,
				ResumeToken:          resumeTokens.Get(),
			})
			if err != nil {
				select {
				case errors <- fmt.Errorf("runner lease renewal failed: %w", err):
				default:
				}
				cancel()
				return
			}
		}
	}
}

// uploadEvent reports a runner event for a session. Tool-execution work that is
// not attached to a session has no session events endpoint to target, so the
// upload is skipped rather than failing the work.
func (d *RunnerDaemon) uploadEvent(ctx context.Context, sessionID string, eventType string, payload ama.JSON) error {
	if sessionID == "" {
		return nil
	}
	return d.Client.CreateSessionEvents(ctx, sessionID, []controlplane.SessionEvent{{
		Type:    eventType,
		Payload: payload,
		Metadata: ama.JSON{
			"runnerId": d.RunnerID,
			"executor": d.Config.SandboxAdapter,
		},
	}})
}

func (d *RunnerDaemon) finishFailed(ctx context.Context, lease *controlplane.Lease, failure error, output ama.JSON) error {
	body := controlplane.UpdateLeaseRequest{
		State: "failed",
		Error: ama.JSON{"message": failure.Error()},
	}
	if output != nil {
		body.Result = ama.JSON{"output": output}
	}
	_, err := d.Client.UpdateLease(ctx, lease.ID, body)
	return err
}

// finishInterrupted ends the lease without failing the work item so the server
// keeps the session recoverable.
func (d *RunnerDaemon) finishInterrupted(ctx context.Context, lease *controlplane.Lease, resumeTokens *resumeTokenBox) error {
	_, err := d.Client.UpdateLease(ctx, lease.ID, controlplane.UpdateLeaseRequest{
		State:       "interrupted",
		ResumeToken: resumeTokens.Get(),
	})
	return err
}

func (d *RunnerDaemon) supportsRequiredCapability(required string) bool {
	if required == "" {
		return true
	}
	for _, capability := range d.currentCapabilities() {
		if capability == required {
			return true
		}
	}
	return false
}

func (d *RunnerDaemon) executeLease(ctx context.Context, lease *controlplane.Lease, workItem *controlplane.WorkItem) error {
	payload, err := protocol.ParseWorkPayload(workItem.Payload)
	if err != nil {
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if payload.Type == "session.start" {
		if !d.supportsRequiredCapability(payload.RequiredRunnerCapability) {
			return d.finishFailed(ctx, lease, fmt.Errorf("runner does not advertise required capability %q", payload.RequiredRunnerCapability), nil)
		}
		return d.completeSessionStart(ctx, lease, payload)
	}
	if !d.supportsRequiredCapability(payload.RequiredRunnerCapability) {
		return d.finishFailed(ctx, lease, fmt.Errorf("runner does not advertise required capability %q", payload.RequiredRunnerCapability), nil)
	}
	sessionID := workItem.SessionID
	if err := d.uploadEvent(ctx, sessionID, EventTypeToolExecutionStart, ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"args":       payload.Input,
	}); err != nil {
		return err
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go d.renewLease(leaseCtx, lease, cancel, renewErrors, nil)

	result, execErr := d.Adapter.Execute(leaseCtx, sandbox.ToolRequest{
		ToolCallID: payload.ToolCallID,
		ToolName:   payload.ToolName,
		Input:      payload.Input,
		WorkDir:    d.Config.WorkDir,
	})
	cancel()
	select {
	case renewErr := <-renewErrors:
		if renewErr != nil {
			return renewErr
		}
	default:
	}

	if ctx.Err() != nil {
		_, err := d.Client.UpdateLease(context.Background(), lease.ID, controlplane.UpdateLeaseRequest{
			State: "cancelled",
			Error: ama.JSON{"message": ctx.Err().Error()},
		})
		return err
	}
	if execErr != nil {
		_ = d.uploadEvent(context.Background(), sessionID, EventTypeToolExecutionEnd, ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"error":      execErr.Error(),
			"result":     result.Output,
			"isError":    true,
		})
		return d.finishFailed(context.Background(), lease, execErr, result.Output)
	}
	if err := d.uploadEvent(ctx, sessionID, EventTypeToolExecutionEnd, ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"result":     result.Output,
		"isError":    false,
	}); err != nil {
		return err
	}
	_, err = d.Client.UpdateLease(ctx, lease.ID, controlplane.UpdateLeaseRequest{
		State: "completed",
		Result: ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"output":     result.Output,
		},
	})
	return err
}

func (d *RunnerDaemon) completeSessionStart(ctx context.Context, lease *controlplane.Lease, payload protocol.WorkPayload) error {
	if !isSupportedSessionRuntime(payload.Runtime) {
		err := fmt.Errorf("unsupported session runtime %q", payload.Runtime)
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if payload.Runtime == "ama" {
		return d.completeAMASandboxStart(ctx, lease, payload)
	}
	return d.runRelaySessionStart(ctx, lease, payload)
}

// isSupportedSessionRuntime reports whether the runner can host a session for this
// runtime. AMA is sandbox-only; external runtimes run their loop locally.
func isSupportedSessionRuntime(runtime string) bool {
	return runtime == "ama" || runtime == "claude-code" || runtime == "codex" || runtime == "copilot"
}

func (d *RunnerDaemon) completeAMASandboxStart(ctx context.Context, lease *controlplane.Lease, payload protocol.WorkPayload) error {
	hub := d.relayHub
	if hub == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if d.Adapter == nil {
		err := fmt.Errorf("runner sandbox adapter is not configured")
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go d.renewLease(leaseCtx, lease, cancel, renewErrors, nil)

	workspaceManager := d.workspaceManager()
	workspace, err := workspaceManager.PrepareRuntime(leaseCtx, d.Config.WorkDir, payload.SessionID, payload.ResourceRefs, payload.RuntimeEnv)
	if err != nil {
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if err := workspaceManager.PrepareAgent(leaseCtx, workspace.Cwd, payload.Runtime, payload.AgentSnapshot); err != nil {
		_ = workspaceManager.CleanupRuntime(context.Background(), workspace)
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	router := newSessionCommandRouter(payload.SessionID, workspaceManager)
	router.registerSandbox(workspace, d.Adapter)
	hub.register(payload.SessionID, router)
	if err := d.uploadEvent(leaseCtx, payload.SessionID, "runner.sandbox.ready", ama.JSON{
		"sessionId": payload.SessionID,
		"runtime":   payload.Runtime,
		"executor":  d.Config.SandboxAdapter,
	}); err != nil {
		hub.unregister(payload.SessionID)
		_ = workspaceManager.CleanupRuntime(context.Background(), workspace)
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	_, err = d.Client.UpdateLease(leaseCtx, lease.ID, controlplane.UpdateLeaseRequest{
		State: "completed",
		Result: ama.JSON{
			"sessionId":    payload.SessionID,
			"runtime":      payload.Runtime,
			"sandboxReady": true,
			"workspace":    workspace.Cwd,
		},
	})
	if err != nil {
		hub.unregister(payload.SessionID)
		_ = workspaceManager.CleanupRuntime(context.Background(), workspace)
		return err
	}
	cancel()
	select {
	case renewErr := <-renewErrors:
		if renewErr != nil && !isCompletedLeaseRenewalRace(renewErr) {
			return renewErr
		}
	default:
	}
	return nil
}

// sessionStartedPayload is the runner.session.started event body relayed at the
// start of every session.
func (d *RunnerDaemon) sessionStartedPayload(payload protocol.WorkPayload) ama.JSON {
	started := ama.JSON{
		"sessionId":     payload.SessionID,
		"hostingMode":   payload.HostingMode,
		"runtime":       payload.Runtime,
		"runtimeConfig": payload.RuntimeConfig,
		"provider":      payload.Provider,
		"runtimeDriver": payload.RuntimeDriver,
		"executor":      d.Config.SandboxAdapter,
	}
	if payload.Model != "" {
		started["model"] = payload.Model
	}
	return started
}

// relaySink relays one stored event live over a session's transport.
type relaySink func(ctx context.Context, eventType string, payload ama.JSON, relay *relayStamp) error

// runRelaySessionStart runs a session over the per-runner relay channel. Events are
// stored on the runner and relayed live fire-and-forget; commands route in over the
// hub by sessionId.
func (d *RunnerDaemon) runRelaySessionStart(ctx context.Context, lease *controlplane.Lease, payload protocol.WorkPayload) error {
	hub := d.relayHub
	if hub == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	store, err := openSessionEventStore(filepath.Join(d.Config.WorkDir, layout.SessionsDirName, payload.SessionID))
	if err != nil {
		if finishErr := d.finishFailed(ctx, lease, fmt.Errorf("open session event store: %w", err), nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	relay := func(relayCtx context.Context, eventType string, eventPayload ama.JSON, stamp *relayStamp) error {
		hub.relayEvent(relayCtx, payload.SessionID, eventType, eventPayload, stamp)
		return nil
	}
	cmdRouter := newSessionCommandRouter(payload.SessionID, d.workspaceManager(), func(message string) {
		if err := d.relayStoredEvent(context.Background(), store, relay, "message_end", userPromptEventPayload(message)); err != nil {
			slog.Warn("runner failed to record delivered prompt event", "sessionId", payload.SessionID, "error", err)
		}
	})
	hub.register(payload.SessionID, cmdRouter)
	defer hub.unregister(payload.SessionID)

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	resumeTokens := &resumeTokenBox{}
	renewErrors := make(chan error, 1)
	go d.renewLease(leaseCtx, lease, cancel, renewErrors, resumeTokens)
	checkRenewal := func() error {
		select {
		case renewErr := <-renewErrors:
			if renewErr != nil {
				return renewErr
			}
		default:
		}
		return nil
	}

	if err := d.relayStoredEvent(leaseCtx, store, relay, "runner.session.started", d.sessionStartedPayload(payload)); err != nil {
		if finishErr := d.finishFailed(context.Background(), lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if prompt := initialPrompt(payload); prompt != "" {
		if err := d.relayStoredEvent(leaseCtx, store, relay, "message_end", userPromptEventPayload(prompt)); err != nil {
			if finishErr := d.finishFailed(context.Background(), lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
	}

	result, runErr, timedOut := d.runRuntimeAndRelay(leaseCtx, payload, store, cmdRouter, resumeTokens, relay)
	writeRuntimeError := func(errPayload ama.JSON) {
		_ = d.relayStoredEvent(context.Background(), store, relay, EventTypeRuntimeError, errPayload)
	}
	finalizeErr := d.finalizeRuntimeRun(leaseCtx, ctx, lease, resumeTokens, result, runErr, timedOut, writeRuntimeError)
	cancel()
	if renewErr := checkRenewal(); renewErr != nil {
		if finalizeErr == nil && isCompletedLeaseRenewalRace(renewErr) {
			return nil
		}
		return renewErr
	}
	return finalizeErr
}

func (d *RunnerDaemon) relayStoredEvent(ctx context.Context, store *sessionEventStore, relay relaySink, eventType string, payload ama.JSON) error {
	stored, err := store.Append(eventType, payload, ama.JSON{"runnerId": d.RunnerID, "executor": d.Config.SandboxAdapter})
	if err != nil {
		return err
	}
	return relay(ctx, eventType, payload, &relayStamp{sequence: stored.Sequence, id: stored.ID, createdAt: stored.CreatedAt})
}

func userPromptEventPayload(message string) ama.JSON {
	return ama.JSON{
		"message": ama.JSON{
			"role": "user",
			"content": []ama.JSON{
				{"type": "text", "text": message},
			},
		},
	}
}

func initialPrompt(payload protocol.WorkPayload) string {
	if payload.InitialPrompt == nil {
		return ""
	}
	return *payload.InitialPrompt
}

func (d *RunnerDaemon) runRuntimeAndRelay(
	ctx context.Context,
	payload protocol.WorkPayload,
	store *sessionEventStore,
	cmdRouter *sessionCommandRouter,
	resumeTokens *resumeTokenBox,
	relay relaySink,
) (ama.JSON, error, bool) {
	workspaceManager := d.workspaceManager()
	workspace, err := workspaceManager.PrepareRuntime(ctx, d.Config.WorkDir, payload.SessionID, payload.ResourceRefs, payload.RuntimeEnv)
	if err != nil {
		return nil, err, false
	}
	if err := workspaceManager.PrepareAgent(ctx, workspace.Cwd, payload.Runtime, payload.AgentSnapshot); err != nil {
		_ = workspaceManager.CleanupRuntime(context.Background(), workspace)
		return nil, err, false
	}
	adapter := d.RuntimeAdapter
	if adapter == nil {
		selectedAdapter, err := d.hostRuntime().AdapterFor(payload.Runtime)
		if err != nil {
			return nil, err, false
		}
		adapter = selectedAdapter
	}
	runCtx := ctx
	cancelDeadline := func() {}
	if d.Config.MaxSessionDuration > 0 {
		runCtx, cancelDeadline = context.WithTimeout(ctx, d.Config.MaxSessionDuration)
	}
	defer cancelDeadline()
	var writeMu sync.Mutex
	result, runErr := adapter.Run(runCtx, hostruntime.Request{
		SessionID:             payload.SessionID,
		Runtime:               payload.Runtime,
		RuntimeConfig:         payload.RuntimeConfig,
		RuntimeEnv:            payload.RuntimeEnv,
		Provider:              payload.Provider,
		Model:                 payload.Model,
		AgentSnapshot:         payload.AgentSnapshot,
		InitialPrompt:         initialPrompt(payload),
		Resume:                payload.Resume,
		ResumeToken:           payload.ResumeToken,
		WorkDir:               workspace.Cwd,
		OnResumeToken:         resumeTokens.Set,
		RegisterControlSender: cmdRouter.registerControlSender,
	}, func(eventType string, eventPayload ama.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		stored, err := store.Append(eventType, eventPayload, ama.JSON{"runnerId": d.RunnerID, "executor": d.Config.SandboxAdapter})
		if err != nil {
			return err
		}
		return relay(ctx, eventType, eventPayload, &relayStamp{sequence: stored.Sequence, id: stored.ID, createdAt: stored.CreatedAt})
	})
	if runErr == nil || successfulRuntimeResult(result) {
		memoryStores, memoryErr := workspaceManager.ReadWritableMemoryStoreSnapshots(workspace)
		if memoryErr != nil {
			return nil, memoryErr, errors.Is(runCtx.Err(), context.DeadlineExceeded)
		}
		if len(memoryStores) > 0 {
			if result == nil {
				result = ama.JSON{}
			}
			result["memoryStores"] = memoryStores
		}
	}
	return result, runErr, errors.Is(runCtx.Err(), context.DeadlineExceeded)
}

func (d *RunnerDaemon) finalizeRuntimeRun(
	ctx context.Context,
	requestCtx context.Context,
	lease *controlplane.Lease,
	resumeTokens *resumeTokenBox,
	result ama.JSON,
	runErr error,
	timedOut bool,
	writeRuntimeError func(payload ama.JSON),
) error {
	if runErr == nil {
		_, updateErr := d.Client.UpdateLease(ctx, lease.ID, controlplane.UpdateLeaseRequest{State: "completed", Result: result})
		return updateErr
	}
	if successfulRuntimeResult(result) {
		completedResult := cloneJSON(result)
		completedResult["completionWarning"] = runErr.Error()
		_, err := d.Client.UpdateLease(ctx, lease.ID, controlplane.UpdateLeaseRequest{State: "completed", Result: completedResult})
		return err
	}
	if timedOut {
		timeoutErr := fmt.Errorf("session exceeded max duration %s", d.Config.MaxSessionDuration)
		writeRuntimeError(ama.JSON{"error": ama.JSON{"message": timeoutErr.Error(), "code": "session_timeout"}})
		if finishErr := d.finishFailed(context.Background(), lease, timeoutErr, result); finishErr != nil {
			return finishErr
		}
		return timeoutErr
	}
	if requestCtx.Err() != nil {
		if finishErr := d.finishInterrupted(context.Background(), lease, resumeTokens); finishErr != nil {
			return finishErr
		}
		return runErr
	}
	writeRuntimeError(ama.JSON{"error": ama.JSON{"message": runErr.Error(), "code": "runtime_failed"}})
	if finishErr := d.finishFailed(context.Background(), lease, runErr, result); finishErr != nil {
		return finishErr
	}
	return runErr
}
