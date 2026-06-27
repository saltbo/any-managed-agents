package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// resumeTokenBox shares the latest runtime resume token between the runtime adapter
// (which learns it from the bridge) and the lease renewal loop (which reports it to
// the control plane).
type resumeTokenBox struct {
	mu    sync.Mutex
	token string
}

func readWorkspaceMemoryStores(workspaceRoot string, resourceRefs []ResourceRef) ([]ama.JSON, error) {
	stores := []ama.JSON{}
	for _, resource := range resourceRefs {
		if resource.Type != "memory_store" || resource.Access != "read_write" {
			continue
		}
		mountPath := strings.TrimPrefix(resource.MountPath, "/workspace/")
		if mountPath == "" || strings.HasPrefix(mountPath, "..") {
			return nil, errors.New("invalid memory store mount path")
		}
		localRoot := filepath.Join(workspaceRoot, mountPath)
		if err := ensureUnderWorkspace(workspaceRoot, localRoot); err != nil {
			return nil, err
		}
		memories := []ama.JSON{}
		err := filepath.WalkDir(localRoot, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			relative, err := filepath.Rel(localRoot, path)
			if err != nil {
				return err
			}
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			memories = append(memories, ama.JSON{"path": filepath.ToSlash(relative), "content": string(content)})
			return nil
		})
		if os.IsNotExist(err) {
			err = nil
		}
		if err != nil {
			return nil, err
		}
		sort.Slice(memories, func(i, j int) bool {
			return memories[i]["path"].(string) < memories[j]["path"].(string)
		})
		stores = append(stores, ama.JSON{"storeId": resource.StoreID, "memories": memories})
	}
	return stores, nil
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
// Commands that arrive before the runtime registered its senders are buffered and
// flushed on registration.
type sessionCommandRouter struct {
	sessionID string

	mu               sync.Mutex
	sendControl      func(BridgeControlFrame) error
	pendingControls  []BridgeControlFrame
	recordPrompt     func(message string)
	sandboxWorkspace *PreparedWorkspace
	sandboxAdapter   SandboxAdapter
}

func newSessionCommandRouter(sessionID string, recordPrompt ...func(message string)) *sessionCommandRouter {
	router := &sessionCommandRouter{sessionID: sessionID}
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

func (r *sessionCommandRouter) deliverControl(command BridgeControlFrame) {
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

func (r *sessionCommandRouter) recordDeliveredCommand(command BridgeControlFrame) {
	if command.Type == "send" && command.Message != "" {
		r.recordDeliveredPrompt(command.Message)
	}
}

// registerControlSender is handed to the runtime adapter as
// RuntimeRequest.RegisterControlSender; buffered controls flush immediately.
func (r *sessionCommandRouter) registerControlSender(send func(BridgeControlFrame) error) {
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

func bridgeControlFrame(command RunnerSessionCommand) BridgeControlFrame {
	return BridgeControlFrame{
		Type:         command.Type,
		Message:      command.Message,
		PermissionID: command.PermissionID,
		Allowed:      command.Allowed,
		Reason:       command.Reason,
	}
}

func (r *sessionCommandRouter) registerSandbox(workspace PreparedWorkspace, adapter SandboxAdapter) {
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
	return cleanupRuntimeWorkspace(ctx, *workspace)
}

func (r *sessionCommandRouter) executeSandbox(ctx context.Context, request RunnerSandboxRequest) (ama.JSON, error) {
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
		result, err := adapter.Execute(ctx, ToolRequest{
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
		stores, err := readWorkspaceMemoryStores(workspace.Root, request.ResourceRefs)
		if err != nil {
			return nil, err
		}
		return ama.JSON{"stores": stores}, nil
	default:
		return nil, errors.New("unsupported runner sandbox request")
	}
}

// RunnerChannelOpener dials the per-runner relay channel
// (GET /api/v1/runners/{runnerId}/channel). Implemented by the same v1 opener that
// dials per-lease ama channels.
type RunnerChannelOpener interface {
	OpenRunnerChannel(ctx context.Context, runnerID string) (RunnerSessionChannel, error)
}

// relayHub owns the runner's single persistent relay channel and multiplexes every
// CLI session it hosts over it — the per-runner replacement for the per-lease
// channel. One connection, reconnecting on drop, that outlives any single lease so
// a completed session still reads while the runner is online ("runner online ⇒
// available"). The hub is the SINGLE reader of the socket: it demuxes inbound
// frames by the per-frame sessionId (a session.command → that session's live
// command router; a session.backfill_request → answered from the session's on-disk
// log, which survives the lease). Outbound, a session relays each stored event live
// and fire-and-forget — the event is already durable on disk (the cloud keeps no
// copy), so a momentary disconnect drops only the live fan, never the run.
type relayHub struct {
	opener   RunnerChannelOpener
	runnerID string
	executor string
	adapter  SandboxAdapter
	// storeDir is {WorkDir}/sessions; a session's log is storeDir/{sessionId}/events.jsonl.
	storeDir string

	// mu guards sessions. The map intentionally survives reconnect cycles: a session
	// registered before a socket drop keeps receiving commands once the channel
	// re-establishes, so a transient blip never loses command routing.
	mu       sync.Mutex
	sessions map[string]*sessionCommandRouter

	// writeMu guards conn AND serialises every write (relay events + backfill
	// responses), so the conn check and the write are atomic — a concurrent
	// reconnect cannot null the socket mid-write.
	writeMu sync.Mutex
	conn    RunnerSessionChannel
}

func newRelayHub(opener RunnerChannelOpener, runnerID string, executor string, workDir string, adapter ...SandboxAdapter) *relayHub {
	var sandboxAdapter SandboxAdapter
	if len(adapter) > 0 {
		sandboxAdapter = adapter[0]
	}
	return &relayHub{
		opener:   opener,
		runnerID: runnerID,
		executor: executor,
		adapter:  sandboxAdapter,
		storeDir: filepath.Join(workDir, runtimeSessionsDirName),
		sessions: map[string]*sessionCommandRouter{},
	}
}

const relayHubReconnectDelay = 3 * time.Second

// run maintains the channel for the runner's lifetime: dial, handshake, read until
// the socket drops, then reconnect after a short delay. A live event written while
// disconnected is dropped from the live fan (it is still on disk; the browser gets
// it on the next backfill), so a blip degrades to "history only", never a failure.
func (h *relayHub) run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		if err := h.connectAndServe(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("runner relay channel dropped; reconnecting", "runnerId", h.runnerID, "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(relayHubReconnectDelay):
		}
	}
}

func (h *relayHub) connectAndServe(ctx context.Context) error {
	conn, err := h.opener.OpenRunnerChannel(ctx, h.runnerID)
	if err != nil {
		return err
	}
	defer conn.Close(1000, "runner relay channel closed")
	if err := h.waitForChannelAccepted(ctx, conn); err != nil {
		return err
	}
	slog.Info("runner relay channel connected", "runnerId", h.runnerID)
	h.setConn(conn)
	defer h.clearConn()
	return h.readLoop(ctx, conn)
}

func (h *relayHub) waitForChannelAccepted(ctx context.Context, conn RunnerSessionChannel) error {
	for {
		var message RunnerChannelMessage
		if err := conn.ReadJSON(ctx, &message); err != nil {
			return err
		}
		if message.Type == "runner.channel.accepted" {
			return nil
		}
	}
}

func (h *relayHub) setConn(conn RunnerSessionChannel) {
	h.writeMu.Lock()
	h.conn = conn
	h.writeMu.Unlock()
}

func (h *relayHub) clearConn() {
	h.writeMu.Lock()
	h.conn = nil
	h.writeMu.Unlock()
}

func (h *relayHub) readLoop(ctx context.Context, conn RunnerSessionChannel) error {
	for {
		var raw json.RawMessage
		if err := conn.ReadJSON(ctx, &raw); err != nil {
			return err
		}
		var message RunnerChannelMessage
		if err := json.Unmarshal(raw, &message); err != nil {
			slog.Warn("runner relay message is not an object; dropping", "error", err)
			continue
		}
		switch message.Type {
		case "session.backfill_request":
			h.handleBackfillRequest(ctx, conn, message)
		case "session.command":
			h.routeCommand(message)
		case "sandbox.request":
			h.handleSandboxRequest(ctx, conn, message)
		default:
			// runner.event.accepted / session.channel.error are advisory here: events
			// are fire-and-forget; runner.channel.accepted is the handshake, already seen.
		}
	}
}

func (h *relayHub) handleSandboxRequest(ctx context.Context, conn RunnerSessionChannel, message RunnerChannelMessage) {
	response := ama.JSON{
		"type":      "sandbox.response",
		"requestId": message.RequestID,
		"sessionId": message.SessionID,
		"runnerId":  h.runnerID,
	}
	h.mu.Lock()
	router := h.sessions[message.SessionID]
	h.mu.Unlock()
	if router == nil {
		response["ok"] = false
		response["error"] = "runner sandbox session is not active"
	} else {
		result, err := router.executeSandbox(ctx, message.Request)
		if err != nil {
			response["ok"] = false
			response["error"] = err.Error()
		} else {
			response["ok"] = true
			response["result"] = result
		}
	}
	h.writeMu.Lock()
	err := conn.WriteJSON(ctx, response)
	h.writeMu.Unlock()
	if err != nil {
		slog.Warn("runner failed to write sandbox response", "sessionId", message.SessionID, "error", err)
	}
}

func (h *relayHub) routeCommand(message RunnerChannelMessage) {
	if message.SessionID == "" {
		return
	}
	h.mu.Lock()
	router := h.sessions[message.SessionID]
	h.mu.Unlock()
	if router == nil {
		// The session is not live on this runner (completed, or never ran here), so a
		// command for it cannot be delivered to a runtime handle.
		slog.Info("runner relay command for an inactive session; dropping",
			"sessionId", message.SessionID, "commandType", message.Command.Type)
		return
	}
	switch message.Command.Type {
	case "permissionDecision":
		router.deliverControl(bridgeControlFrame(message.Command))
	case "abort":
		slog.Info("runner received abort command; aborting runtime handle",
			"sessionId", message.SessionID, "reason", message.Command.Reason)
		router.deliverControl(bridgeControlFrame(message.Command))
	case "send":
		if message.Command.Message == "" {
			return
		}
		router.deliverControl(bridgeControlFrame(message.Command))
	default:
		slog.Warn("runner relay command is not a recognised type; dropping", "commandType", message.Command.Type)
	}
}

// handleBackfillRequest answers a relayed history read for one session straight from
// its on-disk log, so a completed session (no live router) still serves its whole
// transcript while the runner is online. The server canonicalises, threads, filters,
// and paginates; the runner's contract is "the whole log for that session".
func (h *relayHub) handleBackfillRequest(ctx context.Context, conn RunnerSessionChannel, message RunnerChannelMessage) {
	response := ama.JSON{
		"type":      "session.backfill_response",
		"eventId":   message.EventID,
		"sessionId": message.SessionID,
		"events":    []storedRunnerEvent{},
	}
	if message.SessionID != "" {
		events, err := readSessionEventLog(sessionEventLogPath(filepath.Join(h.storeDir, message.SessionID)))
		if err != nil {
			response["error"] = err.Error()
		} else if events != nil {
			response["events"] = events
		}
	}
	h.writeMu.Lock()
	err := conn.WriteJSON(ctx, response)
	h.writeMu.Unlock()
	if err != nil {
		slog.Warn("runner failed to write relay backfill response", "sessionId", message.SessionID, "error", err)
	}
}

// register marks a session live so the hub routes its commands; unregister on end.
// Backfill does not need registration (it reads the disk log), so a completed
// session keeps serving its history after it unregisters.
func (h *relayHub) register(sessionID string, router *sessionCommandRouter) {
	h.mu.Lock()
	h.sessions[sessionID] = router
	h.mu.Unlock()
}

func (h *relayHub) unregister(sessionID string) {
	h.mu.Lock()
	router := h.sessions[sessionID]
	delete(h.sessions, sessionID)
	h.mu.Unlock()
	if router != nil {
		if err := router.closeSandbox(context.Background()); err != nil {
			slog.Warn("runner failed to clean up sandbox workspace", "sessionId", sessionID, "error", err)
		}
	}
}

// relayEvent dispatches one stored event live to the cloud, fire-and-forget: the
// event is already durable on disk (the cloud keeps no copy), so a momentary
// disconnect drops only the live fan, never the run. The stored id/sequence/time
// ride along so the cloud fans it with the same identity the backfill serves (the
// browser dedups by them).
func (h *relayHub) relayEvent(ctx context.Context, sessionID string, eventType string, payload ama.JSON, relay *relayStamp) {
	// eventId is advisory (the server acks by it, but the runner ignores acks); the
	// store's relayId is the real dedup key the browser uses.
	message := ama.JSON{
		"type":      "runner.event",
		"sessionId": sessionID,
		"eventId":   newRunnerEventID(),
		"event": ama.JSON{
			"type":    eventType,
			"payload": payload,
			"metadata": ama.JSON{
				"runnerId": h.runnerID,
				"executor": h.executor,
			},
		},
	}
	if relay != nil {
		message["relaySequence"] = relay.sequence
		message["relayId"] = relay.id
		message["relayCreatedAt"] = relay.createdAt
	}
	// Hold writeMu across the conn check and the write so a concurrent reconnect
	// cannot null the socket mid-write. A nil conn (disconnected) drops the live fan
	// — the event is durable on disk and reaches the browser on the next backfill.
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	if h.conn == nil {
		return
	}
	if err := h.conn.WriteJSON(ctx, message); err != nil {
		slog.Warn("runner failed to relay event live", "sessionId", sessionID, "error", err)
	}
}
