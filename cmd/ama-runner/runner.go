package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
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
	Config   Config
	Client   ControlPlane
	Channels RunnerSessionChannelOpener
	Adapter  SandboxAdapter
	RunnerID string
}

type WorkPayload struct {
	Protocol                 string         `json:"protocol"`
	Type                     string         `json:"type"`
	SessionID                string         `json:"sessionId"`
	HostingMode              string         `json:"hostingMode"`
	Runtime                  string         `json:"runtime"`
	RuntimeConfig            map[string]any `json:"runtimeConfig"`
	Provider                 string         `json:"provider"`
	Model                    string         `json:"model"`
	RuntimeDriver            string         `json:"runtimeDriver"`
	RequiredRunnerCapability string         `json:"requiredRunnerCapability"`
	InitialPrompt            *string        `json:"initialPrompt"`
	Approved                 bool           `json:"approved"`
	ToolCallID               string         `json:"toolCallId"`
	ToolName                 string         `json:"toolName"`
	Input                    map[string]any `json:"input"`
	ToolCall                 *ToolCall      `json:"toolCall"`
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
	ID   string               `json:"id"`
	Type string               `json:"type"`
	Path string               `json:"path"`
	Body RunnerRuntimeRequest `json:"body"`
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
	if _, err := d.Client.CheckHealth(ctx); err != nil {
		return err
	}
	runnerID, err := d.ensureRunner(ctx)
	if err != nil {
		return err
	}
	d.RunnerID = runnerID
	if err := d.heartbeat(ctx); err != nil {
		return err
	}

	heartbeatTicker := time.NewTicker(d.Config.HeartbeatInterval)
	defer heartbeatTicker.Stop()
	pollTimer := time.NewTimer(0)
	defer pollTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = d.sendOfflineHeartbeat(context.Background())
			return ctx.Err()
		case <-heartbeatTicker.C:
			if err := d.heartbeat(ctx); err != nil {
				return err
			}
		case <-pollTimer.C:
			if err := d.RunOnce(ctx); err != nil {
				return err
			}
			pollTimer.Reset(d.Config.PollInterval)
		}
	}
}

func (d *RunnerDaemon) RunOnce(ctx context.Context) error {
	if d.RunnerID == "" {
		runnerID, err := d.ensureRunner(ctx)
		if err != nil {
			return err
		}
		d.RunnerID = runnerID
	}
	if err := d.heartbeat(ctx); err != nil {
		return err
	}
	lease, err := d.Client.CreateRunnerLease(ctx, d.RunnerID, ama.ClaimRunnerLeaseRequest{
		LeaseDurationSeconds: d.Config.LeaseDurationSeconds,
	})
	if err != nil || lease == nil {
		return err
	}
	return d.executeLease(ctx, lease)
}

func (d *RunnerDaemon) ensureRunner(ctx context.Context) (string, error) {
	if d.Config.RunnerID != "" {
		return d.Config.RunnerID, nil
	}
	runner, err := d.Client.CreateRunner(ctx, ama.CreateRunnerRequest{
		Name:          d.Config.RunnerName,
		Capabilities:  d.Config.Capabilities,
		EnvironmentID: d.Config.EnvironmentID,
		MaxConcurrent: d.Config.MaxConcurrent,
		Metadata: ama.JSON{
			"sandboxAdapter": d.Config.SandboxAdapter,
		},
	})
	if err != nil {
		return "", err
	}
	return runner.ID, nil
}

func (d *RunnerDaemon) heartbeat(ctx context.Context) error {
	load := 0
	_, err := d.Client.CreateRunnerHeartbeat(ctx, d.RunnerID, ama.RunnerHeartbeatRequest{
		Status:       "active",
		Capabilities: d.Config.Capabilities,
		CurrentLoad:  &load,
		Metadata: ama.JSON{
			"sandboxAdapter": d.Config.SandboxAdapter,
			"unsafe":         true,
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
	if err := d.uploadEvent(ctx, lease, "runner.tool.started", ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
	}); err != nil {
		return err
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go d.renewLease(leaseCtx, lease, cancel, renewErrors)

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
		_ = d.uploadEvent(context.Background(), lease, "runner.tool.failed", ama.JSON{
			"toolCallId": payload.ToolCallID,
			"toolName":   payload.ToolName,
			"error":      execErr.Error(),
			"output":     result.Output,
		})
		return d.finishFailed(context.Background(), lease, execErr, result.Output)
	}
	if err := d.uploadEvent(ctx, lease, "runner.tool.completed", ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"output":     result.Output,
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
	renewErrors := make(chan error, 1)
	go d.renewLease(leaseCtx, lease, cancel, renewErrors)

	sessionStartedPayload := ama.JSON{
		"sessionId":     payload.SessionID,
		"hostingMode":   payload.HostingMode,
		"runtime":       payload.Runtime,
		"runtimeConfig": payload.RuntimeConfig,
		"provider":      payload.Provider,
		"model":         payload.Model,
		"runtimeDriver": payload.RuntimeDriver,
		"executor":      d.Config.SandboxAdapter,
	}
	writeSessionStarted := d.writeChannelEvent
	if payload.Runtime == "codex" {
		writeSessionStarted = d.writeAcknowledgedChannelEvent
	}
	if err := writeSessionStarted(leaseCtx, channel, "runner.session.started", sessionStartedPayload); err != nil {
		if finishErr := d.finishFailed(context.Background(), lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}

	if payload.Runtime == "codex" {
		err := d.runCodexSession(leaseCtx, channel, lease, payload)
		cancel()
		select {
		case renewErr := <-renewErrors:
			if renewErr != nil {
				return renewErr
			}
		default:
		}
		return err
	}

	for {
		var message RunnerChannelMessage
		if err := channel.ReadJSON(leaseCtx, &message); err != nil {
			cancel()
			select {
			case renewErr := <-renewErrors:
				if renewErr != nil {
					return renewErr
				}
			default:
			}
			if ctx.Err() != nil {
				_, updateErr := d.Client.UpdateRunnerLease(context.Background(), d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
					Status: "cancelled",
					Error:  ama.JSON{"message": ctx.Err().Error()},
				})
				return updateErr
			}
			return nil
		}
		if message.Type != "session.command" {
			continue
		}
		if message.SessionID != payload.SessionID || message.LeaseID != lease.ID || message.RunnerID != d.RunnerID {
			err := fmt.Errorf("runner session command ownership mismatch")
			cancel()
			if finishErr := d.finishFailed(context.Background(), lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
		if err := d.handleSessionCommand(leaseCtx, channel, message.Command); err != nil {
			cancel()
			if finishErr := d.finishFailed(context.Background(), lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
		select {
		case renewErr := <-renewErrors:
			if renewErr != nil {
				return renewErr
			}
		default:
		}
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
	if err := d.writeChannelEvent(ctx, channel, "runner.tool.started", ama.JSON{
		"toolCallId": toolCallID,
		"toolName":   toolName,
		"input":      input,
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
		"output":     result.Output,
		"durationMs": time.Since(startedAt).Milliseconds(),
	}
	if execErr != nil {
		payload["error"] = ama.JSON{"message": execErr.Error()}
		return d.writeChannelEvent(context.Background(), channel, "runner.tool.failed", payload)
	}
	return d.writeChannelEvent(ctx, channel, "runner.tool.completed", payload)
}

func (d *RunnerDaemon) writeChannelEvent(ctx context.Context, channel RunnerSessionChannel, eventType string, payload ama.JSON) error {
	return channel.WriteJSON(ctx, ama.JSON{
		"type": "runner.event",
		"event": ama.JSON{
			"type":    eventType,
			"payload": payload,
			"metadata": ama.JSON{
				"runnerId": d.RunnerID,
				"executor": d.Config.SandboxAdapter,
			},
		},
	})
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

func (d *RunnerDaemon) renewLease(ctx context.Context, lease *ama.RunnerWorkLease, cancel context.CancelFunc, errors chan<- error) {
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
		if parsed.Runtime == "" || parsed.Provider == "" || parsed.Model == "" || parsed.RuntimeConfig == nil {
			return WorkPayload{}, fmt.Errorf("session.start work item must include runtime, runtimeConfig, provider, and model")
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
	for _, capability := range d.Config.Capabilities {
		if capability == required {
			return true
		}
	}
	return false
}
