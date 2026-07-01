package session

import (
	"os"
	"path/filepath"
	"testing"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestEventLogAppendReadAllAndReopen(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenEventLog(dir, "session_1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i, typ := range []string{"a", "b", "c"} {
		event, err := store.Append(ama.JSON{"type": typ, "payload": ama.JSON{"i": i}})
		if err != nil {
			t.Fatalf("append: %v", err)
		}
		if event.Sequence != int64(i+1) {
			t.Fatalf("sequence = %d, want %d", event.Sequence, i+1)
		}
		if event.ID == "" {
			t.Fatal("append assigned an empty id")
		}
		if event.SessionID != "session_1" {
			t.Fatalf("append assigned session = %s, want session_1", event.SessionID)
		}
	}

	events, err := store.ReadAll()
	if err != nil {
		t.Fatalf("readall: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("len = %d, want 3", len(events))
	}
	if events[0].Event["type"] != "a" || events[2].Event["type"] != "c" {
		t.Fatalf("order wrong: %s..%s", events[0].Event["type"], events[2].Event["type"])
	}
	if events[0].Sequence != 1 || events[2].Sequence != 3 {
		t.Fatalf("sequences = %d,%d want 1,3", events[0].Sequence, events[2].Sequence)
	}

	// Reopening recovers the sequence so a resumed run keeps counting up rather
	// than restarting (the on-disk log is the source of truth).
	reopened, err := OpenEventLog(dir, "session_1")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	event, err := reopened.Append(ama.JSON{"type": "d", "payload": ama.JSON{}})
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

func TestReadEventLogReturnsNilForMissingFile(t *testing.T) {
	events, err := ReadEventLog(filepath.Join(t.TempDir(), "nonexistent.jsonl"))
	if err != nil {
		t.Fatalf("missing log file must not error, got %v", err)
	}
	if events != nil {
		t.Fatalf("missing log file must return nil events, got %v", events)
	}
}
