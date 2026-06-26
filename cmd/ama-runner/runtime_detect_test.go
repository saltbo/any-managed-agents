package main

import (
	"strings"
	"testing"
)

func TestDetectAvailableRuntimesChecksCLIBinariesOnPath(t *testing.T) {
	tests := []struct {
		name     string
		binaries []string
		want     []string
	}{
		{"all installed", []string{"claude", "codex", "copilot"}, []string{"claude-code", "codex", "copilot"}},
		{"claude only", []string{"claude"}, []string{"claude-code"}},
		{"codex only", []string{"codex"}, []string{"codex"}},
		{"none installed", nil, []string{}},
		{"unrelated binaries ignored", []string{"git", "node"}, []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := detectAvailableRuntimes(lookPathFinding(tc.binaries...))
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Fatalf("expected runtimes %v, got %v", tc.want, got)
			}
		})
	}
}

func TestRunnerCapabilitiesFallBackToPinnedModelWhenEnumerationFails(t *testing.T) {
	got := runnerCapabilities([]string{"claude-code", "codex", "copilot"}, nil)
	want := []string{
		"sandbox.exec",
		"ama-sandbox",
		"claude-code",
		"runtime-provider-model:claude-code:*:claude-sonnet-4-6",
		"codex",
		"runtime-provider-model:codex:*:gpt-5.3-codex",
		"copilot",
		"runtime-provider-model:copilot:*:copilot-cli",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected capabilities %v, got %v", want, got)
	}
}

func TestRunnerCapabilitiesDeclareOneCapabilityPerEnumeratedModel(t *testing.T) {
	got := runnerCapabilities([]string{"codex", "claude-code"}, map[string][]string{
		"codex":       {"gpt-5.3-codex", "gpt-5.3-codex-mini"},
		"claude-code": {"claude-opus-4-5"},
	})
	want := []string{
		"sandbox.exec",
		"ama-sandbox",
		"codex",
		"runtime-provider-model:codex:*:gpt-5.3-codex",
		"runtime-provider-model:codex:*:gpt-5.3-codex-mini",
		"claude-code",
		"runtime-provider-model:claude-code:*:claude-opus-4-5",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected capabilities %v, got %v", want, got)
	}
}

func TestRunnerCapabilitiesExcludeUndetectedRuntimes(t *testing.T) {
	got := runnerCapabilities([]string{"codex"}, map[string][]string{
		"codex":       {"gpt-5.3-codex"},
		"claude-code": {"claude-opus-4-5"},
	})
	for _, unexpected := range []string{"claude-code", "copilot", "runtime-provider-model:claude-code:*:claude-opus-4-5"} {
		if containsString(got, unexpected) {
			t.Fatalf("expected %q to be excluded, got %v", unexpected, got)
		}
	}
	if !containsString(got, "codex") || !containsString(got, "runtime-provider-model:codex:*:gpt-5.3-codex") {
		t.Fatalf("expected codex capabilities, got %v", got)
	}
}
