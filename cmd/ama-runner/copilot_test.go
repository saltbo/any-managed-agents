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

func TestRunOnceLaunchesCopilotCommandThroughSharedExternalAdapter(t *testing.T) {
	t.Setenv("AMA_TOKEN", "operator-token")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "operator-secret")
	workDir := t.TempDir()
	shim := filepath.Join(workDir, "copilot-shim.sh")
	if err := os.WriteFile(shim, []byte(`#!/bin/sh
prompt="$(cat)"
env > env.txt
printf '{"type":"copilot.lifecycle","payload":{"status":"copilot-shim-started","workspace":"%s","provider":"%s","model":"%s","runtimeConfig":%s}}\n' "$AMA_WORKSPACE" "$AMA_PROVIDER" "$AMA_MODEL" "$AMA_RUNTIME_CONFIG"
printf '{"type":"copilot.message","payload":{"message":{"role":"assistant","content":"prompt:%s"}}}\n' "$prompt"
printf '{"type":"copilot.tool.started","payload":{"toolCallId":"copilot_tool_1","toolName":"sandbox.exec","input":{"command":"printf ok"}}}\n'
printf '{"type":"copilot.tool.completed","payload":{"toolCallId":"copilot_tool_1","toolName":"sandbox.exec","output":{"stdout":"ok","stderr":"","exitCode":0},"durationMs":3}}\n'
printf '{"type":"copilot.usage","payload":{"provider":"%s","model":"%s","inputTokens":4,"outputTokens":5,"totalTokens":9}}\n' "$AMA_PROVIDER" "$AMA_MODEL"
printf 'copilot plain output\n'
printf 'copilot diagnostic\n' >&2
printf '{"type":"copilot.lifecycle","payload":{"status":"copilot-shim-completed"}}\n'
`), 0o755); err != nil {
		t.Fatal(err)
	}
	lease := copilotSessionStartLease([]any{shim}, "copilot prompt")
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	client := &fakeControlPlane{lease: lease, channel: channel}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.WorkDir = workDir
	daemon.Config.Capabilities = append(daemon.Config.Capabilities, "runtime-provider-model:copilot:provider_copilot:copilot-cli")
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected copilot run success, got %v", err)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].Status != "completed" {
		t.Fatalf("expected completed copilot lease update, got %#v", client.updates)
	}
	if len(client.events) != 0 {
		t.Fatalf("expected copilot session to write runtime events on channel without HTTP uploads, got %#v", client.events)
	}
	gotTypes := channel.writtenEvents()
	for _, want := range []string{
		"runner.session.started",
		"copilot.lifecycle",
		"copilot.message",
		"copilot.tool.started",
		"copilot.tool.completed",
		"copilot.usage",
		"copilot.output",
	} {
		if !containsString(gotTypes, want) {
			t.Fatalf("expected channel event %s in %v", want, gotTypes)
		}
	}
	for _, message := range channel.writtenMessages() {
		if message["type"] != "runner.event" || message["eventId"] == "" {
			t.Fatalf("expected copilot event to use acknowledged runner event envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
	for _, want := range []string{
		"copilot prompt",
		"provider_copilot",
		"copilot-cli",
		"copilot diagnostic",
		"copilot plain output",
	} {
		if !strings.Contains(serializedEvents, want) {
			t.Fatalf("expected %q in copilot events, got %s", want, serializedEvents)
		}
	}
	if strings.Contains(serializedEvents, "AMA_TOKEN") || strings.Contains(serializedEvents, "secret://providers") {
		t.Fatalf("expected safe copilot events, got %s", serializedEvents)
	}
	env, err := os.ReadFile(filepath.Join(workDir, "env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	envText := string(env)
	for _, want := range []string{
		"AMA_SESSION_ID=session_1",
		"AMA_RUNTIME=copilot",
		"AMA_PROVIDER=provider_copilot",
		"AMA_MODEL=copilot-cli",
		"AMA_WORKSPACE=",
	} {
		if !strings.Contains(envText, want) {
			t.Fatalf("expected env %q in %q", want, envText)
		}
	}
	for _, leaked := range []string{"operator-token", "operator-secret", "secret://providers"} {
		if strings.Contains(envText, leaked) {
			t.Fatalf("expected safe copilot environment, found %q in %q", leaked, envText)
		}
	}
}

func TestRunOnceFailsCopilotLeaseOnCommandFailure(t *testing.T) {
	workDir := t.TempDir()
	shim := filepath.Join(workDir, "copilot-fail.sh")
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nprintf 'bad failure\\n' >&2\nexit 7\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	lease := copilotSessionStartLease([]any{shim}, "fail")
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	client := &fakeControlPlane{lease: lease, channel: channel}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.WorkDir = workDir
	daemon.Config.Capabilities = append(daemon.Config.Capabilities, "runtime-provider-model:copilot:provider_copilot:copilot-cli")
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "copilot command exited with code 7") {
		t.Fatalf("expected copilot failure to be returned, got %v", err)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].Status != "failed" {
		t.Fatalf("expected failed copilot lease update, got %#v", client.updates)
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
	if !strings.Contains(serializedEvents, "copilot.error") || !strings.Contains(serializedEvents, "bad failure") {
		t.Fatalf("expected copilot error events, got %s", serializedEvents)
	}
	failedUpdate := client.updates[len(client.updates)-1]
	if !strings.Contains(mustJSON(t, failedUpdate.Result), `"exitCode":7`) {
		t.Fatalf("expected failed lease result to include exit code, got %#v", failedUpdate.Result)
	}
}

func TestCopilotSessionStartedRejectionFailsBeforeLaunch(t *testing.T) {
	workDir := t.TempDir()
	shim := filepath.Join(workDir, "copilot-shim.sh")
	if err := os.WriteFile(shim, []byte("#!/bin/sh\ntouch launched\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	lease := copilotSessionStartLease([]any{shim}, "start")
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	channel.eventErrors = map[string]string{"runner.session.started": "start rejected"}
	client := &fakeControlPlane{lease: lease, channel: channel}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.WorkDir = workDir
	daemon.Config.Capabilities = append(daemon.Config.Capabilities, "runtime-provider-model:copilot:provider_copilot:copilot-cli")
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "start rejected") {
		t.Fatalf("expected session started channel rejection, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].Status != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	if len(channel.writtenEvents()) != 1 || channel.writtenEvents()[0] != "runner.session.started" {
		t.Fatalf("expected only acknowledged session started write before failure, got %v", channel.writtenEvents())
	}
	if _, err := os.Stat(filepath.Join(workDir, "launched")); !os.IsNotExist(err) {
		t.Fatalf("expected copilot command not to launch, stat error %v", err)
	}
}

func TestExternalCommandRuntimeAdapterSupportsCopilotCommandAndTimeout(t *testing.T) {
	workDir := t.TempDir()
	adapter := ExternalCommandRuntimeAdapter{
		Runtime:               "copilot",
		CommandTimeout:        20 * time.Millisecond,
		ShutdownGraceInterval: time.Millisecond,
	}
	result, err := adapter.Run(context.Background(), RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "copilot",
		RuntimeConfig: map[string]any{"command": []any{"sh", "-c", "sleep 10 & wait"}},
		Provider:      "provider_copilot",
		Model:         "copilot-cli",
		WorkDir:       workDir,
	}, func(string, ama.JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("expected timeout error, got %v", err)
	}
	if result["exitCode"] == 0 {
		t.Fatalf("expected non-zero timeout result, got %#v", result)
	}
}

func copilotSessionStartLease(command []any, prompt string) *ama.RunnerWorkLease {
	lease := sessionStartLease()
	lease.WorkItem.Payload["runtime"] = "copilot"
	lease.WorkItem.Payload["runtimeConfig"] = map[string]any{"command": command, "mode": "deterministic-shim"}
	lease.WorkItem.Payload["provider"] = "provider_copilot"
	lease.WorkItem.Payload["model"] = "copilot-cli"
	lease.WorkItem.Payload["runtimeDriver"] = "copilot-self-hosted"
	lease.WorkItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:copilot:provider_copilot:copilot-cli"
	lease.WorkItem.Payload["initialPrompt"] = prompt
	return lease
}
