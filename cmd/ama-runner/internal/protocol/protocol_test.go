package protocol

import (
	"strings"
	"testing"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestParseWorkPayloadAcceptsSessionStart(t *testing.T) {
	prompt := "hello"
	payload, err := ParseWorkPayload(ama.JSON{
		"protocol":                 "ama-runner-work",
		"type":                     "session.start",
		"sessionId":                "session_1",
		"hostingMode":              "self_hosted",
		"runtime":                  "codex",
		"provider":                 "openai",
		"runtimeConfig":            ama.JSON{"model": "gpt-5"},
		"requiredRunnerCapability": "runtime:codex",
		"initialPrompt":            prompt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.SessionID != "session_1" || payload.Runtime != "codex" || payload.InitialPrompt == nil || *payload.InitialPrompt != prompt {
		t.Fatalf("unexpected parsed payload: %#v", payload)
	}
}

func TestParseWorkPayloadNormalizesApprovedToolCall(t *testing.T) {
	payload, err := ParseWorkPayload(ama.JSON{
		"protocol": "ama-runner-work",
		"type":     "tool.execute",
		"toolCall": ama.JSON{
			"id":        "call_1",
			"name":      "sandbox.exec",
			"approved":  true,
			"arguments": ama.JSON{"command": "true"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.ToolCallID != "call_1" || payload.ToolName != "sandbox.exec" || payload.Input["command"] != "true" {
		t.Fatalf("unexpected parsed tool payload: %#v", payload)
	}
}

func TestParseWorkPayloadRejectsUnsafeToolWork(t *testing.T) {
	_, err := ParseWorkPayload(ama.JSON{
		"protocol": "ama-runner-work",
		"type":     "tool.execute",
		"toolCall": ama.JSON{
			"id":       "call_1",
			"name":     "sandbox.exec",
			"approved": false,
			"input":    ama.JSON{"command": "true"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected approval error, got %v", err)
	}
}

func TestParseWorkPayloadRejectsUnsupportedSandboxTool(t *testing.T) {
	_, err := ParseWorkPayload(ama.JSON{
		"protocol":   "ama-runner-work",
		"type":       "tool.execute",
		"approved":   true,
		"toolCallId": "call_1",
		"toolName":   "sandbox.delete",
		"input":      ama.JSON{"path": "file.txt"},
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported sandbox tool") {
		t.Fatalf("expected unsupported tool error, got %v", err)
	}
}
