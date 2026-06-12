package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
)

// resumeTokenBox shares the latest runtime resume token between the runtime
// adapter (which learns it from the bridge) and the lease renewal loop (which
// reports it to the control plane).
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

// sessionChannelRouter is the single reader of a runner session channel while
// an external runtime runs. It forwards mid-run prompt commands to the live
// runtime and hands every other message (event acks, channel errors) to the
// acknowledged event writers via routedChannel. Prompts that arrive before the
// runtime is ready to receive input are buffered and flushed on registration.
type sessionChannelRouter struct {
	channel   RunnerSessionChannel
	sessionID string
	leaseID   string
	runnerID  string

	mu                 sync.Mutex
	sendPrompt         func(message string) error
	pendingPrompts     []string
	sendStop           func(reason string) error
	pendingStop        *string
	sendPermission     func(permissionId string, allowed bool, reason string) error
	pendingPermissions []RunnerSessionCommand

	acks chan json.RawMessage
	// readErr is written by run() strictly before it closes acks, and read
	// only after a receive observes the closed channel — the channel close is
	// the happens-before edge, so no mutex is needed.
	readErr error
}

func newSessionChannelRouter(channel RunnerSessionChannel, sessionID string, leaseID string, runnerID string) *sessionChannelRouter {
	return &sessionChannelRouter{
		channel:   channel,
		sessionID: sessionID,
		leaseID:   leaseID,
		runnerID:  runnerID,
		acks:      make(chan json.RawMessage, 16),
	}
}

func (r *sessionChannelRouter) run(ctx context.Context) {
	for {
		var raw json.RawMessage
		if err := r.channel.ReadJSON(ctx, &raw); err != nil {
			r.readErr = err
			close(r.acks)
			return
		}
		var message RunnerChannelMessage
		if err := json.Unmarshal(raw, &message); err != nil {
			slog.Warn("runner session channel message is not an object; dropping", "error", err)
			continue
		}
		if message.Type != "session.command" {
			select {
			case r.acks <- raw:
			case <-ctx.Done():
				r.readErr = ctx.Err()
				close(r.acks)
				return
			}
			continue
		}
		if message.SessionID != r.sessionID || message.LeaseID != r.leaseID || message.RunnerID != r.runnerID {
			slog.Warn("runner session command ownership mismatch; dropping",
				"sessionId", message.SessionID, "leaseId", message.LeaseID, "runnerId", message.RunnerID)
			continue
		}
		if message.Command.Type == "permission_decision" {
			r.deliverPermission(message.Command)
			continue
		}
		if message.Command.Type == "stop" {
			slog.Info("runner received stop command; aborting runtime handle", "sessionId", r.sessionID, "reason", message.Command.Reason)
			r.deliverStop(message.Command.Reason)
			continue
		}
		if message.Command.Type != "prompt" || message.Command.Message == "" {
			slog.Warn("runner session command is not a live prompt; dropping", "commandType", message.Command.Type)
			continue
		}
		r.deliverPrompt(message.Command.Message)
	}
}

func (r *sessionChannelRouter) deliverPrompt(message string) {
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
	}
}

func (r *sessionChannelRouter) deliverPermission(command RunnerSessionCommand) {
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

// registerPermissionSender mirrors registerPromptSender for AMA permission
// decisions; buffered decisions flush on registration.
func (r *sessionChannelRouter) registerPermissionSender(send func(permissionId string, allowed bool, reason string) error) {
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

func (r *sessionChannelRouter) deliverStop(reason string) {
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

// registerStopSender is handed to the runtime adapter as
// RuntimeRequest.RegisterStopSender; a stop that arrived before the runtime
// was ready aborts immediately on registration.
func (r *sessionChannelRouter) registerStopSender(send func(reason string) error) {
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

// registerPromptSender is handed to the runtime adapter as
// RuntimeRequest.RegisterPromptSender; buffered prompts flush immediately.
func (r *sessionChannelRouter) registerPromptSender(send func(message string) error) {
	r.mu.Lock()
	pending := r.pendingPrompts
	r.pendingPrompts = nil
	r.sendPrompt = send
	r.mu.Unlock()
	for _, message := range pending {
		if err := send(message); err != nil {
			slog.Warn("runner failed to forward buffered prompt to live runtime", "sessionId", r.sessionID, "error", err)
		}
	}
}

func (r *sessionChannelRouter) routedChannel() RunnerSessionChannel {
	return &routedSessionChannel{router: r}
}

// routedSessionChannel exposes the router's non-command messages through the
// RunnerSessionChannel interface so the acknowledged event writers keep their
// write-then-wait-for-ack flow while the router owns the underlying reads.
type routedSessionChannel struct {
	router *sessionChannelRouter
}

func (c *routedSessionChannel) ReadJSON(ctx context.Context, out any) error {
	select {
	case raw, ok := <-c.router.acks:
		if !ok {
			return c.router.readErr
		}
		return json.Unmarshal(raw, out)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *routedSessionChannel) WriteJSON(ctx context.Context, value any) error {
	return c.router.channel.WriteJSON(ctx, value)
}

func (c *routedSessionChannel) Close(statusCode int, reason string) error {
	return c.router.channel.Close(statusCode, reason)
}
