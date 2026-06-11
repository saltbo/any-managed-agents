package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
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
	CreateRunnerHeartbeat(ctx context.Context, runnerID string, body ama.RunnerHeartbeatRequest) (*ama.Runner, error)
	CreateRunnerLease(ctx context.Context, runnerID string, body ama.ClaimRunnerLeaseRequest) (*ama.RunnerWorkLease, error)
	UpdateRunnerLease(ctx context.Context, runnerID string, leaseID string, body ama.UpdateRunnerLeaseRequest) (*ama.RunnerWorkLease, error)
	CreateRunnerLeaseEvents(ctx context.Context, runnerID string, leaseID string, body ama.UploadRunnerLeaseEventsRequest) error
}

type RunnerSessionChannelOpener interface {
	OpenRunnerSessionChannel(ctx context.Context, runnerID string, leaseID string) (RunnerSessionChannel, error)
}

type RunnerSessionChannel interface {
	ReadJSON(ctx context.Context, out any) error
	WriteJSON(ctx context.Context, value any) error
	Close(statusCode int, reason string) error
}

type RunnerDaemon struct {
	Config         Config
	Client         ControlPlane
	Channels       RunnerSessionChannelOpener
	Adapter        SandboxAdapter
	RuntimeAdapter RuntimeAdapter
	// LookPath resolves runtime CLI binaries on PATH; defaults to exec.LookPath.
	LookPath               func(string) (string, error)
	RunnerID               string
	mu                     sync.Mutex
	activeLeases           int
	usageMu                sync.Mutex
	runtimeUsage           []ama.RuntimeUsage
	capabilityMu           sync.Mutex
	advertisedCapabilities []string
}

func (d *RunnerDaemon) lookPath() func(string) (string, error) {
	if d.LookPath != nil {
		return d.LookPath
	}
	return exec.LookPath
}

// refreshCapabilities re-detects which runtime CLIs are installed on the host
// so a CLI installed mid-run is picked up by the next heartbeat.
func (d *RunnerDaemon) refreshCapabilities() []string {
	available := detectAvailableRuntimes(d.lookPath())
	capabilities := runnerCapabilities(available)
	d.capabilityMu.Lock()
	changed := !slices.Equal(d.advertisedCapabilities, capabilities)
	d.advertisedCapabilities = capabilities
	d.capabilityMu.Unlock()
	if changed && len(available) == 0 {
		slog.Warn("no runtime CLIs detected on PATH; runner advertises no external runtimes and will receive no runtime work",
			"binaries", []string{"claude", "codex", "copilot"})
	}
	return capabilities
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

const runtimeUsageRefreshInterval = 5 * time.Minute

func (d *RunnerDaemon) setRuntimeUsage(usage []ama.RuntimeUsage) {
	d.usageMu.Lock()
	defer d.usageMu.Unlock()
	d.runtimeUsage = usage
}

func (d *RunnerDaemon) getRuntimeUsage() []ama.RuntimeUsage {
	d.usageMu.Lock()
	defer d.usageMu.Unlock()
	return d.runtimeUsage
}

// runUsageCollector refreshes the cached per-runtime quota windows on a slow
// schedule so each heartbeat can report them without spawning the bridge.
func (d *RunnerDaemon) runUsageCollector(ctx context.Context) {
	refresh := func() {
		if usage := collectRuntimeUsage(ctx); usage != nil {
			d.setRuntimeUsage(usage)
		}
	}
	refresh()
	ticker := time.NewTicker(runtimeUsageRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refresh()
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
	ID      string               `json:"id"`
	Type    string               `json:"type"`
	Path    string               `json:"path"`
	Message string               `json:"message"`
	Body    RunnerRuntimeRequest `json:"body"`
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
	if err := d.heartbeat(ctx); err != nil {
		return err
	}
	go d.runUsageCollector(ctx)

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
					leaseFailures.Add(1)
					slog.Warn("runner lease failed", "consecutiveFailures", leaseFailures.Load(), "error", err)
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
	if err := d.heartbeat(ctx); err != nil {
		return err
	}
	if !d.tryAcquireLeaseSlot() {
		return nil
	}
	defer d.releaseLeaseSlot()
	return d.runOneLease(ctx)
}

func (d *RunnerDaemon) runOneLease(ctx context.Context) error {
	lease, err := d.Client.CreateRunnerLease(ctx, d.RunnerID, ama.ClaimRunnerLeaseRequest{
		LeaseDurationSeconds: d.Config.LeaseDurationSeconds,
	})
	if err != nil || lease == nil {
		return err
	}
	return d.executeLease(ctx, lease)
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
	_, err = d.Client.CreateRunnerHeartbeat(ctx, d.RunnerID, ama.RunnerHeartbeatRequest{
		Status:       "active",
		Capabilities: d.refreshCapabilities(),
		CurrentLoad:  &load,
		RuntimeUsage: d.getRuntimeUsage(),
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
	return err
}

func (d *RunnerDaemon) sendOfflineHeartbeat(ctx context.Context) error {
	load := 0
	_, err := d.Client.CreateRunnerHeartbeat(ctx, d.RunnerID, ama.RunnerHeartbeatRequest{
		Status:      "offline",
		CurrentLoad: &load,
	})
	return err
}

func (d *RunnerDaemon) executeLease(ctx context.Context, lease *ama.RunnerWorkLease) error {
	payload, err := parseWorkPayload(lease.WorkItem.Payload)
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
	if err := d.uploadEvent(ctx, lease, "tool_execution_start", ama.JSON{
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
		_, err := d.Client.UpdateRunnerLease(context.Background(), d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
			Status: "cancelled",
			Error:  ama.JSON{"message": ctx.Err().Error()},
		})
		return err
	}
	if execErr != nil {
		_ = d.uploadEvent(context.Background(), lease, "tool_execution_end", ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"error":      execErr.Error(),
			"result":     result.Output,
			"isError":    true,
		})
		return d.finishFailed(context.Background(), lease, execErr, result.Output)
	}
	if err := d.uploadEvent(ctx, lease, "tool_execution_end", ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"result":     result.Output,
		"isError":    false,
	}); err != nil {
		return err
	}
	_, err = d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
		Status: "completed",
		Result: ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"output":     result.Output,
		},
	})
	return err
}

func (d *RunnerDaemon) completeSessionStart(ctx context.Context, lease *ama.RunnerWorkLease, payload WorkPayload) error {
	handler, err := sessionRuntimeHandlerFor(payload.Runtime)
	if err != nil {
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}

	channel, err := d.openRunnerSessionChannel(ctx, lease.ID)
	if err != nil {
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	defer channel.Close(1000, "runner session complete")

	if err := d.waitForChannelAccepted(ctx, channel, payload.SessionID); err != nil {
		if finishErr := d.finishFailed(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	// The latest runtime resume token rides along on lease renewals and the
	// interrupted status so the server can resume the session in place if this
	// runner stops mid-flight.
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

	sessionStartedPayload := ama.JSON{
		"sessionId":     payload.SessionID,
		"hostingMode":   payload.HostingMode,
		"runtime":       payload.Runtime,
		"runtimeConfig": payload.RuntimeConfig,
		"provider":      payload.Provider,
		"runtimeDriver": payload.RuntimeDriver,
		"executor":      d.Config.SandboxAdapter,
	}
	if payload.Model != "" {
		sessionStartedPayload["model"] = payload.Model
	}
	writeSessionStarted := d.writeChannelEvent
	if handler.acknowledgeSessionStarted {
		writeSessionStarted = d.writeAcknowledgedChannelEvent
	}
	if err := writeSessionStarted(leaseCtx, channel, "runner.session.started", sessionStartedPayload); err != nil {
		if finishErr := d.finishFailed(context.Background(), lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}

	err = handler.run(d, sessionRuntimeExecution{
		RequestContext: ctx,
		LeaseContext:   leaseCtx,
		Channel:        channel,
		Lease:          lease,
		Payload:        payload,
		CheckRenewal:   checkRenewal,
		ResumeTokens:   resumeTokens,
	})
	cancel()
	if renewErr := checkRenewal(); renewErr != nil {
		if err == nil && isCompletedLeaseRenewalRace(renewErr) {
			return nil
		}
		return renewErr
	}
	return err
}

func isCompletedLeaseRenewalRace(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Runner lease is no longer active")
}

func (d *RunnerDaemon) runAMASession(execution sessionRuntimeExecution) error {
	for {
		var message RunnerChannelMessage
		if err := execution.Channel.ReadJSON(execution.LeaseContext, &message); err != nil {
			if execution.RequestContext.Err() != nil {
				// Graceful shutdown — keep the session recoverable for resume on restart.
				return d.finishInterrupted(context.Background(), execution.Lease, execution.ResumeTokens)
			}
			return nil
		}
		if message.Type != "session.command" {
			continue
		}
		if message.SessionID != execution.Payload.SessionID || message.LeaseID != execution.Lease.ID || message.RunnerID != d.RunnerID {
			err := fmt.Errorf("runner session command ownership mismatch")
			if finishErr := d.finishFailed(context.Background(), execution.Lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
		if err := d.handleSessionCommand(execution.LeaseContext, execution.Channel, message.Command); err != nil {
			if finishErr := d.finishFailed(context.Background(), execution.Lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
		if err := execution.CheckRenewal(); err != nil {
			return err
		}
	}
}

func (d *RunnerDaemon) runExternalSession(execution sessionRuntimeExecution) error {
	ctx := execution.LeaseContext
	lease := execution.Lease
	payload := execution.Payload
	// A single reader goroutine owns the channel for the whole run: it routes
	// mid-run session.command prompts to the live runtime and everything else
	// (event acks, channel errors) back to the acknowledged event writers.
	// Starting it before workspace preparation buffers prompts that arrive
	// while the runtime is still starting.
	router := newSessionChannelRouter(execution.Channel, payload.SessionID, lease.ID, d.RunnerID)
	go router.run(ctx)
	channel := router.routedChannel()
	workspace, err := prepareRuntimeWorkspace(ctx, d.Config.WorkDir, payload.SessionID, payload.ResourceRefs)
	if err != nil {
		return err
	}
	if err := prepareAgentWorkspace(ctx, workspace.Cwd, payload.Runtime, payload.AgentSnapshot); err != nil {
		return err
	}
	adapter := d.RuntimeAdapter
	if adapter == nil {
		selectedAdapter, err := runtimeAdapterFor(payload.Runtime, d.Config.CommandTimeout, d.Config.ShutdownGraceInterval)
		if err != nil {
			return err
		}
		adapter = selectedAdapter
	}
	// Lease renewal keeps a session alive indefinitely, so a runaway runtime
	// would run forever without a hard per-session deadline. Cancelling the
	// run context follows the same stop path as a server-side cancel
	// (SIGTERM, then SIGKILL after the shutdown grace).
	runCtx := ctx
	cancelDeadline := func() {}
	if d.Config.MaxSessionDuration > 0 {
		runCtx, cancelDeadline = context.WithTimeout(ctx, d.Config.MaxSessionDuration)
	}
	defer cancelDeadline()
	var writeMu sync.Mutex
	result, runErr := adapter.Run(runCtx, RuntimeRequest{
		SessionID:            payload.SessionID,
		Runtime:              payload.Runtime,
		RuntimeConfig:        payload.RuntimeConfig,
		RuntimeEnv:           payload.RuntimeEnv,
		Provider:             payload.Provider,
		Model:                payload.Model,
		AgentSnapshot:        payload.AgentSnapshot,
		InitialPrompt:        initialPrompt(payload),
		Resume:               payload.Resume,
		ResumeToken:          payload.ResumeToken,
		WorkDir:              workspace.Cwd,
		OnResumeToken:        execution.ResumeTokens.Set,
		RegisterPromptSender: router.registerPromptSender,
	}, func(eventType string, eventPayload ama.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return d.writeAcknowledgedChannelEvent(ctx, channel, eventType, eventPayload)
	})
	if runErr != nil {
		if successfulRuntimeResult(result) {
			completedResult := cloneJSON(result)
			completedResult["completionWarning"] = runErr.Error()
			_, err := d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
				Status: "completed",
				Result: completedResult,
			})
			return err
		}
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			// The session hit MaxSessionDuration. Fail the lease explicitly —
			// never report it as interrupted, which would re-queue the session
			// for resume and loop the runaway runtime forever.
			timeoutErr := fmt.Errorf("session exceeded max duration %s", d.Config.MaxSessionDuration)
			_ = d.writeAcknowledgedChannelEvent(context.Background(), channel, "runtime.error", ama.JSON{
				"error": ama.JSON{"message": timeoutErr.Error(), "code": "session_timeout"},
			})
			if finishErr := d.finishFailed(context.Background(), lease, timeoutErr, result); finishErr != nil {
				return finishErr
			}
			return timeoutErr
		}
		if execution.RequestContext.Err() != nil {
			// The runner is shutting down, not the runtime failing. Report the lease
			// as interrupted so the server re-queues the session for resume instead of
			// marking it failed; a restarted runner picks it up and continues.
			if finishErr := d.finishInterrupted(context.Background(), lease, execution.ResumeTokens); finishErr != nil {
				return finishErr
			}
			return runErr
		}
		_ = d.writeAcknowledgedChannelEvent(context.Background(), channel, "runtime.error", ama.JSON{
			"error": ama.JSON{"message": runErr.Error(), "code": "runtime_failed"},
		})
		if finishErr := d.finishFailed(context.Background(), lease, runErr, result); finishErr != nil {
			return finishErr
		}
		return runErr
	}
	_, updateErr := d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
		Status: "completed",
		Result: result,
	})
	return updateErr
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

func (d *RunnerDaemon) openRunnerSessionChannel(ctx context.Context, leaseID string) (RunnerSessionChannel, error) {
	if d.Channels == nil {
		return nil, fmt.Errorf("runner session channel client is not configured")
	}
	return d.Channels.OpenRunnerSessionChannel(ctx, d.RunnerID, leaseID)
}

func (d *RunnerDaemon) waitForChannelAccepted(ctx context.Context, channel RunnerSessionChannel, sessionID string) error {
	for {
		var message RunnerChannelMessage
		if err := channel.ReadJSON(ctx, &message); err != nil {
			return err
		}
		if message.Type != "session.channel.accepted" {
			continue
		}
		if message.SessionID != sessionID {
			return fmt.Errorf("runner session channel accepted mismatched session %q", message.SessionID)
		}
		return nil
	}
}

func (d *RunnerDaemon) handleSessionCommand(ctx context.Context, channel RunnerSessionChannel, command RunnerSessionCommand) error {
	for _, toolCall := range command.Body.ToolCalls {
		input := toolCall.Input
		if input == nil {
			input = toolCall.Arguments
		}
		if toolCall.ID == "" || toolCall.Name == "" || input == nil {
			return fmt.Errorf("runner session command includes an invalid tool call")
		}
		if toolCall.Name != "sandbox.exec" && toolCall.Name != "sandbox.read" && toolCall.Name != "sandbox.write" {
			return fmt.Errorf("unsupported sandbox tool: %s", toolCall.Name)
		}
		if err := d.executeSessionToolCall(ctx, channel, toolCall.ID, toolCall.Name, input); err != nil {
			return err
		}
	}
	return nil
}

func (d *RunnerDaemon) executeSessionToolCall(
	ctx context.Context,
	channel RunnerSessionChannel,
	toolCallID string,
	toolName string,
	input map[string]any,
) error {
	if err := d.writeChannelEvent(ctx, channel, "tool_execution_start", ama.JSON{
		"toolCallId": toolCallID,
		"toolName":   toolName,
		"args":       input,
	}); err != nil {
		return err
	}
	startedAt := time.Now()
	result, execErr := d.Adapter.Execute(ctx, ToolRequest{
		ToolCallID: toolCallID,
		ToolName:   toolName,
		Input:      input,
		WorkDir:    d.Config.WorkDir,
	})
	payload := ama.JSON{
		"toolCallId": toolCallID,
		"toolName":   toolName,
		"result":     result.Output,
		"durationMs": time.Since(startedAt).Milliseconds(),
	}
	if execErr != nil {
		payload["error"] = ama.JSON{"message": execErr.Error()}
		payload["isError"] = true
		return d.writeChannelEvent(context.Background(), channel, "tool_execution_end", payload)
	}
	payload["isError"] = false
	return d.writeChannelEvent(ctx, channel, "tool_execution_end", payload)
}

func (d *RunnerDaemon) writeChannelEvent(ctx context.Context, channel RunnerSessionChannel, eventType string, payload ama.JSON) error {
	return channel.WriteJSON(ctx, d.channelEventMessage(eventType, payload))
}

func (d *RunnerDaemon) channelEventMessage(eventType string, payload ama.JSON) ama.JSON {
	metadata := ama.JSON{
		"runnerId": d.RunnerID,
		"executor": d.Config.SandboxAdapter,
	}
	message := ama.JSON{
		"type": "runner.event",
		"event": ama.JSON{
			"type":     eventType,
			"payload":  payload,
			"metadata": metadata,
		},
	}
	return message
}

func (d *RunnerDaemon) writeAcknowledgedChannelEvent(ctx context.Context, channel RunnerSessionChannel, eventType string, payload ama.JSON) error {
	eventID := fmt.Sprintf("runner_event_%d", time.Now().UnixNano())
	if err := channel.WriteJSON(ctx, ama.JSON{
		"type":    "runner.event",
		"eventId": eventID,
		"event": ama.JSON{
			"type":    eventType,
			"payload": payload,
			"metadata": ama.JSON{
				"runnerId": d.RunnerID,
				"executor": d.Config.SandboxAdapter,
			},
		},
	}); err != nil {
		return err
	}
	for {
		var message RunnerChannelMessage
		if err := channel.ReadJSON(ctx, &message); err != nil {
			return err
		}
		if message.Type == "session.channel.error" && (message.EventID == "" || message.EventID == eventID) {
			return fmt.Errorf("runner session channel rejected event %s: %s", eventID, message.Message)
		}
		if message.EventID != eventID {
			continue
		}
		if message.Type == "runner.event.accepted" {
			return nil
		}
	}
}

func (d *RunnerDaemon) renewLease(ctx context.Context, lease *ama.RunnerWorkLease, cancel context.CancelFunc, errors chan<- error, resumeTokens *resumeTokenBox) {
	ticker := time.NewTicker(d.Config.RenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
				Status:               "active",
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

func (d *RunnerDaemon) uploadEvent(ctx context.Context, lease *ama.RunnerWorkLease, eventType string, payload ama.JSON) error {
	return d.Client.CreateRunnerLeaseEvents(ctx, d.RunnerID, lease.ID, ama.UploadRunnerLeaseEventsRequest{
		Events: []ama.RunnerLeaseEvent{{Type: eventType, Payload: payload}},
	})
}

func (d *RunnerDaemon) finishFailed(ctx context.Context, lease *ama.RunnerWorkLease, failure error, output ama.JSON) error {
	body := ama.UpdateRunnerLeaseRequest{
		Status: "failed",
		Error:  ama.JSON{"message": failure.Error()},
	}
	if output != nil {
		body.Result = ama.JSON{"output": output}
	}
	_, err := d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, body)
	return err
}

// finishInterrupted ends the lease without failing the work item so the server
// keeps the session recoverable. Used when the runner stops mid-flight (graceful
// shutdown) rather than the runtime itself failing. The latest resume token is
// attached so the recovery rewrite can resume the runtime where it left off.
func (d *RunnerDaemon) finishInterrupted(ctx context.Context, lease *ama.RunnerWorkLease, resumeTokens *resumeTokenBox) error {
	_, err := d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
		Status:      "interrupted",
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
