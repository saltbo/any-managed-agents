package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// --- sessionCommandRouter unit tests ---

func TestSessionCommandRouterBuffersPromptBeforeSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	router.deliverPrompt("first prompt")
	router.deliverPrompt("second prompt")

	var received []string
	router.registerPromptSender(func(message string) error {
		received = append(received, message)
		return nil
	})

	if len(received) != 2 || received[0] != "first prompt" || received[1] != "second prompt" {
		t.Fatalf("expected buffered prompts flushed on registration, got %v", received)
	}
}

func TestSessionCommandRouterDeliversPromptAfterSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1")

	var received []string
	router.registerPromptSender(func(message string) error {
		received = append(received, message)
		return nil
	})
	router.deliverPrompt("live prompt")

	if len(received) != 1 || received[0] != "live prompt" {
		t.Fatalf("expected live prompt delivered immediately, got %v", received)
	}
}

func TestSessionCommandRouterRecordsPromptAfterDelivery(t *testing.T) {
	var recorded []string
	router := newSessionCommandRouter("session_1", func(message string) {
		recorded = append(recorded, message)
	})

	var received []string
	router.registerPromptSender(func(message string) error {
		received = append(received, message)
		return nil
	})
	router.deliverPrompt("live prompt")

	if len(received) != 1 || received[0] != "live prompt" {
		t.Fatalf("expected prompt delivered, got %v", received)
	}
	if len(recorded) != 1 || recorded[0] != "live prompt" {
		t.Fatalf("expected delivered prompt recorded, got %v", recorded)
	}
}

func TestSessionCommandRouterRecordsBufferedPromptAfterDelivery(t *testing.T) {
	var recorded []string
	router := newSessionCommandRouter("session_1", func(message string) {
		recorded = append(recorded, message)
	})
	router.deliverPrompt("buffered prompt")

	router.registerPromptSender(func(message string) error {
		return nil
	})

	if len(recorded) != 1 || recorded[0] != "buffered prompt" {
		t.Fatalf("expected buffered prompt recorded after flush, got %v", recorded)
	}
}

func TestSessionCommandRouterDoesNotRecordPromptWhenDeliveryFails(t *testing.T) {
	var recorded []string
	router := newSessionCommandRouter("session_1", func(message string) {
		recorded = append(recorded, message)
	})
	router.registerPromptSender(func(message string) error {
		return errors.New("send failed")
	})
	router.deliverPrompt("failed prompt")

	if len(recorded) != 0 {
		t.Fatalf("expected failed prompt not recorded, got %v", recorded)
	}
}

func TestSessionCommandRouterBuffersStopBeforeSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	router.deliverStop("timeout")

	var received string
	router.registerStopSender(func(reason string) error {
		received = reason
		return nil
	})

	if received != "timeout" {
		t.Fatalf("expected buffered stop flushed on registration, got %q", received)
	}
}

func TestSessionCommandRouterDeliversStopAfterSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1")

	var received string
	router.registerStopSender(func(reason string) error {
		received = reason
		return nil
	})
	router.deliverStop("user cancelled")

	if received != "user cancelled" {
		t.Fatalf("expected live stop delivered immediately, got %q", received)
	}
}

func TestSessionCommandRouterBuffersPermissionBeforeSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	cmd := RunnerSessionCommand{
		PermissionID: "perm_1",
		Allowed:      true,
		Reason:       "approved",
	}
	router.deliverPermission(cmd)

	var gotID string
	var gotAllowed bool
	var gotReason string
	router.registerPermissionSender(func(permissionId string, allowed bool, reason string) error {
		gotID, gotAllowed, gotReason = permissionId, allowed, reason
		return nil
	})

	if gotID != "perm_1" || !gotAllowed || gotReason != "approved" {
		t.Fatalf("expected buffered permission flushed on registration, got id=%q allowed=%v reason=%q", gotID, gotAllowed, gotReason)
	}
}

func TestSessionCommandRouterDeliversPermissionAfterSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1")

	var gotID string
	router.registerPermissionSender(func(permissionId string, allowed bool, reason string) error {
		gotID = permissionId
		return nil
	})
	router.deliverPermission(RunnerSessionCommand{PermissionID: "perm_2", Allowed: false, Reason: "denied"})

	if gotID != "perm_2" {
		t.Fatalf("expected live permission delivered immediately, got %q", gotID)
	}
}

func TestSessionCommandRouterOnlyBuffersFirstStop(t *testing.T) {
	// Only the last stop before registration is buffered (pendingStop is *string).
	router := newSessionCommandRouter("session_1")
	router.deliverStop("first")
	router.deliverStop("second")

	var received []string
	router.registerStopSender(func(reason string) error {
		received = append(received, reason)
		return nil
	})

	if len(received) != 1 {
		t.Fatalf("expected exactly one stop flushed, got %v", received)
	}
}

// --- relayHub unit tests ---

func TestSessionCommandRouterDeliverPromptLogsWhenSendErrors(t *testing.T) {
	// deliverPrompt must not return the error — it logs a warning and moves on.
	router := newSessionCommandRouter("session_1")
	router.registerPromptSender(func(message string) error {
		return errors.New("send failed")
	})
	// Must not panic or return error — just log and continue.
	router.deliverPrompt("failing prompt")
}

func TestSessionCommandRouterDeliverStopLogsWhenSendErrors(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	router.registerStopSender(func(reason string) error {
		return errors.New("stop send failed")
	})
	router.deliverStop("abort")
}

func TestSessionCommandRouterDeliverPermissionLogsWhenSendErrors(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	router.registerPermissionSender(func(permissionId string, allowed bool, reason string) error {
		return errors.New("permission send failed")
	})
	router.deliverPermission(RunnerSessionCommand{PermissionID: "perm_err", Allowed: true})
}

func TestSessionCommandRouterRegisterPromptSenderLogsFlushError(t *testing.T) {
	// Buffer a prompt before sender is registered; flush should log the error.
	router := newSessionCommandRouter("session_1")
	router.deliverPrompt("buffered prompt")
	// registerPromptSender calls send for each buffered prompt; if it errors, log and continue.
	router.registerPromptSender(func(message string) error {
		return errors.New("flush send failed")
	})
}

func TestSessionCommandRouterRegisterStopSenderLogsFlushError(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	router.deliverStop("buffered stop")
	router.registerStopSender(func(reason string) error {
		return errors.New("stop flush failed")
	})
}

func TestSessionCommandRouterRegisterPermissionSenderLogsFlushError(t *testing.T) {
	router := newSessionCommandRouter("session_1")
	router.deliverPermission(RunnerSessionCommand{PermissionID: "perm_flush"})
	router.registerPermissionSender(func(permissionId string, allowed bool, reason string) error {
		return errors.New("permission flush failed")
	})
}

// fakeOpener is a simple RunnerChannelOpener that returns a pre-created channel.
type fakeOpener struct {
	channel *fakeRunnerSessionChannel
	err     error
}

func (f *fakeOpener) OpenRunnerChannel(_ context.Context, _ string) (RunnerSessionChannel, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.channel, nil
}

func TestRelayHubRelayEventDropsWhenNotConnected(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	// conn is nil; relayEvent must not panic and must return without writing
	hub.relayEvent(context.Background(), "session_1", "message_end", ama.JSON{"text": "hi"}, nil)
	// No assertions needed beyond "did not panic"
}

func TestRelayHubRelayEventWritesSessionTaggedFrame(t *testing.T) {
	ch := newFakeRunnerSessionChannel()
	hub := newRelayHub(&fakeOpener{channel: ch}, "runner_1", "process-unsafe", t.TempDir())
	hub.setConn(ch)

	hub.relayEvent(context.Background(), "session_42", "message_end", ama.JSON{"text": "ok"}, &relayStamp{
		sequence:  7,
		id:        "evt-7",
		createdAt: "2026-01-01T00:00:07Z",
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
	if msg["relaySequence"] != float64(7) {
		t.Fatalf("expected relaySequence 7, got %v", msg["relaySequence"])
	}
	if msg["relayId"] != "evt-7" {
		t.Fatalf("expected relayId evt-7, got %v", msg["relayId"])
	}
	event, _ := msg["event"].(map[string]any)
	if event == nil {
		t.Fatal("expected event field in frame")
	}
	if event["type"] != "message_end" {
		t.Fatalf("expected event type message_end, got %v", event["type"])
	}
}

func TestRelayHubRoutesCommandToRegisteredSession(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := newSessionCommandRouter("session_1")
	hub.register("session_1", router)

	var received string
	router.registerPromptSender(func(message string) error {
		received = message
		return nil
	})

	hub.routeCommand(RunnerChannelMessage{
		Type:      "session.command",
		SessionID: "session_1",
		Command:   RunnerSessionCommand{Type: "prompt", Message: "build it"},
	})

	if received != "build it" {
		t.Fatalf("expected prompt routed to session, got %q", received)
	}
}

func TestRelayHubRoutesStopCommandToRegisteredSession(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := newSessionCommandRouter("session_1")
	hub.register("session_1", router)

	var received string
	router.registerStopSender(func(reason string) error {
		received = reason
		return nil
	})

	hub.routeCommand(RunnerChannelMessage{
		Type:      "session.command",
		SessionID: "session_1",
		Command:   RunnerSessionCommand{Type: "stop", Reason: "user cancelled"},
	})

	if received != "user cancelled" {
		t.Fatalf("expected stop routed to session, got %q", received)
	}
}

func TestRelayHubRoutesPermissionCommandToRegisteredSession(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := newSessionCommandRouter("session_1")
	hub.register("session_1", router)

	var gotID string
	var gotAllowed bool
	router.registerPermissionSender(func(permissionId string, allowed bool, reason string) error {
		gotID, gotAllowed = permissionId, allowed
		return nil
	})

	hub.routeCommand(RunnerChannelMessage{
		Type:      "session.command",
		SessionID: "session_1",
		Command:   RunnerSessionCommand{Type: "permission_decision", PermissionID: "perm_3", Allowed: true},
	})

	if gotID != "perm_3" || !gotAllowed {
		t.Fatalf("expected permission routed to session, got id=%q allowed=%v", gotID, gotAllowed)
	}
}

func TestRelayHubDropsCommandForUnregisteredSession(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	// No session registered — must not panic
	hub.routeCommand(RunnerChannelMessage{
		Type:      "session.command",
		SessionID: "ghost_session",
		Command:   RunnerSessionCommand{Type: "prompt", Message: "hello"},
	})
}

func TestRelayHubDropsCommandWithEmptySessionID(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	// A command with no sessionId must be silently dropped
	hub.routeCommand(RunnerChannelMessage{
		Type:    "session.command",
		Command: RunnerSessionCommand{Type: "prompt", Message: "hello"},
	})
}

func TestRelayHubDropsUnknownCommandType(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := newSessionCommandRouter("session_1")
	hub.register("session_1", router)
	// Unknown command type must not panic
	hub.routeCommand(RunnerChannelMessage{
		Type:      "session.command",
		SessionID: "session_1",
		Command:   RunnerSessionCommand{Type: "unknown_cmd"},
	})
}

func TestRelayHubDropsPromptCommandWithEmptyMessage(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	router := newSessionCommandRouter("session_1")
	hub.register("session_1", router)
	var received []string
	router.registerPromptSender(func(message string) error {
		received = append(received, message)
		return nil
	})
	// Empty message must be dropped
	hub.routeCommand(RunnerChannelMessage{
		Type:      "session.command",
		SessionID: "session_1",
		Command:   RunnerSessionCommand{Type: "prompt", Message: ""},
	})
	if len(received) != 0 {
		t.Fatalf("expected empty prompt to be dropped, got %v", received)
	}
}

func TestRelayHubHandlesBackfillForCompletedSession(t *testing.T) {
	workDir := t.TempDir()
	sessionDir := filepath.Join(workDir, "sessions", "completed_session")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	logPath := sessionEventLogPath(sessionDir)
	events := []storedRunnerEvent{
		{ID: "evt_1", Sequence: 1, Type: "message_end", Payload: ama.JSON{"text": "hi"}, CreatedAt: "2026-01-01T00:00:01Z"},
		{ID: "evt_2", Sequence: 2, Type: "usage", Payload: ama.JSON{"tokens": 42}, CreatedAt: "2026-01-01T00:00:02Z"},
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

	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", workDir)
	// No live session registered — hub must serve from disk.

	conn := newFakeRunnerSessionChannel()
	hub.handleBackfillRequest(context.Background(), conn, RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventID:   "req_1",
		SessionID: "completed_session",
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

func TestRelayHubHandlesBackfillForSessionWithNoLog(t *testing.T) {
	workDir := t.TempDir()
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", workDir)

	conn := newFakeRunnerSessionChannel()
	hub.handleBackfillRequest(context.Background(), conn, RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventID:   "req_2",
		SessionID: "nonexistent_session",
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

func TestRelayHubHandlesBackfillWithEmptySessionID(t *testing.T) {
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	conn := newFakeRunnerSessionChannel()
	// Empty sessionId must return an empty events list without error
	hub.handleBackfillRequest(context.Background(), conn, RunnerChannelMessage{
		Type:    "session.backfill_request",
		EventID: "req_3",
	})
	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response even for empty sessionId, got %d", len(conn.writes))
	}
}

func TestRelayHubWaitForChannelAcceptedReturnsReadError(t *testing.T) {
	// waitForChannelAccepted must return the error when ReadJSON fails (e.g. opener returns a
	// channel that immediately errors before the accepted handshake frame).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Channel returns an error as its very first read — simulates a connection that
	// drops during the handshake phase.
	ch := newFakeRunnerSessionChannel(errors.New("handshake dropped"))
	opener := &countingOpener{channels: []*fakeRunnerSessionChannel{
		ch,
		// Second connection blocks forever so the hub doesn't loop infinitely.
		newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"}),
	}, count: new(int)}

	hub := newRelayHub(opener, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.run(ctx)
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

func TestRelayHubRelayEventLogsWhenWriteFails(t *testing.T) {
	// relayEvent must log and not panic when conn.WriteJSON returns an error.
	ch := &errWriteChannel{}
	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", t.TempDir())
	hub.setConn(ch)
	// Must not panic.
	hub.relayEvent(context.Background(), "session_1", "message_end", ama.JSON{}, nil)
}

// errWriteChannel is a RunnerSessionChannel whose WriteJSON always errors.
type errWriteChannel struct{}

func (e *errWriteChannel) ReadJSON(ctx context.Context, out any) error { return ctx.Err() }
func (e *errWriteChannel) WriteJSON(_ context.Context, _ any) error    { return errors.New("write error") }
func (e *errWriteChannel) Close(int, string) error                     { return nil }

func TestRelayHubHandlesBackfillWithReadError(t *testing.T) {
	// handleBackfillRequest must include the error in the response when readSessionEventLog fails.
	// We can trigger this with a session directory that exists as a file (not a dir), making
	// the events.jsonl path a file inside a file — which causes os.Open to fail with a non-ErrNotExist error.
	workDir := t.TempDir()
	// Create "sessions/bad_session" as a regular file (not a directory), so
	// sessionEventLogPath resolves to "sessions/bad_session/events.jsonl" which
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

	hub := newRelayHub(&fakeOpener{}, "runner_1", "test", workDir)
	conn := newFakeRunnerSessionChannel()
	hub.handleBackfillRequest(context.Background(), conn, RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventID:   "req_err",
		SessionID: "bad_session",
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

func TestRelayHubConnectsAndDisconnectsGracefully(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.channel.accepted"},
	)
	hub := newRelayHub(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())

	done := make(chan struct{})
	go func() {
		hub.run(ctx)
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

// --- v1RunnerChannelURL / v1WebSocketBaseURL tests ---

func TestV1RunnerChannelURLBuildsWSSFromHTTPS(t *testing.T) {
	url, err := v1RunnerChannelURL("https://ama.example.com", "runner_42")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	want := "wss://ama.example.com/api/v1/runners/runner_42/channel"
	if url != want {
		t.Fatalf("expected %q, got %q", want, url)
	}
}

func TestV1RunnerChannelURLBuildsWSFromHTTP(t *testing.T) {
	url, err := v1RunnerChannelURL("http://localhost:8080", "runner_1")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	want := "ws://localhost:8080/api/v1/runners/runner_1/channel"
	if url != want {
		t.Fatalf("expected %q, got %q", want, url)
	}
}

func TestV1RunnerChannelURLRejectsNonHTTPScheme(t *testing.T) {
	_, err := v1RunnerChannelURL("ftp://ama.example.com", "runner_1")
	if err == nil {
		t.Fatal("expected http/https scheme error, got nil")
	}
}

func TestV1RunnerChannelURLRejectsEmptyOrigin(t *testing.T) {
	_, err := v1RunnerChannelURL("", "runner_1")
	if err == nil {
		t.Fatal("expected empty origin error")
	}
}

func TestV1WebSocketBaseURLStripsPathAndQuery(t *testing.T) {
	base, err := v1WebSocketBaseURL("https://ama.example.com/some/path?q=1#frag")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if base != "wss://ama.example.com" {
		t.Fatalf("expected path/query stripped, got %q", base)
	}
}

func TestRelayHubReconnectsAfterConnectionDrop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// First connection drops immediately (EOF), second blocks until cancel.
	connCount := 0
	ch1 := newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.channel.accepted"},
		errors.New("connection reset"),
	)
	ch2 := newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.channel.accepted"},
	)
	opener := &countingOpener{channels: []*fakeRunnerSessionChannel{ch1, ch2}, count: &connCount}
	hub := newRelayHub(opener, "runner_1", "test", t.TempDir())
	// Shrink reconnect delay to avoid 3s wait in test.
	// We can't set the constant, but we can rely on the test waiting for 2 opens.

	go hub.run(ctx)

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

func TestRelayHubReadLoopDropsNonObjectMessages(t *testing.T) {
	// The read loop must drop JSON arrays (non-objects) without crashing.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.channel.accepted"},
		// Push a JSON array — valid JSON but not an object; readLoop must drop and continue.
		[]any{1, 2, 3},
	)
	hub := newRelayHub(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.run(ctx)
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

func TestRelayHubReadLoopIgnoresAdvisoryMessages(t *testing.T) {
	// The read loop must silently ignore runner.event.accepted and other advisory types.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.channel.accepted"},
		// Advisory frame — must hit the default: branch in the switch.
		ama.JSON{"type": "runner.event.accepted", "eventId": "evt_1"},
		// Session channel error advisory.
		ama.JSON{"type": "session.channel.error", "message": "some error"},
	)
	hub := newRelayHub(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.run(ctx)
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

func TestRelayHubWaitForChannelAcceptedDiscardsNonAcceptedFrames(t *testing.T) {
	// waitForChannelAccepted must skip frames that are not runner.channel.accepted.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeRunnerSessionChannel(
		// Unrelated frame first.
		ama.JSON{"type": "runner.event.accepted", "eventId": "stray"},
		// Accepted frame second.
		ama.JSON{"type": "runner.channel.accepted"},
	)
	hub := newRelayHub(&fakeOpener{channel: ch}, "runner_1", "test", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.run(ctx)
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
	channels []*fakeRunnerSessionChannel
	count    *int
}

func (o *countingOpener) OpenRunnerChannel(_ context.Context, _ string) (RunnerSessionChannel, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	idx := *o.count
	*o.count++
	if idx < len(o.channels) {
		return o.channels[idx], nil
	}
	return newFakeRunnerSessionChannel(), nil
}
