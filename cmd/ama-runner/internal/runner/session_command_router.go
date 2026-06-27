package runner

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/hostruntime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runtimeworkspace "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

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

// sessionCommandRouter delivers standard bridge control frames into one live
// session's runtime. The per-runner relayHub is the single reader of the shared
// runner socket and routes a session.command to the matching router by sessionId.
type sessionCommandRouter struct {
	sessionID string

	mu               sync.Mutex
	sendControl      func(hostruntime.BridgeControlFrame) error
	pendingControls  []hostruntime.BridgeControlFrame
	recordPrompt     func(message string)
	sandboxWorkspace *runtimeworkspace.Prepared
	workspaceManager runtimeworkspace.Manager
	sandboxAdapter   sandbox.SandboxAdapter
}

func newSessionCommandRouter(sessionID string, workspaceManager runtimeworkspace.Manager, recordPrompt ...func(message string)) *sessionCommandRouter {
	router := &sessionCommandRouter{sessionID: sessionID, workspaceManager: workspaceManager}
	if len(recordPrompt) > 0 {
		router.recordPrompt = recordPrompt[0]
	}
	return router
}

func (r *sessionCommandRouter) recordDeliveredPrompt(message string) {
	if r.recordPrompt != nil {
		r.recordPrompt(message)
	}
}

func (r *sessionCommandRouter) deliverControl(command hostruntime.BridgeControlFrame) {
	r.mu.Lock()
	send := r.sendControl
	if send == nil {
		r.pendingControls = append(r.pendingControls, command)
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	if err := send(command); err != nil {
		slog.Warn("runner failed to forward control frame to live runtime", "sessionId", r.sessionID, "type", command.Type, "error", err)
		return
	}
	r.recordDeliveredCommand(command)
}

func (r *sessionCommandRouter) recordDeliveredCommand(command hostruntime.BridgeControlFrame) {
	if command.Type == "send" && command.Message != "" {
		r.recordDeliveredPrompt(command.Message)
	}
}

// registerControlSender is handed to the runtime adapter as
// hostruntime.Request.RegisterControlSender; buffered controls flush immediately.
func (r *sessionCommandRouter) registerControlSender(send func(hostruntime.BridgeControlFrame) error) {
	r.mu.Lock()
	pending := r.pendingControls
	r.pendingControls = nil
	r.sendControl = send
	r.mu.Unlock()
	for _, command := range pending {
		if err := send(command); err != nil {
			slog.Warn("runner failed to forward buffered control frame", "sessionId", r.sessionID, "type", command.Type, "error", err)
			continue
		}
		r.recordDeliveredCommand(command)
	}
}

func bridgeControlFrame(command protocol.RunnerSessionCommand) hostruntime.BridgeControlFrame {
	return hostruntime.BridgeControlFrame{
		Type:         command.Type,
		Message:      command.Message,
		PermissionID: command.PermissionID,
		Allowed:      command.Allowed,
		Reason:       command.Reason,
	}
}

func (r *sessionCommandRouter) registerSandbox(workspace runtimeworkspace.Prepared, adapter sandbox.SandboxAdapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sandboxWorkspace = &workspace
	r.sandboxAdapter = adapter
}

func (r *sessionCommandRouter) closeSandbox(ctx context.Context) error {
	r.mu.Lock()
	workspace := r.sandboxWorkspace
	r.sandboxWorkspace = nil
	r.mu.Unlock()
	if workspace == nil {
		return nil
	}
	return r.workspaceManager.CleanupRuntime(ctx, *workspace)
}

func (r *sessionCommandRouter) executeSandbox(ctx context.Context, request protocol.RunnerSandboxRequest) (ama.JSON, error) {
	r.mu.Lock()
	workspace := r.sandboxWorkspace
	adapter := r.sandboxAdapter
	r.mu.Unlock()
	if workspace == nil || adapter == nil {
		return nil, errors.New("runner sandbox is not registered for session")
	}
	switch request.Type {
	case "sandbox.execute":
		started := time.Now()
		result, err := adapter.Execute(ctx, sandbox.ToolRequest{
			ToolCallID: request.ToolCallID,
			ToolName:   request.ToolName,
			Input:      request.Input,
			WorkDir:    workspace.Cwd,
		})
		response := ama.JSON{
			"toolCallId": request.ToolCallID,
			"toolName":   request.ToolName,
			"output":     result.Output,
			"durationMs": time.Since(started).Milliseconds(),
		}
		if err != nil {
			response["error"] = ama.JSON{"message": err.Error()}
		}
		return response, nil
	case "sandbox.stop":
		return ama.JSON{"ok": true}, r.closeSandbox(ctx)
	case "sandbox.readMemoryStores":
		stores, err := r.workspaceManager.ReadMemoryStores(workspace.Root, request.ResourceRefs)
		if err != nil {
			return nil, err
		}
		return ama.JSON{"stores": stores}, nil
	default:
		return nil, errors.New("unsupported runner sandbox request")
	}
}
