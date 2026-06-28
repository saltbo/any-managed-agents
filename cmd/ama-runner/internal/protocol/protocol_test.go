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

func TestParseWorkPayloadNormalizesNestedToolCallInput(t *testing.T) {
	payload, err := ParseWorkPayload(ama.JSON{
		"protocol": "ama-runner-work",
		"type":     "tool.execute",
		"toolCall": ama.JSON{
			"id":       "call_1",
			"name":     "sandbox.read",
			"approved": true,
			"input":    ama.JSON{"path": "README.md"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.ToolCallID != "call_1" || payload.ToolName != "sandbox.read" || payload.Input["path"] != "README.md" {
		t.Fatalf("unexpected parsed tool payload: %#v", payload)
	}
}

func TestParseWorkPayloadRejectsInvalidSessionStart(t *testing.T) {
	tests := []struct {
		name    string
		payload ama.JSON
		want    string
	}{
		{
			name: "missing session id",
			payload: ama.JSON{
				"protocol":                 "ama-runner-work",
				"type":                     "session.start",
				"hostingMode":              "self_hosted",
				"runtime":                  "codex",
				"provider":                 "openai",
				"runtimeConfig":            ama.JSON{},
				"requiredRunnerCapability": "runtime:codex",
			},
			want: "sessionId",
		},
		{
			name: "cloud hosting mode",
			payload: ama.JSON{
				"protocol":                 "ama-runner-work",
				"type":                     "session.start",
				"sessionId":                "session_1",
				"hostingMode":              "cloud",
				"runtime":                  "codex",
				"provider":                 "openai",
				"runtimeConfig":            ama.JSON{},
				"requiredRunnerCapability": "runtime:codex",
			},
			want: "self_hosted",
		},
		{
			name: "missing runtime",
			payload: ama.JSON{
				"protocol":                 "ama-runner-work",
				"type":                     "session.start",
				"sessionId":                "session_1",
				"hostingMode":              "self_hosted",
				"provider":                 "openai",
				"runtimeConfig":            ama.JSON{},
				"requiredRunnerCapability": "runtime:codex",
			},
			want: "runtime, runtimeConfig, and provider",
		},
		{
			name: "missing capability",
			payload: ama.JSON{
				"protocol":      "ama-runner-work",
				"type":          "session.start",
				"sessionId":     "session_1",
				"hostingMode":   "self_hosted",
				"runtime":       "codex",
				"provider":      "openai",
				"runtimeConfig": ama.JSON{},
			},
			want: "requiredRunnerCapability",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseWorkPayload(tc.payload)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
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

func TestParseWorkPayloadRejectsMalformedToolWork(t *testing.T) {
	tests := []struct {
		name    string
		payload ama.JSON
		want    string
	}{
		{
			name:    "unsupported protocol",
			payload: ama.JSON{"protocol": "other"},
			want:    "unsupported work protocol",
		},
		{
			name: "missing tool call id",
			payload: ama.JSON{
				"protocol": "ama-runner-work",
				"type":     "tool.execute",
				"approved": true,
				"toolName": "sandbox.exec",
				"input":    ama.JSON{"command": "true"},
			},
			want: "toolCallId, toolName, and input",
		},
		{
			name: "missing input",
			payload: ama.JSON{
				"protocol":   "ama-runner-work",
				"type":       "tool.execute",
				"approved":   true,
				"toolCallId": "call_1",
				"toolName":   "sandbox.exec",
			},
			want: "toolCallId, toolName, and input",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseWorkPayload(tc.payload)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
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
