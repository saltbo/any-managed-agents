package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"path/filepath"
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

// sessionCommandRouter delivers mid-run commands (prompt/stop/permission) into one
// live session's runtime. The per-runner relayHub is the single reader of the shared
// runner socket and routes a session.command to the matching router by sessionId.
// Commands that arrive before the runtime registered its senders are buffered and
// flushed on registration.
type sessionCommandRouter struct {
	sessionID string

	mu                 sync.Mutex
	sendPrompt         func(message string) error
	pendingPrompts     []string
	recordPrompt       func(message string)
	sendStop           func(reason string) error
	pendingStop        *string
	sendPermission     func(permissionId string, allowed bool, reason string) error
	pendingPermissions []RunnerSessionCommand
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

func (r *sessionCommandRouter) deliverPrompt(message string) {
	r.mu.Lock()
	send := r.sendPrompt
	if send == nil {
		r.pendingPrompts = append(r.pendingPrompts, message)
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	if err := send(message); err != nil {
		slog.Warn("runner failed to forward prompt to live runtime", "sessionId", r.sessionID, "error", err)
		return
	}
	r.recordDeliveredPrompt(message)
}

func (r *sessionCommandRouter) deliverStop(reason string) {
	r.mu.Lock()
	send := r.sendStop
	if send == nil {
		r.pendingStop = &reason
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	if err := send(reason); err != nil {
		slog.Warn("runner failed to abort live runtime", "sessionId", r.sessionID, "error", err)
	}
}

func (r *sessionCommandRouter) deliverPermission(command RunnerSessionCommand) {
	r.mu.Lock()
	send := r.sendPermission
	if send == nil {
		r.pendingPermissions = append(r.pendingPermissions, command)
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	if err := send(command.PermissionID, command.Allowed, command.Reason); err != nil {
		slog.Warn("runner failed to forward permission decision to live runtime", "sessionId", r.sessionID, "error", err)
	}
}

// registerPromptSender is handed to the runtime adapter as
// RuntimeRequest.RegisterPromptSender; buffered prompts flush immediately.
func (r *sessionCommandRouter) registerPromptSender(send func(message string) error) {
	r.mu.Lock()
	pending := r.pendingPrompts
	r.pendingPrompts = nil
	r.sendPrompt = send
	r.mu.Unlock()
	for _, message := range pending {
		if err := send(message); err != nil {
			slog.Warn("runner failed to forward buffered prompt to live runtime", "sessionId", r.sessionID, "error", err)
			continue
		}
		r.recordDeliveredPrompt(message)
	}
}

// registerStopSender is handed to the runtime adapter as
// RuntimeRequest.RegisterStopSender; a stop that arrived before the runtime was
// ready aborts immediately on registration.
func (r *sessionCommandRouter) registerStopSender(send func(reason string) error) {
	r.mu.Lock()
	pending := r.pendingStop
	r.pendingStop = nil
	r.sendStop = send
	r.mu.Unlock()
	if pending != nil {
		if err := send(*pending); err != nil {
			slog.Warn("runner failed to abort live runtime for buffered stop", "sessionId", r.sessionID, "error", err)
		}
	}
}

// registerPermissionSender mirrors registerPromptSender for AMA permission
// decisions; buffered decisions flush on registration.
func (r *sessionCommandRouter) registerPermissionSender(send func(permissionId string, allowed bool, reason string) error) {
	r.mu.Lock()
	pending := r.pendingPermissions
	r.pendingPermissions = nil
	r.sendPermission = send
	r.mu.Unlock()
	for _, command := range pending {
		if err := send(command.PermissionID, command.Allowed, command.Reason); err != nil {
			slog.Warn("runner failed to forward buffered permission decision", "sessionId", r.sessionID, "error", err)
		}
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

func newRelayHub(opener RunnerChannelOpener, runnerID string, executor string, workDir string) *relayHub {
	return &relayHub{
		opener:   opener,
		runnerID: runnerID,
		executor: executor,
		storeDir: filepath.Join(workDir, "sessions"),
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
		default:
			// runner.event.accepted / session.channel.error are advisory here: events
			// are fire-and-forget; runner.channel.accepted is the handshake, already seen.
		}
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
	case "permission_decision":
		router.deliverPermission(message.Command)
	case "stop":
		slog.Info("runner received stop command; aborting runtime handle",
			"sessionId", message.SessionID, "reason", message.Command.Reason)
		router.deliverStop(message.Command.Reason)
	case "prompt":
		if message.Command.Message == "" {
			return
		}
		router.deliverPrompt(message.Command.Message)
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
	delete(h.sessions, sessionID)
	h.mu.Unlock()
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
