package session

import (
	"context"
	"encoding/json"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Channel interface {
	ReadJSON(ctx context.Context, out any) error
	WriteJSON(ctx context.Context, value any) error
	Close(statusCode int, reason string) error
}

// Opener dials the per-runner relay channel
// (GET /api/v1/runners/{runnerId}/channel). Implemented by the same v1 opener that
// dials per-lease ama channels.
type Opener interface {
	OpenRunnerChannel(ctx context.Context, runnerID string) (Channel, error)
}

// Relay owns the runner's single persistent relay channel and multiplexes every
// CLI session it hosts over it — the per-runner replacement for the per-lease
// channel. One connection, reconnecting on drop, that outlives any single lease so
// a completed session still reads while the runner is online ("runner online ⇒
// available"). The relay is the SINGLE reader of the socket: it demuxes inbound
// frames by the per-frame sessionId (a session.command → that session's live
// handle; a session.backfill_request → answered from the session's on-disk
// log, which survives the lease). Outbound, a session relays each stored event live
// and fire-and-forget — the event is already durable on disk (the cloud keeps no
// copy), so a momentary disconnect drops only the live fan, never the run.
type Relay struct {
	opener   Opener
	runnerID string
	executor string
	// storeDir is {WorkDir}/sessions; a session's log is storeDir/{sessionId}/events.jsonl.
	storeDir string

	// mu guards sessions. The map intentionally survives reconnect cycles: a session
	// registered before a socket drop keeps receiving commands once the channel
	// re-establishes, so a transient blip never loses command routing.
	mu       sync.Mutex
	sessions map[string]Handle

	// writeMu guards conn AND serialises every write (relay events + backfill
	// responses), so the conn check and the write are atomic — a concurrent
	// reconnect cannot null the socket mid-write.
	writeMu sync.Mutex
	conn    Channel
}

type RelayStamp struct {
	Sequence  int64
	ID        string
	CreatedAt string
}

func NewRelay(opener Opener, runnerID string, executor string, workDir string) *Relay {
	return &Relay{
		opener:   opener,
		runnerID: runnerID,
		executor: executor,
		storeDir: filepath.Join(workDir, workspace.SessionsDirName),
		sessions: map[string]Handle{},
	}
}

const relayReconnectDelay = 3 * time.Second

// run maintains the channel for the runner's lifetime: dial, handshake, read until
// the socket drops, then reconnect after a short delay. A live event written while
// disconnected is dropped from the live fan (it is still on disk; the browser gets
// it on the next backfill), so a blip degrades to "history only", never a failure.
func (h *Relay) Run(ctx context.Context) {
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
		case <-time.After(relayReconnectDelay):
		}
	}
}

func (h *Relay) connectAndServe(ctx context.Context) error {
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

func (h *Relay) waitForChannelAccepted(ctx context.Context, conn Channel) error {
	for {
		var message protocol.RunnerChannelMessage
		if err := conn.ReadJSON(ctx, &message); err != nil {
			return err
		}
		if message.Type == "runner.channel.accepted" {
			return nil
		}
	}
}

func (h *Relay) setConn(conn Channel) {
	h.writeMu.Lock()
	h.conn = conn
	h.writeMu.Unlock()
}

func (h *Relay) clearConn() {
	h.writeMu.Lock()
	h.conn = nil
	h.writeMu.Unlock()
}

func (h *Relay) readLoop(ctx context.Context, conn Channel) error {
	for {
		var raw json.RawMessage
		if err := conn.ReadJSON(ctx, &raw); err != nil {
			return err
		}
		var message protocol.RunnerChannelMessage
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

func (h *Relay) handleSandboxRequest(ctx context.Context, conn Channel, message protocol.RunnerChannelMessage) {
	sessionID := protocol.MessageSessionID(message)
	request := protocol.MessageSandboxRequest(message)
	response := ama.JSON{
		"type":      "sandbox.response",
		"requestId": protocol.MessageRequestID(message),
		"sessionId": sessionID,
		"runnerId":  h.runnerID,
	}
	h.mu.Lock()
	router := h.sessions[sessionID]
	h.mu.Unlock()
	if router == nil {
		response["ok"] = false
		response["error"] = "runner sandbox session is not active"
	} else {
		sandboxHandler, ok := router.(SandboxHandler)
		if !ok {
			response["ok"] = false
			response["error"] = "runner session does not accept sandbox requests"
			h.writeResponse(ctx, conn, response, "runner failed to write sandbox response", sessionID)
			return
		}
		result, err := sandboxHandler.ExecuteSandbox(ctx, request)
		if err != nil {
			response["ok"] = false
			response["error"] = err.Error()
		} else {
			response["ok"] = true
			response["result"] = result
		}
	}
	h.writeResponse(ctx, conn, response, "runner failed to write sandbox response", sessionID)
}

func (h *Relay) routeCommand(message protocol.RunnerChannelMessage) {
	sessionID := protocol.MessageSessionID(message)
	command := protocol.MessageCommand(message)
	if sessionID == "" {
		return
	}
	h.mu.Lock()
	router := h.sessions[sessionID]
	h.mu.Unlock()
	if router == nil {
		// The session is not live on this runner (completed, or never ran here), so a
		// command for it cannot be delivered to a runtime handle.
		slog.Info("runner relay command for an inactive session; dropping",
			"sessionId", sessionID, "commandType", command.Type)
		return
	}
	commandHandler, ok := router.(CommandHandler)
	if !ok {
		slog.Info("runner relay command for session without command handler; dropping",
			"sessionId", sessionID, "commandType", command.Type)
		return
	}
	commandHandler.DeliverCommand(command)
}

// handleBackfillRequest answers a relayed history read for one session straight from
// its on-disk log, so a completed session (no live router) still serves its whole
// transcript while the runner is online. The server canonicalises, threads, filters,
// and paginates; the runner's contract is "the whole log for that session".
func (h *Relay) handleBackfillRequest(ctx context.Context, conn Channel, message protocol.RunnerChannelMessage) {
	sessionID := protocol.MessageSessionID(message)
	response := ama.JSON{
		"type":      "session.backfill_response",
		"eventId":   protocol.MessageEventID(message),
		"sessionId": sessionID,
		"events":    []Event{},
	}
	if sessionID != "" {
		events, err := ReadEventLog(EventLogPath(filepath.Join(h.storeDir, sessionID)))
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
		slog.Warn("runner failed to write relay backfill response", "sessionId", sessionID, "error", err)
	}
}

func (h *Relay) writeResponse(ctx context.Context, conn Channel, response ama.JSON, message string, sessionID string) {
	h.writeMu.Lock()
	err := conn.WriteJSON(ctx, response)
	h.writeMu.Unlock()
	if err != nil {
		slog.Warn(message, "sessionId", sessionID, "error", err)
	}
}

// register marks a session live so the hub routes its commands; unregister on end.
// Backfill does not need registration (it reads the disk log), so a completed
// session keeps serving its history after it unregisters.
func (h *Relay) Register(sessionID string, handle Handle) {
	h.mu.Lock()
	h.sessions[sessionID] = handle
	h.mu.Unlock()
}

func (h *Relay) Unregister(sessionID string) {
	h.mu.Lock()
	handle := h.sessions[sessionID]
	delete(h.sessions, sessionID)
	h.mu.Unlock()
	if handle != nil {
		if err := handle.Close(context.Background()); err != nil {
			slog.Warn("runner failed to clean up sandbox workspace", "sessionId", sessionID, "error", err)
		}
	}
}

// RelayEvent dispatches one stored event live to the cloud, fire-and-forget: the
// event is already durable on disk (the cloud keeps no copy), so a momentary
// disconnect drops only the live fan, never the run. The stored id/sequence/time
// ride along so the cloud fans it with the same identity the backfill serves (the
// browser dedups by them).
func (h *Relay) RelayEvent(ctx context.Context, sessionID string, eventType string, payload ama.JSON, relay *RelayStamp) {
	eventID, err := newEventID()
	if err != nil {
		slog.Warn("runner failed to create relay event id", "sessionId", sessionID, "error", err)
		return
	}
	// eventId is advisory (the server acks by it, but the runner ignores acks); the
	// store's relayId is the real dedup key the browser uses.
	message := ama.JSON{
		"type":      "runner.event",
		"sessionId": sessionID,
		"eventId":   eventID,
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
		message["relaySequence"] = relay.Sequence
		message["relayId"] = relay.ID
		message["relayCreatedAt"] = relay.CreatedAt
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
