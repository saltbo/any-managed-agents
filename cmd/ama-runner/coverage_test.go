package main

import (
	"bytes"
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

func TestRuntimeHelperBranches(t *testing.T) {
	command, args, err := runtimeCommand("copilot", map[string]any{"command": "copilot --model test"})
	if err != nil || command != "copilot" || strings.Join(args, " ") != "--model test" {
		t.Fatalf("unexpected string command parse: %q %#v %v", command, args, err)
	}
	command, args, err = runtimeCommand("copilot", map[string]any{"command": []string{"copilot", "run"}})
	if err != nil || command != "copilot" || strings.Join(args, " ") != "run" {
		t.Fatalf("unexpected []string command parse: %q %#v %v", command, args, err)
	}
	for _, config := range []map[string]any{
		{"command": []string{}},
		{"command": []string{""}},
		{"command": []any{"copilot", ""}},
	} {
		if _, _, err := runtimeCommand("copilot", config); err == nil {
			t.Fatalf("expected command validation error for %#v", config)
		}
	}

	workDir := t.TempDir()
	if _, err := runtimeCommandEnvironment(RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "copilot",
		RuntimeConfig: map[string]any{"bad": make(chan int)},
		WorkDir:       workDir,
	}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected runtime config marshal error, got %v", err)
	}
	fileWorkDir := filepath.Join(workDir, "file")
	if err := os.WriteFile(fileWorkDir, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runtimeCommandEnvironment(RuntimeRequest{RuntimeConfig: map[string]any{}, WorkDir: fileWorkDir}); err == nil {
		t.Fatal("expected process environment error for file workdir")
	}
	if _, err := runtimeWorkspace(filepath.Join(workDir, "missing")); err == nil {
		t.Fatal("expected runtime workspace symlink error")
	}
}

func TestRuntimeEventParsingAndStreamingBranches(t *testing.T) {
	if _, _, ok := runtimeEventFromLine("{"); ok {
		t.Fatal("expected invalid JSON not to parse as runtime event")
	}
	if _, _, ok := runtimeEventFromLine(`{"payload":{"message":"missing type"}}`); ok {
		t.Fatal("expected missing type not to parse as runtime event")
	}
	eventType, payload, ok := runtimeEventFromLine(`{"type":"copilot.output","stream":"stdout","content":"top-level"}`)
	if !ok || eventType != "copilot.output" || payload["content"] != "top-level" {
		t.Fatalf("unexpected top-level event parse %q %#v %v", eventType, payload, ok)
	}

	var output bytes.Buffer
	var events []string
	err := streamRuntimeOutput(strings.NewReader("plain\n"), &output, "copilot", "stdout", func(eventType string, payload ama.JSON) error {
		events = append(events, eventType+":"+payload["content"].(string))
		return nil
	})
	if err != nil || output.String() != "plain\n" || !containsString(events, "copilot.output:plain") {
		t.Fatalf("unexpected plain stdout stream result output=%q events=%v err=%v", output.String(), events, err)
	}
	err = streamRuntimeOutput(strings.NewReader("line\n"), &bytes.Buffer{}, "copilot", "stderr", func(string, ama.JSON) error {
		return os.ErrPermission
	})
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected stream writer error, got %v", err)
	}
}

func TestExternalCommandRuntimeAdapterErrorBranches(t *testing.T) {
	workDir := t.TempDir()
	adapter := ExternalCommandRuntimeAdapter{Runtime: "copilot", CommandTimeout: 0}
	_, err := adapter.Run(context.Background(), RuntimeRequest{
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"command": []any{"sh", "-c", "exit 0"}},
		WorkDir:       workDir,
	}, func(string, ama.JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "unsupported external runtime") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
	_, err = adapter.Run(context.Background(), RuntimeRequest{
		Runtime:       "copilot",
		RuntimeConfig: map[string]any{},
		WorkDir:       workDir,
	}, func(string, ama.JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "runtimeConfig.command") {
		t.Fatalf("expected command validation error, got %v", err)
	}
	_, err = adapter.Run(context.Background(), RuntimeRequest{
		Runtime:       "copilot",
		RuntimeConfig: map[string]any{"command": []any{"sh", "-c", "exit 0"}},
		WorkDir:       filepath.Join(workDir, "missing"),
	}, func(string, ama.JSON) error { return nil })
	if err == nil {
		t.Fatal("expected workspace error")
	}

	shim := filepath.Join(workDir, "stream.sh")
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nprintf plain\\n\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	result, err := adapter.Run(context.Background(), RuntimeRequest{
		Runtime:       "copilot",
		RuntimeConfig: map[string]any{"command": []any{shim}},
		WorkDir:       workDir,
	}, func(eventType string, _ ama.JSON) error {
		if eventType == "copilot.output" {
			return os.ErrPermission
		}
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "permission denied") || result["error"] == nil {
		t.Fatalf("expected stream writer error result, got result=%#v err=%v", result, err)
	}
	result, err = adapter.Run(context.Background(), RuntimeRequest{
		Runtime:       "copilot",
		RuntimeConfig: map[string]any{"command": []any{shim}},
		WorkDir:       workDir,
	}, func(eventType string, _ ama.JSON) error {
		if eventType == "copilot.lifecycle" {
			return os.ErrPermission
		}
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "permission denied") || result != nil {
		t.Fatalf("expected lifecycle writer error before result, got result=%#v err=%v", result, err)
	}
}

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
	if err := daemon.writeAcknowledgedChannelEvent(context.Background(), channel, "copilot.lifecycle", ama.JSON{"status": "started"}); err != nil {
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
	if !containsString(events, "runner.tool.started") || !containsString(events, "runner.tool.failed") {
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
	if err := daemon.writeAcknowledgedChannelEvent(context.Background(), channel, "copilot.lifecycle", ama.JSON{}); err == nil {
		t.Fatal("expected acknowledged event read context error")
	}
}

func TestMergeConfigOverrideBranches(t *testing.T) {
	base := Config{Origin: "base", Token: "base", MaxConcurrent: 1}
	override := Config{
		Origin:                "origin",
		Token:                 "token",
		RunnerID:              "runner",
		RunnerName:            "name",
		EnvironmentID:         "env",
		Capabilities:          []string{"cap"},
		SandboxAdapter:        processUnsafeAdapter,
		AllowUnsafeProcess:    true,
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
		got.RunnerID != "runner" ||
		got.RunnerName != "name" ||
		got.EnvironmentID != "env" ||
		got.Capabilities[0] != "cap" ||
		!got.AllowUnsafeProcess ||
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

func TestCodexHelperBranches(t *testing.T) {
	if got := envOr(func(string) string { return "" }, "MISSING", "fallback"); got != "fallback" {
		t.Fatalf("expected env fallback, got %q", got)
	}
	if got := envOr(func(string) string { return "value" }, "SET", "fallback"); got != "value" {
		t.Fatalf("expected env value, got %q", got)
	}
	if args, err := stringSliceConfig(nil); err != nil || args != nil {
		t.Fatalf("expected nil args success, got %#v %v", args, err)
	}
	for _, value := range []any{[]string{"not-any"}, []any{"ok", 1}} {
		if _, err := stringSliceConfig(value); err == nil {
			t.Fatalf("expected string slice validation error for %#v", value)
		}
	}
	if _, err := codexCommandFromRuntimeConfig(map[string]any{"command": "codex", "args": []any{1}}); err == nil {
		t.Fatal("expected codex args validation error")
	}
	if got := initialPrompt(WorkPayload{}); got != "" {
		t.Fatalf("expected empty initial prompt, got %q", got)
	}
	if _, err := prepareSessionWorkspace(filepath.Join(t.TempDir(), "missing-parent", "child"), "session_1"); err != nil {
		t.Fatalf("expected workspace creation success, got %v", err)
	}
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareSessionWorkspace(fileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace root file error")
	}
	if _, err := codexProcessEnvironment(t.TempDir(), WorkPayload{RuntimeConfig: map[string]any{"bad": make(chan int)}}); err == nil {
		t.Fatal("expected codex runtime config marshal error")
	}
	var events []string
	if err := writeCodexStdoutLine(`{"type":"codex.lifecycle"}`, func(eventType string, payload ama.JSON) error {
		events = append(events, eventType)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !containsString(events, "codex.lifecycle") {
		t.Fatalf("expected codex lifecycle event, got %v", events)
	}
	writer := newCodexEventWriter("stderr", func(eventType string, payload ama.JSON) error {
		events = append(events, eventType+":"+payload["content"].(string))
		return nil
	})
	if _, err := writer.Write([]byte("pending stderr")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	if !containsString(events, "codex.output:pending stderr") {
		t.Fatalf("expected pending stderr flush event, got %v", events)
	}
	errWriter := newCodexEventWriter("stdout", func(string, ama.JSON) error { return os.ErrPermission })
	if _, err := errWriter.Write([]byte("bad\nignored\n")); err == nil {
		t.Fatal("expected writer error")
	}
	if _, err := errWriter.Write([]byte("more\n")); err == nil {
		t.Fatal("expected stored writer error")
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
	if _, _, err := runtimeCommand("copilot", map[string]any{"command": "   "}); err == nil {
		t.Fatal("expected blank command string error")
	}
	if _, err := codexCommandFromRuntimeConfig(map[string]any{}); err == nil {
		t.Fatal("expected missing codex command error")
	}
	if _, err := prepareSessionWorkspace(t.TempDir(), "."); err == nil {
		t.Fatal("expected invalid session id error")
	}
}
