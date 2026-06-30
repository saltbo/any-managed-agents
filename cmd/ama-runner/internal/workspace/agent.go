package workspace

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/samber/lo"
)

func agentCapabilitiesSection(agentSnapshot map[string]any) string {
	parts := []string{}
	if skills := agentStringArray(agentSnapshot["skills"]); len(skills) > 0 {
		parts = append(parts, "Skills: "+strings.Join(skills, ", "))
	}
	if subagents := agentSubagentSummaries(agentSnapshot["subagents"]); len(subagents) > 0 {
		parts = append(parts, "Available subagents: "+strings.Join(subagents, ", "))
	}
	if len(parts) == 0 {
		return ""
	}
	return "## Agent Capabilities\n\n" + strings.Join(parts, "\n")
}

func agentStringArray(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(item any, _ int) (string, bool) {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text), true
		}
		return "", false
	})
}

func agentSubagentSummaries(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(item any, _ int) (string, bool) {
		subagent, ok := item.(map[string]any)
		if !ok {
			return "", false
		}
		name, _ := subagent["name"].(string)
		description, _ := subagent["description"].(string)
		label := strings.TrimSpace(name)
		if label == "" {
			return "", false
		}
		if strings.TrimSpace(description) != "" {
			label += " (" + strings.TrimSpace(description) + ")"
		}
		return "@" + label, true
	})
}

func agentSkillRefs(agentSnapshot map[string]any) []string {
	raw, ok := agentSnapshot["skills"].([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(value any, _ int) (string, bool) {
		if skill, ok := value.(string); ok && strings.TrimSpace(skill) != "" {
			return strings.TrimSpace(skill), true
		}
		return "", false
	})
}

func installAgentSkill(ctx context.Context, cwd string, runtimeName string, ref string) error {
	at := strings.LastIndex(ref, "@")
	if at <= 0 || at == len(ref)-1 {
		return fmt.Errorf("agent skill must be a stable <source>@<skill> reference: %s", ref)
	}
	source := ref[:at]
	skill := ref[at+1:]
	if fileExists(filepath.Join(cwd, ".agents", "skills", skill, "SKILL.md")) || fileExists(filepath.Join(cwd, ".claude", "skills", skill, "SKILL.md")) {
		return nil
	}
	args := []string{"skills", "add", source, "--skill", skill, "--agent", "universal", "-y"}
	if runtimeName == "claude-code" {
		args = append(args[:len(args)-1], "--agent", "claude-code", "-y")
	}
	cmd := exec.CommandContext(ctx, "npx", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install agent skill %s failed: %w: %s", ref, err, strings.TrimSpace(string(output)))
	}
	return ensureAgentSkillGitignore(cwd)
}

func ensureAgentSkillGitignore(cwd string) error {
	return ensureGitignoreEntries(cwd, "# agent skills (managed by AMA runner)", []string{".claude/skills/", ".agents/", "skills-lock.json"})
}

func ensureGitignoreEntries(cwd string, comment string, entries []string) error {
	path := filepath.Join(cwd, ".gitignore")
	existingBytes, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	existing := string(existingBytes)
	missing := lo.Reject(entries, func(entry string, _ int) bool {
		return strings.Contains(existing, entry)
	})
	if len(missing) == 0 {
		return nil
	}
	appendix := "\n" + comment + "\n" + strings.Join(missing, "\n") + "\n"
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(appendix)
	return err
}
