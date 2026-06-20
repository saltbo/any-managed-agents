package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestSessionEventStoreAppendReadAllAndReopen(t *testing.T) {
	dir := t.TempDir()
	store, err := openSessionEventStore(dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i, typ := range []string{"a", "b", "c"} {
		event, err := store.Append(typ, ama.JSON{"i": i}, ama.JSON{"runnerId": "r1"})
		if err != nil {
			t.Fatalf("append: %v", err)
		}
		if event.Sequence != int64(i+1) {
			t.Fatalf("sequence = %d, want %d", event.Sequence, i+1)
		}
		if event.ID == "" {
			t.Fatal("append assigned an empty id")
		}
	}

	events, err := store.ReadAll()
	if err != nil {
		t.Fatalf("readall: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("len = %d, want 3", len(events))
	}
	if events[0].Type != "a" || events[2].Type != "c" {
		t.Fatalf("order wrong: %s..%s", events[0].Type, events[2].Type)
	}
	if events[0].Sequence != 1 || events[2].Sequence != 3 {
		t.Fatalf("sequences = %d,%d want 1,3", events[0].Sequence, events[2].Sequence)
	}

	// Reopening recovers the sequence so a resumed run keeps counting up rather
	// than restarting (the on-disk log is the source of truth).
	reopened, err := openSessionEventStore(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	event, err := reopened.Append("d", ama.JSON{}, nil)
	if err != nil {
		t.Fatalf("append after reopen: %v", err)
	}
	if event.Sequence != 4 {
		t.Fatalf("reopened sequence = %d, want 4", event.Sequence)
	}
	if _, err := os.Stat(filepath.Join(dir, "events.jsonl")); err != nil {
		t.Fatalf("durable log missing: %v", err)
	}
}

func waitForBackfillResponse(t *testing.T, channel *fakeRunnerSessionChannel) ama.JSON {
	t.Helper()
	for i := 0; i < 200; i++ {
		channel.mu.Lock()
		for _, write := range channel.writes {
			if write["type"] == "session.backfill_response" {
				channel.mu.Unlock()
				return write
			}
		}
		channel.mu.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("no backfill response written")
	return nil
}

func TestRouterAnswersBackfillFromStore(t *testing.T) {
	store, _ := openSessionEventStore(t.TempDir())
	store.Append("runtime.output", ama.JSON{"text": "hello"}, ama.JSON{"runnerId": "runner-1"})
	store.Append("runtime.output", ama.JSON{"text": "world"}, ama.JSON{"runnerId": "runner-1"})

	channel := newFakeRunnerSessionChannel()
	router := newSessionChannelRouter(channel, "sess-1", "lease-1", "runner-1", store)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go router.run(ctx)

	channel.push(ama.JSON{
		"type": "session.backfill_request", "eventId": "req-1",
		"sessionId": "sess-1", "leaseId": "lease-1", "runnerId": "runner-1",
	})

	response := waitForBackfillResponse(t, channel)
	if response["eventId"] != "req-1" {
		t.Fatalf("eventId = %v, want req-1", response["eventId"])
	}
	events, ok := response["events"].([]any)
	if !ok || len(events) != 2 {
		t.Fatalf("events = %v, want 2 entries", response["events"])
	}
}

func TestRouterDropsBackfillOwnershipMismatch(t *testing.T) {
	store, _ := openSessionEventStore(t.TempDir())
	store.Append("runtime.output", ama.JSON{"text": "hello"}, nil)

	channel := newFakeRunnerSessionChannel()
	router := newSessionChannelRouter(channel, "sess-1", "lease-1", "runner-1", store)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go router.run(ctx)

	// Wrong leaseId — a different lease must not be able to read this session.
	channel.push(ama.JSON{
		"type": "session.backfill_request", "eventId": "req-x",
		"sessionId": "sess-1", "leaseId": "OTHER", "runnerId": "runner-1",
	})
	time.Sleep(50 * time.Millisecond)
	channel.mu.Lock()
	defer channel.mu.Unlock()
	for _, write := range channel.writes {
		if write["type"] == "session.backfill_response" {
			t.Fatal("answered a backfill request from a mismatched lease")
		}
	}
}
