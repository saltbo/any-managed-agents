package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// storedRunnerEvent is one canonical event in the runner's local log. The id and
// sequence are assigned once at append so they stay stable across relayed reads
// (the browser dedups by them); the server canonicalises type→visibility/role,
// threads parent/correlation, and redacts on the way out.
type storedRunnerEvent struct {
	ID        string   `json:"id"`
	Sequence  int64    `json:"sequence"`
	Type      string   `json:"type"`
	Payload   ama.JSON `json:"payload"`
	Metadata  ama.JSON `json:"metadata"`
	CreatedAt string   `json:"createdAt"`
}

// sessionEventStore is the runner's local, durable, per-session event log for
// CLI relay-only runtimes (claude-code/codex/copilot, loop on the runner). Their
// events live here — the cloud keeps no copy — surviving a runner restart, and
// the cloud Session DO relays backfill reads to this store. Append-only JSONL.
type sessionEventStore struct {
	path string
	mu   sync.Mutex
	seq  int64
}

// sessionEventLogPath is the canonical on-disk log file for a session's event
// store. The relay hub serves a backfill for a completed session straight from
// this file, so the path is shared rather than re-derived.
func sessionEventLogPath(sessionDir string) string {
	return filepath.Join(sessionDir, "events.jsonl")
}

func openSessionEventStore(sessionDir string) (*sessionEventStore, error) {
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return nil, err
	}
	store := &sessionEventStore{path: sessionEventLogPath(sessionDir)}
	// Recover the latest sequence so a resumed session continues the run rather
	// than restarting the count (the on-disk log is the source of truth).
	events, err := store.readAll()
	if err != nil {
		return nil, err
	}
	if len(events) > 0 {
		store.seq = events[len(events)-1].Sequence
	}
	return store, nil
}

func newRunnerEventID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return "event_" + hex.EncodeToString(buf)
}

// Append durably records one event and returns it (with its stable id/sequence)
// so the caller can both relay it live upstream and serve it on backfill.
func (s *sessionEventStore) Append(eventType string, payload, metadata ama.JSON) (storedRunnerEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	event := storedRunnerEvent{
		ID:        newRunnerEventID(),
		Sequence:  s.seq,
		Type:      eventType,
		Payload:   payload,
		Metadata:  metadata,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	line, err := json.Marshal(event)
	if err != nil {
		return event, err
	}
	file, err := os.OpenFile(s.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return event, err
	}
	defer file.Close()
	if _, err := file.Write(append(line, '\n')); err != nil {
		return event, err
	}
	return event, nil
}

// ReadAll returns the full ordered log. The server applies the cursor/type/
// visibility filters and pagination after canonicalising, so a backfill read
// hands back every event (the runner's contract is "the whole local log").
func (s *sessionEventStore) ReadAll() ([]storedRunnerEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readAll()
}

func (s *sessionEventStore) readAll() ([]storedRunnerEvent, error) {
	return readSessionEventLog(s.path)
}

// readSessionEventLog reads a session's full ordered log straight from disk. The
// relay hub uses it to answer a backfill for a session whose live store is gone
// (the lease completed) — the events survive on disk. A missing log is an empty
// history, not an error.
func readSessionEventLog(path string) ([]storedRunnerEvent, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var events []storedRunnerEvent
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for scanner.Scan() {
		var event storedRunnerEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		events = append(events, event)
	}
	return events, scanner.Err()
}
