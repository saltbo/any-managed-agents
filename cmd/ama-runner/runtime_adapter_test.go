package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestClaudeCodeRuntimeAdapterPassesPromptWorkspaceConfigAndSafeEnvironment(t *testing.T) {
	t.Setenv("AMA_TOKEN", "operator-token")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "operator-secret")
	workDir := t.TempDir()
	resolvedWorkDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	adapter := ClaudeCodeRuntimeAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	var events []string
	result, err := adapter.Run(context.Background(), RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "claude-code",
		RuntimeConfig: map[string]any{"command": []any{"sh", "-c", "cat > prompt.txt; env > env.txt; printf '{\"type\":\"claude-code.message\",\"payload\":{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}}\\n'; printf stderr-line >&2"}, "mode": "test"},
		Provider:      "anthropic",
		Model:         "claude-sonnet-4-6",
		InitialPrompt: "hello claude",
		WorkDir:       workDir,
	}, func(eventType string, _ ama.JSON) error {
		events = append(events, eventType)
		return nil
	})
	if err != nil {
		t.Fatalf("expected runtime success, got %v", err)
	}
	if result["exitCode"] != 0 {
		t.Fatalf("expected exit 0, got %#v", result)
	}
	prompt, err := os.ReadFile(filepath.Join(workDir, "prompt.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(prompt) != "hello claude" {
		t.Fatalf("expected prompt on stdin, got %q", prompt)
	}
	env, err := os.ReadFile(filepath.Join(workDir, "env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	envText := string(env)
	for _, expected := range []string{
		"AMA_SESSION_ID=session_1",
		"AMA_RUNTIME=claude-code",
		"AMA_PROVIDER=anthropic",
		"AMA_MODEL=claude-sonnet-4-6",
		"AMA_WORKSPACE=" + resolvedWorkDir,
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected env %q in %q", expected, envText)
		}
	}
	for _, leaked := range []string{"operator-token", "operator-secret", "AMA_INITIAL_PROMPT=", "hello claude"} {
		if strings.Contains(envText, leaked) {
			t.Fatalf("expected safe runtime env, found %q in %q", leaked, envText)
		}
	}
	for _, expected := range []string{"claude-code.lifecycle", "claude-code.message", "claude-code.output"} {
		if !containsString(events, expected) {
			t.Fatalf("expected event %q in %v", expected, events)
		}
	}
	if got := events[len(events)-1]; got != "claude-code.lifecycle" {
		t.Fatalf("unexpected event sequence %v", events)
	}
}

func TestClaudeCodeRuntimeAdapterMapsExitFailures(t *testing.T) {
	adapter := ClaudeCodeRuntimeAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Run(context.Background(), RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "claude-code",
		RuntimeConfig: map[string]any{"command": []any{"sh", "-c", "printf bad >&2; exit 7"}},
		Provider:      "anthropic",
		Model:         "claude-sonnet-4-6",
		WorkDir:       t.TempDir(),
	}, func(string, ama.JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "exited with code 7") {
		t.Fatalf("expected exit failure, got %v", err)
	}
	if result["exitCode"] != 7 || !strings.Contains(result["stderr"].(string), "bad") {
		t.Fatalf("unexpected failure result %#v", result)
	}
}

func TestClaudeCodeRuntimeAdapterStreamsEventsBeforeProcessExit(t *testing.T) {
	workDir := t.TempDir()
	adapter := ClaudeCodeRuntimeAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	observedMessage := make(chan struct{})
	observedStdout := make(chan struct{})
	observedStderr := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := adapter.Run(context.Background(), RuntimeRequest{
			SessionID: "session_1",
			Runtime:   "claude-code",
			RuntimeConfig: map[string]any{"command": []any{
				"sh",
				"-c",
				"printf '{\"type\":\"claude-code.message\",\"payload\":{\"message\":{\"role\":\"assistant\",\"content\":\"streamed\"}}}\\n'; printf 'plain stdout\\n'; printf 'plain stderr\\n' >&2; while [ ! -f continue ]; do sleep 0.01; done",
			}},
			Provider:      "anthropic",
			Model:         "claude-sonnet-4-6",
			InitialPrompt: "hello claude",
			WorkDir:       workDir,
		}, func(eventType string, payload ama.JSON) error {
			if eventType == "claude-code.message" {
				select {
				case <-observedMessage:
				default:
					close(observedMessage)
				}
			}
			if eventType == "claude-code.output" && payload["stream"] == "stdout" && payload["content"] == "plain stdout" {
				select {
				case <-observedStdout:
				default:
					close(observedStdout)
				}
			}
			if eventType == "claude-code.output" && payload["stream"] == "stderr" && payload["content"] == "plain stderr" {
				select {
				case <-observedStderr:
				default:
					close(observedStderr)
				}
			}
			return nil
		})
		done <- err
	}()

	for name, observed := range map[string]<-chan struct{}{
		"structured stdout event": observedMessage,
		"plain stdout event":      observedStdout,
		"stderr event":            observedStderr,
	} {
		select {
		case <-observed:
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for %s before process exit", name)
		}
	}
	select {
	case err := <-done:
		t.Fatalf("runtime finished before continuation file was created: %v", err)
	default:
	}
	if err := os.WriteFile(filepath.Join(workDir, "continue"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected runtime success after continuation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for runtime completion")
	}
}

func TestClaudeCodeRuntimeAdapterStopsProcessGroupOnTimeout(t *testing.T) {
	adapter := ClaudeCodeRuntimeAdapter{CommandTimeout: 20 * time.Millisecond, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Run(context.Background(), RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "claude-code",
		RuntimeConfig: map[string]any{"command": []any{"sh", "-c", "sleep 10 & wait"}},
		Provider:      "anthropic",
		Model:         "claude-sonnet-4-6",
		WorkDir:       t.TempDir(),
	}, func(string, ama.JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("expected timeout error, got %v", err)
	}
	if result["exitCode"] == 0 {
		t.Fatalf("expected non-zero timeout result, got %#v", result)
	}
}

func TestRuntimeCommandValidatesCommandConfig(t *testing.T) {
	for _, config := range []map[string]any{
		{},
		{"command": ""},
		{"command": []any{}},
		{"command": []any{"sh", 1}},
		{"command": 123},
	} {
		if _, _, err := runtimeCommand("claude-code", config); err == nil {
			t.Fatalf("expected command validation error for %#v", config)
		}
	}
}
