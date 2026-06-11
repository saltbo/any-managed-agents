package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func reviewerSnapshot() map[string]any {
	return map[string]any{
		"instructions": "Follow the AK worker protocol.",
		"subagents": []any{
			map[string]any{
				"id":           "subagent_1",
				"username":     "reviewer",
				"name":         "Reviewer",
				"bio":          "Reviews pull requests for correctness",
				"instructions": "Be strict about error handling.",
				"role":         "reviewer",
				"modelPreferences": map[string]any{
					"claude": "claude-sonnet-4-6",
					"codex":  "gpt-5.3-codex",
				},
				"skills": []any{"code-review"},
			},
		},
	}
}

func TestPrepareAgentWorkspaceWritesClaudeSubagentDefinition(t *testing.T) {
	cwd := t.TempDir()
	if err := prepareAgentWorkspace(context.Background(), cwd, "claude-code", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".claude", "agents", "reviewer.md"))
	if err != nil {
		t.Fatalf("expected claude subagent definition, got %v", err)
	}
	want := `---
name: reviewer
description: Reviews pull requests for correctness
model: claude-sonnet-4-6
---
You are Reviewer.

Reviews pull requests for correctness

Role: reviewer

Be strict about error handling.
`
	if string(content) != want {
		t.Fatalf("unexpected claude subagent file:\n%s\nwant:\n%s", content, want)
	}
	gitignore, err := os.ReadFile(filepath.Join(cwd, ".gitignore"))
	if err != nil || !strings.Contains(string(gitignore), ".claude/agents/") {
		t.Fatalf("expected .claude/agents/ gitignore entry, got %q err=%v", gitignore, err)
	}
}

func TestPrepareAgentWorkspaceWritesCopilotSubagentWithoutModel(t *testing.T) {
	cwd := t.TempDir()
	if err := prepareAgentWorkspace(context.Background(), cwd, "copilot", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".claude", "agents", "reviewer.md"))
	if err != nil {
		t.Fatalf("expected copilot subagent definition, got %v", err)
	}
	if strings.Contains(string(content), "model:") {
		t.Fatalf("expected no model override for copilot, got:\n%s", content)
	}
	if !strings.HasPrefix(string(content), "---\nname: reviewer\ndescription: Reviews pull requests for correctness\n---\n") {
		t.Fatalf("unexpected copilot frontmatter:\n%s", content)
	}
}

func TestPrepareAgentWorkspaceWritesCodexSubagentTOML(t *testing.T) {
	cwd := t.TempDir()
	if err := prepareAgentWorkspace(context.Background(), cwd, "codex", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".codex", "agents", "reviewer.toml"))
	if err != nil {
		t.Fatalf("expected codex subagent definition, got %v", err)
	}
	want := `name = "reviewer"
description = "Reviews pull requests for correctness"
model = "gpt-5.3-codex"
developer_instructions = """
You are Reviewer.

Reviews pull requests for correctness

Role: reviewer

Be strict about error handling.
"""
`
	if string(content) != want {
		t.Fatalf("unexpected codex subagent file:\n%s\nwant:\n%s", content, want)
	}
	gitignore, err := os.ReadFile(filepath.Join(cwd, ".gitignore"))
	if err != nil || !strings.Contains(string(gitignore), ".codex/agents/") {
		t.Fatalf("expected .codex/agents/ gitignore entry, got %q err=%v", gitignore, err)
	}
}

func TestPrepareAgentWorkspaceKeepsSubagentPromptSummary(t *testing.T) {
	cwd := t.TempDir()
	if err := prepareAgentWorkspace(context.Background(), cwd, "codex", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	prompt, err := os.ReadFile(filepath.Join(cwd, ".ama", "system-prompt.md"))
	if err != nil || !strings.Contains(string(prompt), "Available subagents: @reviewer (reviewer)") {
		t.Fatalf("expected subagent summary to stay in the system prompt, got %q err=%v", prompt, err)
	}
}

func TestMaterializeSubagentsFallsBackToIDAndQuotesUnsafeValues(t *testing.T) {
	cwd := t.TempDir()
	subagents := []subagentProfile{{
		ID:   "subagent_2",
		Name: "Docs: Writer",
		Bio:  "Writes \"friendly\" docs",
	}}
	if err := materializeSubagents(cwd, "claude-code", subagents); err != nil {
		t.Fatalf("expected materialize success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".claude", "agents", "subagent_2.md"))
	if err != nil {
		t.Fatalf("expected id-named subagent definition, got %v", err)
	}
	if !strings.Contains(string(content), `description: "Writes \"friendly\" docs"`) {
		t.Fatalf("expected quoted YAML scalar, got:\n%s", content)
	}
}

func TestMaterializeSubagentsEscapesCodexTripleQuotes(t *testing.T) {
	cwd := t.TempDir()
	subagents := []subagentProfile{{
		Username:     "tester",
		Name:         "Tester",
		Instructions: `Use """ blocks carefully.`,
	}}
	if err := materializeSubagents(cwd, "codex", subagents); err != nil {
		t.Fatalf("expected materialize success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".codex", "agents", "tester.toml"))
	if err != nil {
		t.Fatalf("expected codex subagent definition, got %v", err)
	}
	if !strings.Contains(string(content), `Use \"\"\" blocks carefully.`) {
		t.Fatalf("expected escaped triple quotes, got:\n%s", content)
	}
}

func TestMaterializeSubagentsRejectsUnsafeNamesAndUnsupportedRuntimes(t *testing.T) {
	cwd := t.TempDir()
	err := materializeSubagents(cwd, "claude-code", []subagentProfile{{Username: "../escape"}})
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected unsafe name error, got %v", err)
	}
	err = materializeSubagents(cwd, "ama", []subagentProfile{{Username: "reviewer"}})
	if err == nil || !strings.Contains(err.Error(), "does not support workspace subagent definitions") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
}

func TestMaterializeSubagentsSkipsWhenSnapshotHasNoSubagents(t *testing.T) {
	cwd := t.TempDir()
	if err := materializeSubagents(cwd, "ama", nil); err != nil {
		t.Fatalf("expected no-op for empty subagent list, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(cwd, ".gitignore")); !os.IsNotExist(err) {
		t.Fatalf("expected no gitignore changes, got %v", err)
	}
}
