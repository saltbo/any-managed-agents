package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestRunOnceDispatchesCopilotRuntimeThroughAdapter(t *testing.T) {
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	client := &fakeControlPlane{lease: copilotSessionStartLease("copilot prompt"), channel: channel}
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
	if err := daemon.RunOnce(context.Background()); err != nil {
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
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].Status != "completed" {
		t.Fatalf("expected completed copilot lease update, got %#v", client.updates)
	}
	if client.updates[len(client.updates)-1].Result["providerThreadId"] != "copilot_thread_1" {
		t.Fatalf("expected adapter result to complete lease, got %#v", client.updates[len(client.updates)-1].Result)
	}
	gotTypes := channel.writtenEvents()
	for _, want := range []string{
		"runner.session.started",
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
	for _, message := range channel.writtenMessages() {
		if message["type"] != "runner.event" || message["eventId"] == "" {
			t.Fatalf("expected copilot event to use acknowledged runner event envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
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
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	client := &fakeControlPlane{lease: copilotSessionStartLease("fail"), channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 7, "stderr": "bad failure"},
		err:    errors.New("copilot SDK bridge failed"),
		events: []RuntimeEventRecord{
			{Type: "runtime.output", Payload: ama.JSON{"stream": "stderr", "content": "bad failure"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "copilot SDK bridge failed") {
		t.Fatalf("expected copilot failure to be returned, got %v", err)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].Status != "failed" {
		t.Fatalf("expected failed copilot lease update, got %#v", client.updates)
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "copilot SDK bridge failed") || !strings.Contains(serializedEvents, "bad failure") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
	failedUpdate := client.updates[len(client.updates)-1]
	if !strings.Contains(mustJSON(t, failedUpdate.Result), `"exitCode":7`) {
		t.Fatalf("expected failed lease result to include exit code, got %#v", failedUpdate.Result)
	}
}

func TestCopilotSessionStartedRejectionFailsBeforeRuntimeAdapter(t *testing.T) {
	lease := copilotSessionStartLease("start")
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	channel.eventErrors = map[string]string{"runner.session.started": "start rejected"}
	client := &fakeControlPlane{lease: lease, channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
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
	if runtimeAdapter.request.SessionID != "" {
		t.Fatalf("expected copilot adapter not to run, got %#v", runtimeAdapter.request)
	}
}

func copilotSessionStartLease(prompt string) *ama.RunnerWorkLease {
	lease := sessionStartLease()
	lease.WorkItem.Payload["runtime"] = "copilot"
	lease.WorkItem.Payload["runtimeConfig"] = map[string]any{"approvalMode": "auto"}
	lease.WorkItem.Payload["provider"] = "provider_copilot"
	lease.WorkItem.Payload["model"] = "copilot-cli"
	lease.WorkItem.Payload["runtimeDriver"] = "copilot-self-hosted"
	lease.WorkItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:copilot:*:copilot-cli"
	lease.WorkItem.Payload["initialPrompt"] = prompt
	return lease
}
