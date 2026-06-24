package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestRunOnceDispatchesCopilotRuntimeThroughAdapter(t *testing.T) {
	workDir := t.TempDir()
	// Copilot is a CLI relay runtime: events flow over the per-runner hub channel,
	// not a per-lease channel. Seed the hub channel so the hub connects immediately.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: copilotSessionStartLease("copilot prompt"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0, "providerThreadId": "copilot_thread_1"},
		events: []RuntimeEventRecord{
			{Type: "runtime.metadata", Payload: ama.JSON{"data": ama.JSON{"stage": "sdk_bridge_started", "status": "running"}}},
			{Type: "message_end", Payload: ama.JSON{"message": ama.JSON{"role": "assistant", "content": []any{ama.JSON{"type": "text", "text": "copilot prompt ok"}}}}},
			{Type: "tool_execution_start", Payload: ama.JSON{"toolCallId": "copilot_tool_1", "toolName": "sandbox.exec", "input": ama.JSON{"command": "printf ok"}}},
			{Type: "tool_execution_end", Payload: ama.JSON{"toolCallId": "copilot_tool_1", "toolName": "sandbox.exec", "output": ama.JSON{"stdout": "ok", "stderr": "", "exitCode": 0}, "durationMs": 3}},
			{Type: "usage", Payload: ama.JSON{"provider": "provider_copilot", "model": "copilot-cli", "inputTokens": 4, "outputTokens": 5, "totalTokens": 9}},
			{Type: "runtime.output", Payload: ama.JSON{"stream": "bridge", "content": "copilot diagnostic"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least one event to be relayed over the hub channel.
	waitForRunnerWriteCount(t, hubChannel, 1, done)
	if err := <-done; err != nil {
		t.Fatalf("expected copilot run success, got %v", err)
	}
	if runtimeAdapter.request.Runtime != "copilot" ||
		runtimeAdapter.request.InitialPrompt != "copilot prompt" ||
		runtimeAdapter.request.Provider != "provider_copilot" ||
		runtimeAdapter.request.Model != "copilot-cli" {
		t.Fatalf("expected copilot runtime request metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.RuntimeConfig["approvalMode"] != "auto" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].State != "completed" {
		t.Fatalf("expected completed copilot lease update, got %#v", client.updates)
	}
	if client.updates[len(client.updates)-1].Result["providerThreadId"] != "copilot_thread_1" {
		t.Fatalf("expected adapter result to complete lease, got %#v", client.updates[len(client.updates)-1].Result)
	}
	gotTypes := hubChannel.writtenEvents()
	for _, want := range []string{
		"runtime.metadata",
		"message_end",
		"tool_execution_start",
		"tool_execution_end",
		"usage",
		"runtime.output",
	} {
		if !containsString(gotTypes, want) {
			t.Fatalf("expected channel event %s in %v", want, gotTypes)
		}
	}
	storedEvents, err := readSessionEventLog(sessionEventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("expected stored session events, got %v", err)
	}
	serializedStoredEvents := mustJSON(t, storedEvents)
	if !strings.Contains(serializedStoredEvents, "runner.session.started") ||
		!strings.Contains(serializedStoredEvents, `"role":"user"`) ||
		!strings.Contains(serializedStoredEvents, `"text":"copilot prompt"`) {
		t.Fatalf("expected initial prompt to be durable in runner log, got %s", serializedStoredEvents)
	}
	for _, message := range hubChannel.writtenMessages() {
		if message["type"] != "runner.event" || message["eventId"] == "" {
			t.Fatalf("expected copilot event to use runner event envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	for _, want := range []string{
		"copilot prompt ok",
		"provider_copilot",
		"copilot-cli",
		"copilot diagnostic",
	} {
		if !strings.Contains(serializedEvents, want) {
			t.Fatalf("expected %q in copilot events, got %s", want, serializedEvents)
		}
	}
	if strings.Contains(serializedEvents, "AMA_TOKEN") || strings.Contains(serializedEvents, "secret://providers") {
		t.Fatalf("expected safe copilot events, got %s", serializedEvents)
	}
}

func TestRunOnceFailsCopilotLeaseOnRuntimeAdapterFailure(t *testing.T) {
	// Copilot is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: copilotSessionStartLease("fail"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 7, "stderr": "bad failure"},
		err:    errors.New("copilot SDK bridge failed"),
		events: []RuntimeEventRecord{
			{Type: "runtime.output", Payload: ama.JSON{"stream": "stderr", "content": "bad failure"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least runner.session.started + runtime.error to be relayed.
	waitForRunnerWriteCount(t, hubChannel, 2, done)
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "copilot SDK bridge failed") {
		t.Fatalf("expected copilot failure to be returned, got %v", err)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].State != "failed" {
		t.Fatalf("expected failed copilot lease update, got %#v", client.updates)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "copilot SDK bridge failed") || !strings.Contains(serializedEvents, "bad failure") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
	failedUpdate := client.updates[len(client.updates)-1]
	if !strings.Contains(mustJSON(t, failedUpdate.Result), `"exitCode":7`) {
		t.Fatalf("expected failed lease result to include exit code, got %#v", failedUpdate.Result)
	}
}

func copilotSessionStartLease(prompt string) *fakeWork {
	lease := sessionStartLease()
	lease.workItem.Payload["runtime"] = "copilot"
	lease.workItem.Payload["runtimeConfig"] = map[string]any{"approvalMode": "auto"}
	lease.workItem.Payload["provider"] = "provider_copilot"
	lease.workItem.Payload["model"] = "copilot-cli"
	lease.workItem.Payload["runtimeDriver"] = "copilot-self-hosted"
	lease.workItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:copilot:*:copilot-cli"
	lease.workItem.Payload["initialPrompt"] = prompt
	return lease
}
