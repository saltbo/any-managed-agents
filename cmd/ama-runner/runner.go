package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type ControlPlane interface {
	CheckHealth(ctx context.Context) (*ama.Health, error)
	CreateRunner(ctx context.Context, body ama.CreateRunnerRequest) (*ama.Runner, error)
	PutRunnerHeartbeat(ctx context.Context, runnerID string, body PutRunnerHeartbeatRequest) error
	ListAvailableWorkItems(ctx context.Context) ([]WorkItem, error)
	ReadWorkItem(ctx context.Context, workItemID string) (*WorkItem, error)
	CreateLease(ctx context.Context, body CreateLeaseRequest) (*Lease, error)
	UpdateLease(ctx context.Context, leaseID string, body UpdateLeaseRequest) (*Lease, error)
	CreateSessionEvents(ctx context.Context, sessionID string, events []SessionEvent) error
}

type RunnerSessionChannel interface {
	ReadJSON(ctx context.Context, out any) error
	WriteJSON(ctx context.Context, value any) error
	Close(statusCode int, reason string) error
}

type RunnerDaemon struct {
	Config         Config
	Client         ControlPlane
	Channels       RunnerChannelOpener
	Adapter        SandboxAdapter
	RuntimeAdapter RuntimeAdapter
	// relayHub owns the runner's single per-runner relay channel for all sessions
	// (claude-code/codex/copilot). Started once the runner id is known and kept
	// open for the runner's lifetime; nil until Start wires it.
	relayHub *relayHub
	// LookPath resolves runtime CLI binaries on PATH; defaults to exec.LookPath.
	LookPath func(string) (string, error)
	// DetectRuntime probes the host CLI for a runtime: enumerated model ids
	// plus availability status, version, and safe diagnostic detail; defaults
	// to spawning the embedded runtime bridge (detectRuntimeProbe).
	DetectRuntime          func(ctx context.Context, runtimeName string) runtimeProbe
	RunnerID               string
	mu                     sync.Mutex
	activeLeases           int
	usageMu                sync.Mutex
	runtimeUsage           []ama.RuntimeUsage
	runtimeUsageLimits     map[string]string
	capabilityMu           sync.Mutex
	advertisedCapabilities []string
	advertisedInventory    []v1RuntimeInventory
	probeMu                sync.Mutex
	runtimeProbes          map[string]runtimeProbe
}

func (d *RunnerDaemon) lookPath() func(string) (string, error) {
	if d.LookPath != nil {
		return d.LookPath
	}
	return exec.LookPath
}

// refreshCapabilities re-detects which runtime CLIs are installed on the host
// so a CLI installed mid-run is picked up by the next heartbeat. The same pass
// rebuilds the runtime inventory the heartbeat reports.
func (d *RunnerDaemon) refreshCapabilities() []string {
	available := detectAvailableRuntimes(d.lookPath())
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
// the bridge and can take seconds, so results — including failures, which
// leave the runtime on its pinned fallback model — are cached for the process
// lifetime. A CLI installed mid-run is probed on the next capability refresh
// because it has no cache entry yet.
func (d *RunnerDaemon) runtimeProbesFor(availableRuntimes []string) map[string]runtimeProbe {
	detect := d.DetectRuntime
	if detect == nil {
		detect = detectRuntimeProbe
	}
	d.probeMu.Lock()
	defer d.probeMu.Unlock()
	if d.runtimeProbes == nil {
		d.runtimeProbes = map[string]runtimeProbe{}
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
	probes := make(map[string]runtimeProbe, len(d.runtimeProbes))
	for runtimeName, probe := range d.runtimeProbes {
		probes[runtimeName] = probe
	}
	return probes
}

func modelsFromProbes(probes map[string]runtimeProbe) map[string][]string {
	models := make(map[string][]string, len(probes))
	for runtimeName, probe := range probes {
		models[runtimeName] = probe.Models
	}
	return models
}

// runnerRuntimeInventory reports availability for every runtime the runner can
// host: the embedded ama runtime is always ready, runtimes whose CLI is not on
// PATH are missing, and detected CLIs carry the bridge probe's status, version,
// and safe diagnostic detail.
func runnerRuntimeInventory(availableRuntimes []string, probes map[string]runtimeProbe) []v1RuntimeInventory {
	inventory := []v1RuntimeInventory{
		{Runtime: "ama", Version: runnerVersion, State: "ready", Detail: "embedded ama runtime"},
	}
	for _, cli := range runtimeCLIBinaries() {
		if !slices.Contains(availableRuntimes, cli.Runtime) {
			inventory = append(inventory, v1RuntimeInventory{
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
		inventory = append(inventory, v1RuntimeInventory{
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

func (d *RunnerDaemon) currentRuntimeInventory() []v1RuntimeInventory {
	d.capabilityMu.Lock()
	inventory := append([]v1RuntimeInventory(nil), d.advertisedInventory...)
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

func (d *RunnerDaemon) setRuntimeUsageSnapshot(snapshot *runtimeUsageSnapshot) {
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

func runtimeInventoryWithUsageLimits(inventory []v1RuntimeInventory, limits map[string]string) []v1RuntimeInventory {
	if len(limits) == 0 {
		return inventory
	}
	result := append([]v1RuntimeInventory(nil), inventory...)
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
	d.setRuntimeUsageSnapshot(collectRuntimeUsage(ctx))
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

type WorkPayload struct {
	Protocol                 string            `json:"protocol"`
	Type                     string            `json:"type"`
	SessionID                string            `json:"sessionId"`
	HostingMode              string            `json:"hostingMode"`
	Runtime                  string            `json:"runtime"`
	RuntimeConfig            map[string]any    `json:"runtimeConfig"`
	ResourceRefs             []ResourceRef     `json:"resourceRefs"`
	Provider                 string            `json:"provider"`
	Model                    string            `json:"model"`
	AgentSnapshot            map[string]any    `json:"agentSnapshot"`
	RuntimeDriver            string            `json:"runtimeDriver"`
	RequiredRunnerCapability string            `json:"requiredRunnerCapability"`
	RuntimeEnv               map[string]string `json:"runtimeEnv"`
	InitialPrompt            *string           `json:"initialPrompt"`
	Resume                   bool              `json:"resume"`
	ResumeToken              string            `json:"resumeToken"`
	Approved                 bool              `json:"approved"`
	ToolCallID               string            `json:"toolCallId"`
	ToolName                 string            `json:"toolName"`
	Input                    map[string]any    `json:"input"`
	ToolCall                 *ToolCall         `json:"toolCall"`
}

type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
	Input     map[string]any `json:"input"`
	Approved  bool           `json:"approved"`
}

type RunnerChannelMessage struct {
	Type       string               `json:"type"`
	EventID    string               `json:"eventId"`
	Message    string               `json:"message"`
	SessionID  string               `json:"sessionId"`
	RunnerID   string               `json:"runnerId"`
	LeaseID    string               `json:"leaseId"`
	WorkItemID string               `json:"workItemId"`
	Command    RunnerSessionCommand `json:"command"`
}

type RunnerSessionCommand struct {
	ID           string               `json:"id"`
	Type         string               `json:"type"`
	Path         string               `json:"path"`
	Message      string               `json:"message"`
	Reason       string               `json:"reason"`
	PermissionID string               `json:"permissionId"`
	Allowed      bool                 `json:"allowed"`
	Body         RunnerRuntimeRequest `json:"body"`
}

type RunnerRuntimeRequest struct {
	ToolCalls []RunnerRuntimeToolCall `json:"toolCalls"`
}

type RunnerRuntimeToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Input     map[string]any `json:"input"`
	Arguments map[string]any `json:"arguments"`
}

func (d *RunnerDaemon) Start(ctx context.Context) error {
	if err := os.MkdirAll(d.Config.WorkDir, 0o755); err != nil {
		return err
	}
	if err := cleanupStaleRuntimeWorkspaces(ctx, d.Config.WorkDir, runtimeWorkspaceRetention); err != nil {
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
				if isRunnerGoneError(err) {
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
	d.relayHub = newRelayHub(d.Channels, d.RunnerID, d.Config.SandboxAdapter, d.Config.WorkDir)
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
func (d *RunnerDaemon) claimLease(ctx context.Context) (*Lease, *WorkItem, error) {
	available, err := d.Client.ListAvailableWorkItems(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, candidate := range available {
		lease, err := d.Client.CreateLease(ctx, CreateLeaseRequest{
			WorkItemID:           candidate.ID,
			RunnerID:             d.RunnerID,
			LeaseDurationSeconds: d.Config.LeaseDurationSeconds,
		})
		if err != nil {
			if isClaimRaceError(err) {
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
	if err == nil || !isRunnerGoneError(err) {
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
	return d.Client.PutRunnerHeartbeat(ctx, d.RunnerID, PutRunnerHeartbeatRequest{
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
	return d.Client.PutRunnerHeartbeat(ctx, d.RunnerID, PutRunnerHeartbeatRequest{
		State:       "offline",
		CurrentLoad: &load,
	})
}

func (d *RunnerDaemon) executeLease(ctx context.Context, lease *Lease, workItem *WorkItem) error {
	payload, err := parseWorkPayload(workItem.Payload)
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

	result, execErr := d.Adapter.Execute(leaseCtx, ToolRequest{
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
		_, err := d.Client.UpdateLease(context.Background(), lease.ID, UpdateLeaseRequest{
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
	_, err = d.Client.UpdateLease(ctx, lease.ID, UpdateLeaseRequest{
		State: "completed",
		Result: ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"output":     result.Output,
		},
	})
	return err
}

func (d *RunnerDaemon) completeSessionStart(ctx context.Context, lease *Lease, payload WorkPayload) error {
	if !isSupportedSessionRuntime(payload.Runtime) {
		err := fmt.Errorf("unsupported session runtime %q", payload.Runtime)
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	// Every runtime runs its loop on the runner and relays over the single
	// per-runner channel — the channel outlives the lease, so a completed session
	// still serves history while the runner is online.
	return d.runRelaySessionStart(ctx, lease, payload)
}

// isSupportedSessionRuntime reports whether the runner can host a session for this
// runtime. Every supported runtime runs its loop locally and relays over the
// per-runner channel.
func isSupportedSessionRuntime(runtime string) bool {
	return runtime == "ama" || runtime == "claude-code" || runtime == "codex" || runtime == "copilot"
}

// sessionStartedPayload is the runner.session.started event body relayed at the
// start of every session.
func (d *RunnerDaemon) sessionStartedPayload(payload WorkPayload) ama.JSON {
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

func isCompletedLeaseRenewalRace(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Runner lease is no longer active")
}

// isLeaseInactive matches both "Lease is no longer active" and "Runner lease is
// no longer active" — the normal end-of-session signals where the lease was
// released or taken over, not a failure to alarm on.
func isLeaseInactive(err error) bool {
	return err != nil && strings.Contains(err.Error(), "is no longer active")
}

// relaySink relays one stored event live over a session's transport: the ama
// per-lease channel (acked to the cloud) or the CLI per-runner hub (fire-and-forget;
// the event is already durable on the runner).
type relaySink func(ctx context.Context, eventType string, payload ama.JSON, relay *relayStamp) error

// runRelaySessionStart runs a session over the per-runner relay channel. Events are
// stored on the runner and relayed live fire-and-forget; commands route in over the
// hub by sessionId. The hub keeps serving this session's on-disk history after the
// lease ends, so a completed session still renders while the runner is online.
func (d *RunnerDaemon) runRelaySessionStart(ctx context.Context, lease *Lease, payload WorkPayload) error {
	hub := d.relayHub
	if hub == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	store, err := openSessionEventStore(filepath.Join(d.Config.WorkDir, "sessions", payload.SessionID))
	if err != nil {
		if finishErr := d.finishFailed(ctx, lease, fmt.Errorf("open session event store: %w", err), nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	// The relay sink stores then fans each event live, fire-and-forget — the event
	// is durable on disk so a momentary disconnect drops only the live fan.
	relay := func(relayCtx context.Context, eventType string, eventPayload ama.JSON, stamp *relayStamp) error {
		hub.relayEvent(relayCtx, payload.SessionID, eventType, eventPayload, stamp)
		return nil
	}
	// Register the live command router so the hub routes this session's prompts/
	// stop/permission by sessionId; unregister on end. Backfill does not need
	// registration (the hub reads the disk log), so history outlives the lease.
	cmdRouter := newSessionCommandRouter(payload.SessionID, func(message string) {
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

// relayStoredEvent stores one server-generated event (session.started, a runtime
// error) to the local log and relays it live, so even events the runtime did not
// emit are durable and visible to the browser over the relay.
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

// runRuntimeAndRelay prepares the workspace + runtime adapter and runs it, storing
// every event to the local log and relaying it live via `relay`; cmdRouter receives
// the runtime's prompt/stop/permission senders. Shared by the ama (per-lease) and
// CLI (per-runner) session paths. Returns the result, the run error, and whether
// the per-session deadline fired (the finalizer fails — never interrupts — on that).
func (d *RunnerDaemon) runRuntimeAndRelay(
	ctx context.Context,
	payload WorkPayload,
	store *sessionEventStore,
	cmdRouter *sessionCommandRouter,
	resumeTokens *resumeTokenBox,
	relay relaySink,
) (ama.JSON, error, bool) {
	workspace, err := prepareRuntimeWorkspace(ctx, d.Config.WorkDir, payload.SessionID, payload.ResourceRefs, payload.RuntimeEnv)
	if err != nil {
		return nil, err, false
	}
	if err := prepareAgentWorkspace(ctx, workspace.Cwd, payload.Runtime, payload.AgentSnapshot); err != nil {
		return nil, err, false
	}
	adapter := d.RuntimeAdapter
	if adapter == nil {
		selectedAdapter, err := runtimeAdapterFor(payload.Runtime, d.Config.CommandTimeout, d.Config.ShutdownGraceInterval)
		if err != nil {
			return nil, err, false
		}
		adapter = selectedAdapter
	}
	// Lease renewal keeps a session alive indefinitely, so a runaway runtime would
	// run forever without a hard per-session deadline. Cancelling the run context
	// follows the same stop path as a server-side cancel (SIGTERM, then SIGKILL
	// after the shutdown grace).
	runCtx := ctx
	cancelDeadline := func() {}
	if d.Config.MaxSessionDuration > 0 {
		runCtx, cancelDeadline = context.WithTimeout(ctx, d.Config.MaxSessionDuration)
	}
	defer cancelDeadline()
	var writeMu sync.Mutex
	result, runErr := adapter.Run(runCtx, RuntimeRequest{
		SessionID:                payload.SessionID,
		Runtime:                  payload.Runtime,
		RuntimeConfig:            payload.RuntimeConfig,
		RuntimeEnv:               payload.RuntimeEnv,
		Provider:                 payload.Provider,
		Model:                    payload.Model,
		AgentSnapshot:            payload.AgentSnapshot,
		InitialPrompt:            initialPrompt(payload),
		Resume:                   payload.Resume,
		ResumeToken:              payload.ResumeToken,
		WorkDir:                  workspace.Cwd,
		OnResumeToken:            resumeTokens.Set,
		RegisterPromptSender:     cmdRouter.registerPromptSender,
		RegisterStopSender:       cmdRouter.registerStopSender,
		RegisterPermissionSender: cmdRouter.registerPermissionSender,
	}, func(eventType string, eventPayload ama.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		// Store locally first so a relayed backfill can serve this event, then relay
		// it live with the store's own id/sequence/timestamp (the browser dedups by
		// them).
		stored, err := store.Append(eventType, eventPayload, ama.JSON{"runnerId": d.RunnerID, "executor": d.Config.SandboxAdapter})
		if err != nil {
			return err
		}
		return relay(ctx, eventType, eventPayload, &relayStamp{sequence: stored.Sequence, id: stored.ID, createdAt: stored.CreatedAt})
	})
	return result, runErr, errors.Is(runCtx.Err(), context.DeadlineExceeded)
}

// finalizeRuntimeRun settles the lease after a runtime run, shared by the ama
// (per-lease) and CLI (per-runner) paths. A clean run completes the lease; a
// successful-looking result with a late error completes with a warning; a deadline
// failure fails the lease (never interrupted, which would re-queue the runaway
// forever); a shutdown (request context cancelled) reports interrupted so the
// server resumes the session in place; anything else fails the lease.
// writeRuntimeError relays the error event over the session's transport.
func (d *RunnerDaemon) finalizeRuntimeRun(
	ctx context.Context,
	requestCtx context.Context,
	lease *Lease,
	resumeTokens *resumeTokenBox,
	result ama.JSON,
	runErr error,
	timedOut bool,
	writeRuntimeError func(payload ama.JSON),
) error {
	if runErr == nil {
		// Use the (still-live) lease context here, not Background: if a renewal race
		// already finished the lease, this completion fails with "lease no longer
		// active" and the caller's renewal-race check treats it as benign. The
		// terminal paths below use Background because they must report regardless.
		_, updateErr := d.Client.UpdateLease(ctx, lease.ID, UpdateLeaseRequest{State: "completed", Result: result})
		return updateErr
	}
	if successfulRuntimeResult(result) {
		completedResult := cloneJSON(result)
		completedResult["completionWarning"] = runErr.Error()
		_, err := d.Client.UpdateLease(ctx, lease.ID, UpdateLeaseRequest{State: "completed", Result: completedResult})
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

// relayStamp carries a stored event's stable identity (assigned by the runner's
// local store) upstream, so the cloud DO fans a relayed event to browsers live with
// the exact id/sequence/timestamp the relayed backfill serves (the browser dedups).
type relayStamp struct {
	sequence  int64
	id        string
	createdAt string
}

func (d *RunnerDaemon) renewLease(ctx context.Context, lease *Lease, cancel context.CancelFunc, errors chan<- error, resumeTokens *resumeTokenBox) {
	ticker := time.NewTicker(d.Config.RenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := d.Client.UpdateLease(ctx, lease.ID, UpdateLeaseRequest{
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
	return d.Client.CreateSessionEvents(ctx, sessionID, []SessionEvent{{
		Type:    eventType,
		Payload: payload,
		Metadata: ama.JSON{
			"runnerId": d.RunnerID,
			"executor": d.Config.SandboxAdapter,
		},
	}})
}

func (d *RunnerDaemon) finishFailed(ctx context.Context, lease *Lease, failure error, output ama.JSON) error {
	body := UpdateLeaseRequest{
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
// keeps the session recoverable. Used when the runner stops mid-flight (graceful
// shutdown) rather than the runtime itself failing. The latest resume token is
// attached so the recovery rewrite can resume the runtime where it left off.
func (d *RunnerDaemon) finishInterrupted(ctx context.Context, lease *Lease, resumeTokens *resumeTokenBox) error {
	_, err := d.Client.UpdateLease(ctx, lease.ID, UpdateLeaseRequest{
		State:       "interrupted",
		ResumeToken: resumeTokens.Get(),
	})
	return err
}

func parseWorkPayload(payload ama.JSON) (WorkPayload, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return WorkPayload{}, err
	}
	var parsed WorkPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		return WorkPayload{}, err
	}
	if parsed.Protocol != "ama-runner-work" {
		return WorkPayload{}, fmt.Errorf("unsupported work protocol %q", parsed.Protocol)
	}
	if parsed.Type == "session.start" {
		if parsed.SessionID == "" {
			return WorkPayload{}, fmt.Errorf("session.start work item must include sessionId")
		}
		if parsed.HostingMode != "self_hosted" {
			return WorkPayload{}, fmt.Errorf("session.start work item must target self_hosted hostingMode")
		}
		if parsed.Runtime == "" || parsed.Provider == "" || parsed.RuntimeConfig == nil {
			return WorkPayload{}, fmt.Errorf("session.start work item must include runtime, runtimeConfig, and provider")
		}
		if parsed.RequiredRunnerCapability == "" {
			return WorkPayload{}, fmt.Errorf("session.start work item must include requiredRunnerCapability")
		}
		return parsed, nil
	}
	if parsed.ToolCall != nil {
		parsed.ToolCallID = parsed.ToolCall.ID
		parsed.ToolName = parsed.ToolCall.Name
		parsed.Input = parsed.ToolCall.Arguments
		if parsed.Input == nil {
			parsed.Input = parsed.ToolCall.Input
		}
		parsed.Approved = parsed.ToolCall.Approved
	}
	if !parsed.Approved {
		return WorkPayload{}, fmt.Errorf("runner work item is not approved for local execution")
	}
	if parsed.ToolCallID == "" || parsed.ToolName == "" || parsed.Input == nil {
		return WorkPayload{}, fmt.Errorf("runner work item must include toolCallId, toolName, and input")
	}
	if parsed.ToolName != "sandbox.exec" && parsed.ToolName != "sandbox.read" && parsed.ToolName != "sandbox.write" {
		return WorkPayload{}, fmt.Errorf("unsupported sandbox tool: %s", parsed.ToolName)
	}
	return parsed, nil
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
