package runtime

import (
	"bufio"
	"errors"
	"strings"
	"testing"
)

func TestBridgeProtocolReadsReadyEventsResultsErrorsAndLogs(t *testing.T) {
	protocol := bridgeProtocol{}
	output := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"resumeToken","requestId":"run_session_1","resumeToken":"thread_1"}`,
		`{"type":"sessionEvent","requestId":"run_session_1","eventType":"message_end","payload":{"message":{"role":"assistant","content":"ok"}}}`,
		`{"type":"resumeToken","requestId":"other","resumeToken":"ignored"}`,
		`{"type":"sessionEvent","requestId":"run_session_1","eventType":"runtime.output","payload":{"stream":"bridge","content":"bridge diagnostic"}}`,
		`{"type":"sessionEvent","requestId":"other","eventType":"message_end","payload":{"message":{"role":"assistant","content":"ignored"}}}`,
		`{"type":"result","requestId":"run_session_1","result":{"exitCode":0,"providerThreadId":"thread_1"}}`,
	}, "\n")
	scanner := protocol.scanner(strings.NewReader(output))
	if err := protocol.waitReady(scanner); err != nil {
		t.Fatalf("expected bridge ready, got %v", err)
	}
	var events []string
	var resumeTokens []string
	result, err := protocol.readResult(scanner, "run_session_1", func(eventType string, payload JSON) error {
		events = append(events, eventType+":"+mustJSON(t, payload))
		return nil
	}, func(resumeToken string) {
		resumeTokens = append(resumeTokens, resumeToken)
	})
	if err != nil {
		t.Fatalf("expected bridge messages, got %v", err)
	}
	if len(events) != 2 || !strings.Contains(events[0], "message_end") || !strings.Contains(events[1], "bridge diagnostic") {
		t.Fatalf("expected forwarded event and log, got %v", events)
	}
	if len(resumeTokens) != 1 || resumeTokens[0] != "thread_1" {
		t.Fatalf("expected scoped resume token callback, got %v", resumeTokens)
	}
	if result["providerThreadId"] != "thread_1" {
		t.Fatalf("expected bridge result, got %#v", result)
	}
}

func TestBridgeProtocolErrorBranches(t *testing.T) {
	protocol := bridgeProtocol{}
	if err := protocol.waitReady(bufio.NewScanner(strings.NewReader(`{"type":"log"}` + "\n"))); err == nil || !strings.Contains(err.Error(), "did not send ready") {
		t.Fatalf("expected ready error, got %v", err)
	}
	scanner := protocol.scanner(strings.NewReader(strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"sessionEvent","requestId":"run_session_1","payload":{}}`,
	}, "\n")))
	if err := protocol.waitReady(scanner); err != nil {
		t.Fatal(err)
	}
	if _, err := protocol.readResult(scanner, "run_session_1", func(string, JSON) error { return nil }, nil); err == nil || !strings.Contains(err.Error(), "missing type") {
		t.Fatalf("expected missing event type error, got %v", err)
	}
	scanner = protocol.scanner(strings.NewReader(`{"type":"error","requestId":"run_session_1","error":{"message":"sdk failed"}}` + "\n"))
	if _, err := protocol.readResult(scanner, "run_session_1", func(string, JSON) error { return nil }, nil); err == nil || !strings.Contains(err.Error(), "sdk failed") {
		t.Fatalf("expected bridge error, got %v", err)
	}
	writeErr := errors.New("write failed")
	scanner = protocol.scanner(strings.NewReader(`{"type":"sessionEvent","requestId":"run_session_1","eventType":"runtime.output","payload":{"content":"diag"}}` + "\n"))
	if _, err := protocol.readResult(scanner, "run_session_1", func(string, JSON) error { return writeErr }, nil); !errors.Is(err, writeErr) {
		t.Fatalf("expected writer error, got %v", err)
	}
	scanner = protocol.scanner(strings.NewReader(`{"type":"sessionEvent","requestId":"other","eventType":"message_end","payload":{}}` + "\n"))
	if _, err := protocol.readResult(scanner, "run_session_1", func(string, JSON) error { return nil }, nil); err == nil || !strings.Contains(err.Error(), "exited before result") {
		t.Fatalf("expected missing result error, got %v", err)
	}
}

func TestBridgeProtocolControlFrame(t *testing.T) {
	got := bridgeProtocol{}.controlFrame("run_1", BridgeControlFrame{
		Type:         "permissionDecision",
		PermissionID: "perm_1",
		Allowed:      true,
		Reason:       "ok",
	})
	if got.RequestID != "run_1" || got.PermissionID != "perm_1" || got.Allowed != true || got.Reason != "ok" {
		t.Fatalf("unexpected control frame %#v", got)
	}
}

func TestBridgeProtocolParsesInventorySnapshot(t *testing.T) {
	snapshot, err := bridgeProtocol{}.inventorySnapshot(JSON{
		"runtimes": []any{
			map[string]any{
				"runtime":        "codex",
				"binary":         "codex",
				"installed":      true,
				"fallbackModels": []any{"gpt-5.3-codex"},
				"models":         []any{"gpt-5.3-codex", "gpt-5.3-codex-mini"},
				"status":         "ready",
				"version":        "bridge-test",
				"detail":         "ready",
				"usageWindows": []any{
					map[string]any{"label": "5-Hour", "utilization": 50, "resetsAt": "2026-01-01T00:00:00Z"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected inventory snapshot, got %v", err)
	}
	if len(snapshot.Runtimes) != 1 || snapshot.Runtimes[0].Runtime != "codex" {
		t.Fatalf("unexpected snapshot %#v", snapshot)
	}
	if len(snapshot.Runtimes[0].Models) != 2 || len(snapshot.Runtimes[0].UsageWindows) != 1 {
		t.Fatalf("expected parsed models and usage windows, got %#v", snapshot.Runtimes[0])
	}
}

func TestBridgeProtocolRejectsInventorySnapshotMissingRuntime(t *testing.T) {
	_, err := bridgeProtocol{}.inventorySnapshot(JSON{"runtimes": []any{map[string]any{"binary": "codex"}}})
	if err == nil || !strings.Contains(err.Error(), "missing runtime") {
		t.Fatalf("expected missing runtime error, got %v", err)
	}
}
