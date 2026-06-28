package daemon

import (
	"context"
	"fmt"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/sessionevent"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"github.com/samber/lo"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type LeaseWorker struct {
	Config              runnerconfig.Config
	Client              *ama.Client
	SandboxAdapter      sandbox.SandboxAdapter
	RuntimeAdapter      runtime.Adapter
	RuntimeBridge       runtime.Bridge
	Relay               *runnersession.Relay
	RunnerID            string
	CurrentCapabilities func() []string
}

// resumeTokenBox shares the latest runtime resume token between the runtime adapter
// and the lease renewal loop.
type resumeTokenBox struct {
	mu    sync.Mutex
	token string
}

func (b *resumeTokenBox) Set(token string) {
	if b == nil || token == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.token = token
}

func (b *resumeTokenBox) Get() string {
	if b == nil {
		return ""
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.token
}

func (r LeaseWorker) RunOne(ctx context.Context) error {
	lease, workItem, err := r.claimLease(ctx)
	if err != nil || lease == nil {
		return err
	}
	slog.Info("claimed work item", "workItemId", lease.WorkItemId, "sessionId", workItemSessionID(workItem), "leaseId", lease.Id)
	if err := r.runClaimedWork(ctx, lease, workItem); err != nil {
		return err
	}
	slog.Info("work item completed", "workItemId", lease.WorkItemId, "sessionId", workItemSessionID(workItem))
	return nil
}

func (r LeaseWorker) claimLease(ctx context.Context) (*ama.Lease, *ama.WorkItem, error) {
	state := ama.Available
	workItems, err := r.Client.WorkItems.List(ctx, &ama.ListWorkItemsParams{State: &state})
	if err != nil {
		return nil, nil, err
	}
	for _, candidate := range workItems.Data {
		lease, err := r.Client.Leases.Create(ctx, ama.CreateLeaseRequest{
			WorkItemId:           candidate.Id,
			RunnerId:             r.RunnerID,
			LeaseDurationSeconds: lo.ToPtr(r.Config.LeaseDurationSeconds),
		})
		if err != nil {
			if IsClaimRaceError(err) {
				continue
			}
			return nil, nil, err
		}
		workItem, err := r.Client.WorkItems.Get(ctx, lease.WorkItemId)
		if err != nil {
			return nil, nil, err
		}
		return lease, workItem, nil
	}
	return nil, nil, nil
}

func (r LeaseWorker) runClaimedWork(ctx context.Context, lease *ama.Lease, workItem *ama.WorkItem) error {
	payload, err := protocol.ParseWorkPayload(workItem.Payload)
	if err != nil {
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if !r.supportsRequiredCapability(payload.RequiredRunnerCapability) {
		return r.failLease(ctx, lease, fmt.Errorf("runner does not advertise required capability %q", payload.RequiredRunnerCapability), nil)
	}
	if payload.Type == "session.start" {
		return r.runSessionStart(ctx, lease, payload)
	}
	return r.runTool(ctx, lease, workItem, payload)
}

func (r LeaseWorker) supportsRequiredCapability(required string) bool {
	if required == "" {
		return true
	}
	if r.CurrentCapabilities == nil {
		return false
	}
	for _, capability := range r.CurrentCapabilities() {
		if capability == required {
			return true
		}
	}
	return false
}

func (r LeaseWorker) runTool(ctx context.Context, lease *ama.Lease, workItem *ama.WorkItem, payload protocol.WorkPayload) error {
	if r.SandboxAdapter == nil {
		return r.failLease(ctx, lease, fmt.Errorf("runner sandbox adapter is not configured"), nil)
	}
	sessionID := workItemSessionID(workItem)
	if err := r.uploadSessionEvent(ctx, sessionID, string(sessionevent.EventTypeToolExecutionStart), ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"args":       payload.Input,
	}); err != nil {
		return err
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go r.renewLease(leaseCtx, lease, cancel, renewErrors, nil)

	result, execErr := r.SandboxAdapter.Execute(leaseCtx, sandbox.ToolRequest{
		ToolCallID: payload.ToolCallID,
		ToolName:   payload.ToolName,
		Input:      payload.Input,
		WorkDir:    r.Config.WorkDir,
	})
	cancel()
	if err := firstRenewError(renewErrors); err != nil {
		return err
	}

	if ctx.Err() != nil {
		return r.cancelLease(context.Background(), lease, ctx.Err())
	}
	if execErr != nil {
		_ = r.uploadSessionEvent(context.Background(), sessionID, string(sessionevent.EventTypeToolExecutionEnd), ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"error":      execErr.Error(),
			"result":     result.Output,
			"isError":    true,
		})
		return r.failLease(context.Background(), lease, execErr, result.Output)
	}
	if err := r.uploadSessionEvent(ctx, sessionID, string(sessionevent.EventTypeToolExecutionEnd), ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"result":     result.Output,
		"isError":    false,
	}); err != nil {
		return err
	}
	return r.completeLease(ctx, lease, ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"output":     result.Output,
	})
}

func (r LeaseWorker) runSessionStart(ctx context.Context, lease *ama.Lease, payload protocol.WorkPayload) error {
	if !isSupportedSessionRuntime(payload.Runtime) {
		err := fmt.Errorf("unsupported session runtime %q", payload.Runtime)
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if payload.Runtime == "ama" {
		return r.runAMASandboxSession(ctx, lease, payload)
	}
	return r.runRuntimeSession(ctx, lease, payload)
}

func isSupportedSessionRuntime(runtimeName string) bool {
	return runtimeName != ""
}

func (r LeaseWorker) runAMASandboxSession(ctx context.Context, lease *ama.Lease, payload protocol.WorkPayload) error {
	relay := r.Relay
	if relay == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if r.SandboxAdapter == nil {
		err := fmt.Errorf("runner sandbox adapter is not configured")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go r.renewLease(leaseCtx, lease, cancel, renewErrors, nil)

	workspace, err := r.prepareWorkspace(leaseCtx, payload)
	if err != nil {
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	handle := runnersession.NewSandboxHandle(payload.SessionID, workspace, r.SandboxAdapter)
	relay.Register(payload.SessionID, handle)
	if err := r.uploadSessionEvent(leaseCtx, payload.SessionID, "runner.sandbox.ready", ama.JSON{
		"sessionId": payload.SessionID,
		"runtime":   payload.Runtime,
		"executor":  r.Config.SandboxAdapter,
	}); err != nil {
		relay.Unregister(payload.SessionID)
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	err = r.completeLease(leaseCtx, lease, ama.JSON{
		"sessionId":    payload.SessionID,
		"runtime":      payload.Runtime,
		"sandboxReady": true,
		"workspace":    workspace.Cwd,
	})
	if err != nil {
		relay.Unregister(payload.SessionID)
		return err
	}
	cancel()
	if err := firstRenewError(renewErrors); err != nil && !isCompletedLeaseRenewalRace(err) {
		return err
	}
	return nil
}

func (r LeaseWorker) runRuntimeSession(ctx context.Context, lease *ama.Lease, payload protocol.WorkPayload) error {
	relay := r.Relay
	if relay == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	store, err := runnersession.OpenEventLog(filepath.Join(r.Config.WorkDir, workspace.SessionsDirName, payload.SessionID))
	if err != nil {
		if finishErr := r.failLease(ctx, lease, fmt.Errorf("open session event store: %w", err), nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	relayEvent := func(relayCtx context.Context, eventType string, eventPayload ama.JSON, stamp *runnersession.RelayStamp) error {
		relay.RelayEvent(relayCtx, payload.SessionID, eventType, eventPayload, stamp)
		return nil
	}
	handle := runnersession.NewHostHandle(payload.SessionID, func(message string) {
		if err := r.relayStoredEvent(context.Background(), store, relayEvent, "message_end", userPromptEventPayload(message)); err != nil {
			slog.Warn("runner failed to record delivered prompt event", "sessionId", payload.SessionID, "error", err)
		}
	})
	relay.Register(payload.SessionID, handle)
	defer relay.Unregister(payload.SessionID)

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	resumeTokens := &resumeTokenBox{}
	renewErrors := make(chan error, 1)
	go r.renewLease(leaseCtx, lease, cancel, renewErrors, resumeTokens)

	if err := r.relayStoredEvent(leaseCtx, store, relayEvent, "runner.session.started", r.sessionStartedPayload(payload)); err != nil {
		if finishErr := r.failLease(context.Background(), lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if prompt := initialPrompt(payload); prompt != "" {
		if err := r.relayStoredEvent(leaseCtx, store, relayEvent, "message_end", userPromptEventPayload(prompt)); err != nil {
			if finishErr := r.failLease(context.Background(), lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
	}

	workspace, workspaceErr := r.prepareWorkspace(leaseCtx, payload)
	if workspaceErr != nil {
		result := runtime.Result{Err: workspaceErr}
		writeRuntimeError := func(errPayload ama.JSON) {
			_ = r.relayStoredEvent(context.Background(), store, relayEvent, string(sessionevent.EventTypeRuntimeError), errPayload)
		}
		finalizeErr := r.finalizeRuntimeSession(leaseCtx, ctx, lease, resumeTokens, result, writeRuntimeError)
		cancel()
		if renewErr := firstRenewError(renewErrors); renewErr != nil {
			if finalizeErr == nil && isCompletedLeaseRenewalRace(renewErr) {
				return nil
			}
			return renewErr
		}
		return finalizeErr
	}

	runtimeRunner := runtime.Runner{
		Adapter:            r.RuntimeAdapter,
		RuntimeBridge:      r.RuntimeBridge,
		MaxSessionDuration: r.Config.MaxSessionDuration,
	}
	var writeMu sync.Mutex
	result := runtimeRunner.Run(leaseCtx, runtime.Request{
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
		RegisterControlSender: handle.RegisterControlSender,
	}, func(eventType string, eventPayload runtime.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return r.relayStoredEvent(leaseCtx, store, relayEvent, eventType, ama.JSON(eventPayload))
	})
	result = r.attachMemoryStores(workspace, result)
	writeRuntimeError := func(errPayload ama.JSON) {
		_ = r.relayStoredEvent(context.Background(), store, relayEvent, string(sessionevent.EventTypeRuntimeError), errPayload)
	}
	finalizeErr := r.finalizeRuntimeSession(leaseCtx, ctx, lease, resumeTokens, result, writeRuntimeError)
	cancel()
	if renewErr := firstRenewError(renewErrors); renewErr != nil {
		if finalizeErr == nil && isCompletedLeaseRenewalRace(renewErr) {
			return nil
		}
		return renewErr
	}
	return finalizeErr
}

func (r LeaseWorker) finalizeRuntimeSession(
	ctx context.Context,
	requestCtx context.Context,
	lease *ama.Lease,
	resumeTokens *resumeTokenBox,
	result runtime.Result,
	writeRuntimeError func(payload ama.JSON),
) error {
	if result.Err == nil {
		return r.completeLease(ctx, lease, result.Output)
	}
	if successfulRuntimeResult(result.Output) {
		completedResult := cloneResult(result.Output)
		completedResult["completionWarning"] = result.Err.Error()
		return r.completeLease(ctx, lease, completedResult)
	}
	if result.TimedOut {
		timeoutErr := fmt.Errorf("session exceeded max duration %s", r.Config.MaxSessionDuration)
		writeRuntimeError(ama.JSON{"error": ama.JSON{"message": timeoutErr.Error(), "code": "session_timeout"}})
		if finishErr := r.failLease(context.Background(), lease, timeoutErr, result.Output); finishErr != nil {
			return finishErr
		}
		return timeoutErr
	}
	if requestCtx.Err() != nil {
		if finishErr := r.interruptLease(context.Background(), lease, resumeTokens); finishErr != nil {
			return finishErr
		}
		return result.Err
	}
	writeRuntimeError(ama.JSON{"error": ama.JSON{"message": result.Err.Error(), "code": "runtime_failed"}})
	if finishErr := r.failLease(context.Background(), lease, result.Err, result.Output); finishErr != nil {
		return finishErr
	}
	return result.Err
}

func (r LeaseWorker) prepareWorkspace(ctx context.Context, payload protocol.WorkPayload) (*workspace.Workspace, error) {
	prepared, err := workspace.Prepare(ctx, workspace.PrepareRequest{
		WorkDir:      r.Config.WorkDir,
		SessionID:    payload.SessionID,
		ResourceRefs: payload.ResourceRefs,
		RuntimeEnv:   payload.RuntimeEnv,
	})
	if err != nil {
		return nil, err
	}
	if err := prepared.PrepareAgent(ctx, payload.Runtime, payload.AgentSnapshot); err != nil {
		_ = prepared.Cleanup(context.Background())
		return nil, err
	}
	return prepared, nil
}

func (r LeaseWorker) attachMemoryStores(prepared *workspace.Workspace, result runtime.Result) runtime.Result {
	if result.Err != nil && !successfulRuntimeResult(result.Output) {
		return result
	}
	memoryStores, err := prepared.ReadWritableMemoryStores()
	if err != nil {
		result.Err = err
		return result
	}
	if len(memoryStores) == 0 {
		return result
	}
	if result.Output == nil {
		result.Output = ama.JSON{}
	}
	result.Output["memoryStores"] = memoryStores
	return result
}

func cloneResult(value ama.JSON) ama.JSON {
	return lo.Assign(ama.JSON{}, value)
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

func initialPrompt(payload protocol.WorkPayload) string {
	if payload.InitialPrompt == nil {
		return ""
	}
	return *payload.InitialPrompt
}

func (r LeaseWorker) renewLease(ctx context.Context, lease *ama.Lease, cancel context.CancelFunc, errors chan<- error, resumeTokens *resumeTokenBox) {
	ticker := time.NewTicker(r.Config.RenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
				State:                lo.ToPtr(ama.UpdateLeaseRequestStateActive),
				LeaseDurationSeconds: lo.ToPtr(r.Config.LeaseDurationSeconds),
				ResumeToken:          lo.EmptyableToPtr(resumeTokenValue(resumeTokens)),
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

func (r LeaseWorker) uploadSessionEvent(ctx context.Context, sessionID string, eventType string, payload ama.JSON) error {
	if sessionID == "" {
		return nil
	}
	_, err := r.Client.Sessions.CreateEvents(ctx, sessionID, ama.CreateSessionEventsRequest{
		Events: []ama.SessionEventInput{{
			Type:    eventType,
			Payload: payload,
			Metadata: lo.ToPtr(ama.JSON{
				"runnerId": r.RunnerID,
				"executor": r.Config.SandboxAdapter,
			}),
		}},
	})
	return err
}

func (r LeaseWorker) completeLease(ctx context.Context, lease *ama.Lease, result ama.JSON) error {
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State:  lo.ToPtr(ama.UpdateLeaseRequestStateCompleted),
		Result: &result,
	})
	return err
}

func (r LeaseWorker) cancelLease(ctx context.Context, lease *ama.Lease, cause error) error {
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State: lo.ToPtr(ama.UpdateLeaseRequestStateCancelled),
		Error: lo.ToPtr(ama.JSON{"message": cause.Error()}),
	})
	return err
}

func (r LeaseWorker) failLease(ctx context.Context, lease *ama.Lease, failure error, output ama.JSON) error {
	body := ama.UpdateLeaseRequest{
		State: lo.ToPtr(ama.UpdateLeaseRequestStateFailed),
		Error: lo.ToPtr(ama.JSON{"message": failure.Error()}),
	}
	if output != nil {
		body.Result = lo.ToPtr(ama.JSON{"output": output})
	}
	_, err := r.Client.Leases.Update(ctx, lease.Id, body)
	return err
}

func (r LeaseWorker) interruptLease(ctx context.Context, lease *ama.Lease, resumeTokens *resumeTokenBox) error {
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State:       lo.ToPtr(ama.UpdateLeaseRequestStateInterrupted),
		ResumeToken: lo.EmptyableToPtr(resumeTokenValue(resumeTokens)),
	})
	return err
}

func (r LeaseWorker) sessionStartedPayload(payload protocol.WorkPayload) ama.JSON {
	started := ama.JSON{
		"sessionId":     payload.SessionID,
		"hostingMode":   payload.HostingMode,
		"runtime":       payload.Runtime,
		"runtimeConfig": payload.RuntimeConfig,
		"provider":      payload.Provider,
		"runtimeDriver": payload.RuntimeDriver,
		"executor":      r.Config.SandboxAdapter,
	}
	if payload.Model != "" {
		started["model"] = payload.Model
	}
	return started
}

type relaySink func(ctx context.Context, eventType string, payload ama.JSON, relay *runnersession.RelayStamp) error

func (r LeaseWorker) relayStoredEvent(ctx context.Context, store *runnersession.EventLog, relay relaySink, eventType string, payload ama.JSON) error {
	stored, err := store.Append(eventType, payload, ama.JSON{"runnerId": r.RunnerID, "executor": r.Config.SandboxAdapter})
	if err != nil {
		return err
	}
	return relay(ctx, eventType, payload, &runnersession.RelayStamp{Sequence: stored.Sequence, ID: stored.ID, CreatedAt: stored.CreatedAt})
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

func firstRenewError(errors <-chan error) error {
	select {
	case renewErr := <-errors:
		return renewErr
	default:
		return nil
	}
}

func isCompletedLeaseRenewalRace(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Runner lease is no longer active")
}

func isLeaseInactive(err error) bool {
	return err != nil && strings.Contains(err.Error(), "is no longer active")
}

func resumeTokenValue(tokens *resumeTokenBox) string {
	if tokens == nil {
		return ""
	}
	return tokens.Get()
}
