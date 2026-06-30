package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// fakeOpener is a simple Opener that returns a pre-created channel.
type fakeOpener struct {
	channel *fakeChannel
	err     error
}

func (f *fakeOpener) Channel(_ context.Context, _ string) (Channel, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.channel, nil
}

type fakeChannel struct {
	mu      sync.Mutex
	reads   chan any
	writes  []ama.JSON
	closed  bool
	autoAck bool
}

func newFakeChannel(reads ...any) *fakeChannel {
	channel := &fakeChannel{reads: make(chan any, 16), autoAck: true}
	for _, read := range reads {
		channel.reads <- read
	}
	return channel
}

func (ch *fakeChannel) ReadJSON(ctx context.Context, out any) error {
	select {
	case value := <-ch.reads:
		if err, ok := value.(error); ok {
			return err
		}
		data, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return json.Unmarshal(data, out)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (ch *fakeChannel) WriteJSON(_ context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded ama.JSON
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	ch.mu.Lock()
	ch.writes = append(ch.writes, decoded)
	ch.mu.Unlock()
	if decoded["type"] == "runner.event" && ch.autoAck {
		record, _ := decoded["record"].(map[string]any)
		if eventID, ok := record["id"].(string); ok && eventID != "" {
			ch.reads <- ama.JSON{"type": "runner.event.accepted", "eventId": eventID}
		}
	}
	return nil
}

func (ch *fakeChannel) Close(int, string) error {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.closed = true
	return nil
}

func TestRelayEventDropsWhenNotConnected(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	// conn is nil; relayEvent must not panic and must return without writing
	hub.RelayEvent(context.Background(), "session_1", ama.JSON{"type": "message.completed", "payload": ama.JSON{"text": "hi"}}, nil)
	// No assertions needed beyond "did not panic"
}

func TestRelayEventWritesSessionTaggedFrame(t *testing.T) {
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", "process-unsafe", t.TempDir())
	hub.setConn(ch)

	hub.RelayEvent(context.Background(), "session_42", ama.JSON{"type": "message.completed", "payload": ama.JSON{"text": "ok"}}, &RelayStamp{
		Sequence:  7,
		ID:        "evt-7",
		CreatedAt: "2026-01-01T00:00:07Z",
	})

	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 {
		t.Fatalf("expected 1 write, got %d", len(ch.writes))
	}
	msg := ch.writes[0]
	if msg["type"] != "runner.event" {
		t.Fatalf("expected runner.event frame, got %v", msg["type"])
	}
	if msg["sessionId"] != "session_42" {
		t.Fatalf("expected sessionId session_42, got %v", msg["sessionId"])
	}
	record, _ := msg["record"].(map[string]any)
	if record == nil {
		t.Fatal("expected record field in frame")
	}
	if record["sequence"] != float64(7) {
		t.Fatalf("expected record sequence 7, got %v", record["sequence"])
	}
	if record["id"] != "evt-7" {
		t.Fatalf("expected record id evt-7, got %v", record["id"])
	}
	event, _ := record["event"].(map[string]any)
	if event == nil {
		t.Fatal("expected record event field in frame")
	}
	if event["type"] != "message.completed" {
		t.Fatalf("expected event type message.completed, got %v", event["type"])
	}
}

func TestRelayRoutesCommandToRegisteredSession(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = command.Message
		return nil
	})

	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   &protocol.RunnerSessionCommand{Type: "send", Message: ptr("build it")},
	})

	if received != "build it" {
		t.Fatalf("expected prompt routed to session, got %q", received)
	}
}

func TestRelayRoutesStopCommandToRegisteredSession(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = command.Reason
		return nil
	})

	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   &protocol.RunnerSessionCommand{Type: "abort", Reason: ptr("user cancelled")},
	})

	if received != "user cancelled" {
		t.Fatalf("expected stop routed to session, got %q", received)
	}
}

func TestRelayRoutesPermissionCommandToRegisteredSession(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var gotID string
	var gotAllowed bool
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		gotID, gotAllowed = command.PermissionID, command.Allowed
		return nil
	})

	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   &protocol.RunnerSessionCommand{Type: "permissionDecision", PermissionId: ptr("perm_3"), Allowed: ptr(true)},
	})

	if gotID != "perm_3" || !gotAllowed {
		t.Fatalf("expected permission routed to session, got id=%q allowed=%v", gotID, gotAllowed)
	}
}

func TestRelayDropsCommandForUnregisteredSession(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	// No session registered — must not panic
	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("ghost_session"),
		Command:   &protocol.RunnerSessionCommand{Type: "send", Message: ptr("hello")},
	})
}

func TestRelayDropsCommandWithEmptySessionID(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	// A command with no sessionId must be silently dropped
	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:    "session.command",
		Command: &protocol.RunnerSessionCommand{Type: "send", Message: ptr("hello")},
	})
}

func TestRelayDropsUnknownCommandType(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)
	// Unknown command type must not panic
	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   &protocol.RunnerSessionCommand{Type: "unknown_cmd"},
	})
}

func TestRelayDropsPromptCommandWithEmptyMessage(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)
	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, command.Message)
		return nil
	})
	// Empty message must be dropped
	hub.routeCommand(protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   &protocol.RunnerSessionCommand{Type: "send", Message: ptr("")},
	})
	if len(received) != 0 {
		t.Fatalf("expected empty prompt to be dropped, got %v", received)
	}
}

func TestRelayHandlesBackfillForCompletedSession(t *testing.T) {
	workDir := t.TempDir()
	sessionDir := filepath.Join(workDir, "sessions", "completed_session")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	logPath := EventLogPath(sessionDir)
	events := []Event{
		{ID: "evt_1", Sequence: 1, Event: ama.JSON{"type": "message.completed", "payload": ama.JSON{"text": "hi"}}, CreatedAt: "2026-01-01T00:00:01Z"},
		{ID: "evt_2", Sequence: 2, Event: ama.JSON{"type": "usage", "payload": ama.JSON{"tokens": 42}}, CreatedAt: "2026-01-01T00:00:02Z"},
	}
	f, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range events {
		line, _ := json.Marshal(ev)
		_, _ = fmt.Fprintf(f, "%s\n", line)
	}
	f.Close()

	hub := NewRelay(&fakeOpener{}, "runner_1", "test", workDir)
	// No live session registered — hub must serve from disk.

	conn := newFakeChannel()
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventId:   ptr("req_1"),
		SessionId: ptr("completed_session"),
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response, got %d", len(conn.writes))
	}
	resp := conn.writes[0]
	if resp["type"] != "session.backfill_response" {
		t.Fatalf("expected backfill_response type, got %v", resp["type"])
	}
	if resp["sessionId"] != "completed_session" {
		t.Fatalf("expected sessionId completed_session, got %v", resp["sessionId"])
	}
	if resp["eventId"] != "req_1" {
		t.Fatalf("expected eventId req_1, got %v", resp["eventId"])
	}
	storedEventsRaw, _ := json.Marshal(resp["events"])
	if string(storedEventsRaw) == "null" || string(storedEventsRaw) == "[]" {
		t.Fatalf("expected stored events in backfill response, got %s", storedEventsRaw)
	}
}

func TestRelayHandlesBackfillForSessionWithNoLog(t *testing.T) {
	workDir := t.TempDir()
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", workDir)

	conn := newFakeChannel()
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventId:   ptr("req_2"),
		SessionId: ptr("nonexistent_session"),
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response for nonexistent session, got %d", len(conn.writes))
	}
	resp := conn.writes[0]
	if resp["type"] != "session.backfill_response" {
		t.Fatalf("expected backfill_response type, got %v", resp["type"])
	}
}

func TestRelayHandlesBackfillWithEmptySessionID(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	conn := newFakeChannel()
	// Empty sessionId must return an empty events list without error
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:    "session.backfill_request",
		EventId: ptr("req_3"),
	})
	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response even for empty sessionId, got %d", len(conn.writes))
	}
}

func TestRelayWaitForChannelAcceptedReturnsReadError(t *testing.T) {
	// waitForChannelAccepted must return the error when ReadJSON fails (e.g. opener returns a
	// channel that immediately errors before the accepted handshake frame).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Channel returns an error as its very first read — simulates a connection that
	// drops during the handshake phase.
	ch := newFakeChannel(errors.New("handshake dropped"))
	opener := &countingOpener{channels: []*fakeChannel{
		ch,
		// Second connection blocks forever so the hub doesn't loop infinitely.
		newFakeChannel(ama.JSON{"type": "runner.channel.accepted"}),
	}, count: new(int)}

	hub := NewRelay(opener, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Hub must attempt reconnect after the handshake error. Wait for second open.
	deadline := time.After(5 * time.Second)
	for {
		opener.mu.Lock()
		c := *opener.count
		opener.mu.Unlock()
		if c >= 2 {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out waiting for reconnect after handshake error")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	cancel()
	<-done
}

func TestRelayEventLogsWhenWriteFails(t *testing.T) {
	// relayEvent must log and not panic when conn.WriteJSON returns an error.
	ch := &errWriteChannel{}
	hub := NewRelay(&fakeOpener{}, "runner_1", "test", t.TempDir())
	hub.setConn(ch)
	// Must not panic.
	hub.RelayEvent(context.Background(), "session_1", ama.JSON{"type": "message.completed", "payload": ama.JSON{}}, nil)
}

// errWriteChannel is a Channel whose WriteJSON always errors.
type errWriteChannel struct{}

func (e *errWriteChannel) ReadJSON(ctx context.Context, out any) error { return ctx.Err() }
func (e *errWriteChannel) WriteJSON(_ context.Context, _ any) error    { return errors.New("write error") }
func (e *errWriteChannel) Close(int, string) error                     { return nil }

func ptr[T any](value T) *T {
	return &value
}

func TestRelayHandlesBackfillWithReadError(t *testing.T) {
	// handleBackfillRequest must include the error in the response when ReadEventLog fails.
	// We can trigger this with a session directory that exists as a file (not a dir), making
	// the events.jsonl path a file inside a file — which causes os.Open to fail with a non-ErrNotExist error.
	workDir := t.TempDir()
	// Create "sessions/bad_session" as a regular file (not a directory), so
	// EventLogPath resolves to "sessions/bad_session/events.jsonl" which
	// can't be opened because "bad_session" is a file, not a directory.
	sessionsDir := filepath.Join(workDir, "sessions")
	if err := os.MkdirAll(sessionsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// "bad_session" is a file blocking the directory path.
	badSession := filepath.Join(sessionsDir, "bad_session")
	if err := os.WriteFile(badSession, []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}

	hub := NewRelay(&fakeOpener{}, "runner_1", "test", workDir)
	conn := newFakeChannel()
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventId:   ptr("req_err"),
		SessionId: ptr("bad_session"),
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response, got %d", len(conn.writes))
	}
	resp := conn.writes[0]
	if resp["type"] != "session.backfill_response" {
		t.Fatalf("expected backfill_response, got %v", resp["type"])
	}
	if resp["error"] == nil {
		t.Fatal("expected error field in backfill response for unreadable session")
	}
}

func TestRelayConnectsAndDisconnectsGracefully(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := newFakeChannel(
		ama.JSON{"type": "runner.channel.accepted"},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())

	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Wait for hub to connect (conn becomes non-nil)
	deadline := time.After(time.Second)
	for {
		hub.mu.Lock()
		connected := hub.conn != nil
		hub.mu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for hub to connect")
		default:
			time.Sleep(time.Millisecond)
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for hub to stop")
	}
}

func TestRelayReconnectsAfterConnectionDrop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// First connection drops immediately (EOF), second blocks until cancel.
	connCount := 0
	ch1 := newFakeChannel(
		ama.JSON{"type": "runner.channel.accepted"},
		errors.New("connection reset"),
	)
	ch2 := newFakeChannel(
		ama.JSON{"type": "runner.channel.accepted"},
	)
	opener := &countingOpener{channels: []*fakeChannel{ch1, ch2}, count: &connCount}
	hub := NewRelay(opener, "runner_1", "test", t.TempDir())
	// Shrink reconnect delay to avoid 3s wait in test.
	// We can't set the constant, but we can rely on the test waiting for 2 opens.

	go hub.Run(ctx)

	deadline := time.After(5 * time.Second)
	for {
		opener.mu.Lock()
		c := connCount
		opener.mu.Unlock()
		if c >= 2 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for reconnect; got %d opens", c)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestRelayReadLoopDropsNonObjectMessages(t *testing.T) {
	// The read loop must drop JSON arrays (non-objects) without crashing.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeChannel(
		ama.JSON{"type": "runner.channel.accepted"},
		// Push a JSON array — valid JSON but not an object; readLoop must drop and continue.
		[]any{1, 2, 3},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Wait for hub to connect (non-nil conn), then cancel so the run loop exits cleanly.
	deadline := time.After(time.Second)
	for {
		hub.mu.Lock()
		connected := hub.conn != nil
		hub.mu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out: hub did not connect")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out: hub did not exit after context cancel")
	}
}

func TestRelayReadLoopIgnoresAdvisoryMessages(t *testing.T) {
	// The read loop must silently ignore runner.event.accepted and other advisory types.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeChannel(
		ama.JSON{"type": "runner.channel.accepted"},
		// Advisory frame — must hit the default: branch in the switch.
		ama.JSON{"type": "runner.event.accepted", "eventId": "evt_1"},
		// Session channel error advisory.
		ama.JSON{"type": "session.channel.error", "message": "some error"},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Wait for hub to connect, then cancel.
	deadline := time.After(time.Second)
	for {
		hub.mu.Lock()
		connected := hub.conn != nil
		hub.mu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out: hub did not connect")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out: hub did not exit after context cancel")
	}
}

func TestRelayWaitForChannelAcceptedDiscardsNonAcceptedFrames(t *testing.T) {
	// waitForChannelAccepted must skip frames that are not runner.channel.accepted.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeChannel(
		// Unrelated frame first.
		ama.JSON{"type": "runner.event.accepted", "eventId": "stray"},
		// Accepted frame second.
		ama.JSON{"type": "runner.channel.accepted"},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()
	// Hub must connect (non-nil conn) after discarding the stray frame.
	deadline := time.After(time.Second)
	for {
		hub.mu.Lock()
		connected := hub.conn != nil
		hub.mu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out: hub did not connect after discarding stray frame")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out: hub did not exit after context cancel")
	}
}

type countingOpener struct {
	mu       sync.Mutex
	channels []*fakeChannel
	count    *int
}

func (o *countingOpener) Channel(_ context.Context, _ string) (Channel, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	idx := *o.count
	*o.count++
	if idx < len(o.channels) {
		return o.channels[idx], nil
	}
	return newFakeChannel(), nil
}
