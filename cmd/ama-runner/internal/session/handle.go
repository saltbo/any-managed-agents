package session

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Handle interface {
	Close(ctx context.Context) error
}

type CommandHandler interface {
	Handle
	DeliverCommand(command protocol.RunnerSessionCommand)
}

type SandboxHandler interface {
	Handle
	ExecuteSandbox(ctx context.Context, request protocol.RunnerSandboxRequest) (ama.JSON, error)
}

type HostHandle struct {
	sessionID string

	mu              sync.Mutex
	sendControl     func(runtime.BridgeControlFrame) error
	pendingControls []runtime.BridgeControlFrame
	recordPrompt    func(message string)
}

func NewHostHandle(sessionID string, recordPrompt ...func(message string)) *HostHandle {
	handle := &HostHandle{sessionID: sessionID}
	if len(recordPrompt) > 0 {
		handle.recordPrompt = recordPrompt[0]
	}
	return handle
}

func (h *HostHandle) DeliverCommand(command protocol.RunnerSessionCommand) {
	switch command.Type {
	case "permissionDecision":
		h.deliverControl(bridgeControlFrame(command))
	case "abort":
		slog.Info("runner received abort command; aborting runtime handle",
			"sessionId", h.sessionID, "reason", protocol.CommandReason(command))
		h.deliverControl(bridgeControlFrame(command))
	case "send":
		if protocol.CommandMessage(command) == "" {
			return
		}
		h.deliverControl(bridgeControlFrame(command))
	default:
		slog.Warn("runner relay command is not a recognised type; dropping", "commandType", command.Type)
	}
}

func (h *HostHandle) Close(context.Context) error {
	return nil
}

func (h *HostHandle) recordDeliveredPrompt(message string) {
	if h.recordPrompt != nil {
		h.recordPrompt(message)
	}
}

func (h *HostHandle) deliverControl(command runtime.BridgeControlFrame) {
	h.mu.Lock()
	send := h.sendControl
	if send == nil {
		h.pendingControls = append(h.pendingControls, command)
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()
	if err := send(command); err != nil {
		slog.Warn("runner failed to forward control frame to live runtime", "sessionId", h.sessionID, "type", command.Type, "error", err)
		return
	}
	h.recordDeliveredCommand(command)
}

func (h *HostHandle) recordDeliveredCommand(command runtime.BridgeControlFrame) {
	if command.Type == "send" && command.Message != "" {
		h.recordDeliveredPrompt(command.Message)
	}
}

// RegisterControlSender is handed to the runtime adapter as
// runtime.Request.RegisterControlSender; buffered controls flush immediately.
func (h *HostHandle) RegisterControlSender(send func(runtime.BridgeControlFrame) error) {
	h.mu.Lock()
	pending := h.pendingControls
	h.pendingControls = nil
	h.sendControl = send
	h.mu.Unlock()
	for _, command := range pending {
		if err := send(command); err != nil {
			slog.Warn("runner failed to forward buffered control frame", "sessionId", h.sessionID, "type", command.Type, "error", err)
			continue
		}
		h.recordDeliveredCommand(command)
	}
}

func bridgeControlFrame(command protocol.RunnerSessionCommand) runtime.BridgeControlFrame {
	return runtime.BridgeControlFrame{
		Type:         runtime.BridgeControlType(command.Type),
		Message:      protocol.CommandMessage(command),
		PermissionID: protocol.CommandPermissionID(command),
		Allowed:      protocol.CommandAllowed(command),
		Reason:       protocol.CommandReason(command),
	}
}

type SandboxHandle struct {
	sessionID       string
	workspace       *workspace.Workspace
	workspaceClosed bool
	adapter         sandbox.SandboxAdapter
	mu              sync.Mutex
}

func NewSandboxHandle(sessionID string, prepared *workspace.Workspace, adapter sandbox.SandboxAdapter) *SandboxHandle {
	return &SandboxHandle{
		sessionID: sessionID,
		workspace: prepared,
		adapter:   adapter,
	}
}

func (h *SandboxHandle) Close(ctx context.Context) error {
	h.mu.Lock()
	if h.workspaceClosed {
		h.mu.Unlock()
		return nil
	}
	h.workspaceClosed = true
	workspace := h.workspace
	h.mu.Unlock()
	return workspace.Cleanup(ctx)
}

func (h *SandboxHandle) ExecuteSandbox(ctx context.Context, request protocol.RunnerSandboxRequest) (ama.JSON, error) {
	h.mu.Lock()
	closed := h.workspaceClosed
	workspace := h.workspace
	adapter := h.adapter
	h.mu.Unlock()
	if closed || adapter == nil {
		return nil, errors.New("runner sandbox is not registered for session")
	}
	if workspace == nil {
		return nil, errors.New("runner workspace is not registered for session")
	}
	switch protocol.SandboxRequestType(request) {
	case "sandbox.execute":
		toolCallID := protocol.SandboxRequestToolCallID(request)
		toolName := protocol.SandboxRequestToolName(request)
		started := time.Now()
		result, err := adapter.Execute(ctx, sandbox.ToolRequest{
			ToolCallID: toolCallID,
			ToolName:   toolName,
			Input:      protocol.SandboxRequestInput(request),
			WorkDir:    workspace.Cwd,
		})
		response := ama.JSON{
			"toolCallId": toolCallID,
			"toolName":   toolName,
			"output":     result.Output,
			"durationMs": time.Since(started).Milliseconds(),
		}
		if err != nil {
			response["error"] = ama.JSON{"message": err.Error()}
		}
		return response, nil
	case "sandbox.stop":
		return ama.JSON{"ok": true}, h.Close(ctx)
	case "sandbox.readMemoryStores":
		stores, err := workspace.ReadMemoryStores(protocol.SandboxRequestResourceRefs(request))
		if err != nil {
			return nil, err
		}
		return ama.JSON{"stores": stores}, nil
	default:
		return nil, errors.New("unsupported runner sandbox request")
	}
}
