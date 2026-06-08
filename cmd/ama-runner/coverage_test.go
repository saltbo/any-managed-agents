package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestWorkspacePathSafetyBranches(t *testing.T) {
	workDir := t.TempDir()
	root, relative, err := workspaceRootAndRelativePath(workDir, "/workspace/nested/file.txt")
	if err != nil || root == "" || relative != filepath.Join("nested", "file.txt") {
		t.Fatalf("unexpected workspace path result root=%q relative=%q err=%v", root, relative, err)
	}
	for _, path := range []string{filepath.Join(workDir, "absolute"), "..", "../outside"} {
		if _, _, err := workspaceRootAndRelativePath(workDir, path); err == nil {
			t.Fatalf("expected workspace path error for %q", path)
		}
	}
	if err := os.WriteFile(filepath.Join(workDir, "file-parent"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureWorkspaceParent(workDir, filepath.Join("file-parent", "child")); err == nil {
		t.Fatal("expected file parent error")
	}
	if runtime.GOOS != "windows" {
		outside := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(workDir, "link-parent")); err != nil {
			t.Fatal(err)
		}
		if _, err := ensureWorkspaceParent(workDir, filepath.Join("link-parent", "child")); err == nil {
			t.Fatal("expected symlink parent error")
		}
		if err := os.Symlink(filepath.Join(outside, "target"), filepath.Join(workDir, "link-file")); err != nil {
			t.Fatal(err)
		}
		if _, err := resolveWritePath(workDir, "link-file"); err == nil {
			t.Fatal("expected symlink write path error")
		}
		if err := os.Symlink(outside, filepath.Join(workDir, "read-link")); err != nil {
			t.Fatal(err)
		}
		if _, err := resolveReadPath(workDir, "read-link"); err == nil {
			t.Fatal("expected symlink read path escape error")
		}
		if err := os.Symlink(outside, filepath.Join(workDir, ".home")); err != nil {
			t.Fatal(err)
		}
		if _, err := prepareProcessEnvironmentDir(workDir, ".home"); err == nil {
			t.Fatal("expected process env symlink error")
		}
	}
	if err := ensureUnderWorkspace(workDir, filepath.Dir(workDir)); err == nil {
		t.Fatal("expected outside workspace error")
	}
}

func TestRunnerChannelAndCommandBranches(t *testing.T) {
	daemon := testDaemon(&fakeControlPlane{}, &fakeAdapter{result: ToolResult{Output: ama.JSON{"stdout": "ok"}}})
	daemon.Channels = nil
	if _, err := daemon.openRunnerSessionChannel(context.Background(), "lease_1"); err == nil {
		t.Fatal("expected missing channel opener error")
	}
	lease := sessionStartLease()
	client := &fakeControlPlane{lease: lease}
	daemon = testDaemon(client, &fakeAdapter{})
	daemon.Channels = nil
	payload, err := parseWorkPayload(lease.WorkItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := daemon.completeSessionStart(context.Background(), lease, payload); err == nil {
		t.Fatal("expected session start channel configuration error")
	}
	if len(client.updates) != 1 || client.updates[0].Status != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	daemon = testDaemon(&fakeControlPlane{}, &fakeAdapter{result: ToolResult{Output: ama.JSON{"stdout": "ok"}}})
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.event.accepted", "eventId": "unrelated"},
	)
	if err := daemon.writeAcknowledgedChannelEvent(context.Background(), channel, "runtime.metadata", ama.JSON{"status": "started"}); err != nil {
		t.Fatalf("expected acknowledged event after unrelated ack, got %v", err)
	}

	channel = newFakeRunnerSessionChannel(
		ama.JSON{"type": "runner.noop"},
		ama.JSON{"type": "session.channel.accepted", "sessionId": "other_session"},
	)
	if err := daemon.waitForChannelAccepted(context.Background(), channel, "session_1"); err == nil || !strings.Contains(err.Error(), "mismatched") {
		t.Fatalf("expected channel accepted mismatch, got %v", err)
	}

	if err := daemon.handleSessionCommand(context.Background(), newFakeRunnerSessionChannel(), RunnerSessionCommand{}); err != nil {
		t.Fatalf("expected empty command success, got %v", err)
	}
	if err := daemon.handleSessionCommand(context.Background(), newFakeRunnerSessionChannel(), RunnerSessionCommand{
		Body: RunnerRuntimeRequest{ToolCalls: []RunnerRuntimeToolCall{{ID: "call_1", Name: "sandbox.exec", Arguments: map[string]any{"command": "printf ok"}}}},
	}); err != nil {
		t.Fatalf("expected arguments fallback success, got %v", err)
	}
	for _, toolCall := range []RunnerRuntimeToolCall{
		{Name: "sandbox.exec", Input: map[string]any{"command": "printf ok"}},
		{ID: "call_1", Name: "unknown", Input: map[string]any{"command": "printf ok"}},
	} {
		err := daemon.handleSessionCommand(context.Background(), newFakeRunnerSessionChannel(), RunnerSessionCommand{
			Body: RunnerRuntimeRequest{ToolCalls: []RunnerRuntimeToolCall{toolCall}},
		})
		if err == nil {
			t.Fatalf("expected command validation error for %#v", toolCall)
		}
	}

	daemon.Adapter = &fakeAdapter{err: os.ErrPermission, result: ToolResult{Output: ama.JSON{"stderr": "denied"}}}
	channel = newFakeRunnerSessionChannel()
	if err := daemon.executeSessionToolCall(context.Background(), channel, "call_1", "sandbox.exec", map[string]any{"command": "bad"}); err != nil {
		t.Fatalf("expected failed tool event write success, got %v", err)
	}
	events := channel.writtenEvents()
	if !containsString(events, "tool_execution_start") || !containsString(events, "tool_execution_end") {
		t.Fatalf("expected failed tool events, got %v", events)
	}
}

func TestRunOnceAndChannelErrorBranches(t *testing.T) {
	client := &fakeControlPlane{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RunnerID = "runner_1"
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected nil lease to be ignored, got %v", err)
	}
	client.claimErr = os.ErrPermission
	if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected lease claim error, got %v", err)
	}

	channel := newFakeRunnerSessionChannel(os.ErrClosed)
	if err := daemon.waitForChannelAccepted(context.Background(), channel, "session_1"); err == nil {
		t.Fatal("expected channel read error")
	}
	channel = newFakeRunnerSessionChannel(os.ErrClosed)
	if err := daemon.writeAcknowledgedChannelEvent(context.Background(), channel, "runtime.metadata", ama.JSON{}); err == nil {
		t.Fatal("expected acknowledged event read context error")
	}
}

func TestMergeConfigOverrideBranches(t *testing.T) {
	base := Config{Origin: "base", Token: "base", MaxConcurrent: 1}
	override := Config{
		Origin:                "origin",
		Token:                 "token",
		EnvironmentID:         "env",
		SandboxAdapter:        processUnsafeAdapter,
		AllowUnsafeProcess:    true,
		StateDir:              "state",
		WorkDir:               "work",
		MaxConcurrent:         2,
		PollInterval:          time.Second,
		HeartbeatInterval:     2 * time.Second,
		LeaseDurationSeconds:  3,
		RenewInterval:         4 * time.Second,
		CommandTimeout:        5 * time.Second,
		ShutdownGraceInterval: 6 * time.Second,
	}
	got := mergeConfig(base, override)
	if got.Origin != "origin" ||
		got.Token != "token" ||
		got.EnvironmentID != "env" ||
		!got.AllowUnsafeProcess ||
		got.StateDir != "state" ||
		got.WorkDir != "work" ||
		got.MaxConcurrent != 2 ||
		got.PollInterval != time.Second ||
		got.HeartbeatInterval != 2*time.Second ||
		got.LeaseDurationSeconds != 3 ||
		got.RenewInterval != 4*time.Second ||
		got.CommandTimeout != 5*time.Second ||
		got.ShutdownGraceInterval != 6*time.Second {
		t.Fatalf("unexpected merged config %#v", got)
	}
}

func TestRuntimeHelperBranches(t *testing.T) {
	if got := envOr(func(string) string { return "" }, "MISSING", "fallback"); got != "fallback" {
		t.Fatalf("expected env fallback, got %q", got)
	}
	if got := envOr(func(string) string { return "value" }, "SET", "fallback"); got != "value" {
		t.Fatalf("expected env value, got %q", got)
	}
	if got := initialPrompt(WorkPayload{}); got != "" {
		t.Fatalf("expected empty initial prompt, got %q", got)
	}
	if _, err := runtimeWorkspace(filepath.Join(t.TempDir(), "missing-parent", "child"), "session_1"); err != nil {
		t.Fatalf("expected workspace creation success, got %v", err)
	}
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runtimeWorkspace(fileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace root file error")
	}
}

func TestParseWorkPayloadValidationBranches(t *testing.T) {
	for _, payload := range []ama.JSON{
		{"protocol": "other"},
		{"protocol": "ama-runner-work", "type": "session.start", "hostingMode": "self_hosted", "runtime": "ama", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model", "requiredRunnerCapability": "cap"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "cloud", "runtime": "ama", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model", "requiredRunnerCapability": "cap"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "self_hosted", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model", "requiredRunnerCapability": "cap"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "self_hosted", "runtime": "ama", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model"},
		{"protocol": "ama-runner-work", "type": "tool.execute", "approved": true, "toolCallId": "call_1", "toolName": "unknown", "input": map[string]any{"command": "x"}},
	} {
		if _, err := parseWorkPayload(payload); err == nil {
			t.Fatalf("expected payload validation error for %#v", payload)
		}
	}
	payload, err := parseWorkPayload(ama.JSON{
		"protocol": "ama-runner-work",
		"type":     "tool.execute",
		"toolCall": map[string]any{
			"id":        "call_1",
			"name":      "sandbox.exec",
			"arguments": map[string]any{"command": "printf ok"},
			"approved":  true,
		},
	})
	if err != nil || payload.ToolCallID != "call_1" || payload.Input["command"] != "printf ok" {
		t.Fatalf("expected nested tool call parse success, got %#v %v", payload, err)
	}
}

func TestRemainingValidationBranches(t *testing.T) {
	var exitErr *exec.ExitError
	if asExitError(os.ErrPermission, &exitErr) || exitErr != nil {
		t.Fatal("expected non-exit error not to match exec.ExitError")
	}
	if got := exitCode(os.ErrPermission); got != 1 {
		t.Fatalf("expected generic error exit code 1, got %d", got)
	}
	if _, err := runtimeWorkspace(t.TempDir(), "."); err == nil {
		t.Fatal("expected invalid session id error")
	}
}
