package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func (m Manager) PrepareAgent(ctx context.Context, cwd string, runtimeName string, agentSnapshot map[string]any) error {
	if agentSnapshot == nil {
		return nil
	}
	for _, skill := range agentSkillRefs(agentSnapshot) {
		if err := installAgentSkill(ctx, cwd, runtimeName, skill); err != nil {
			return err
		}
	}
	return materializeSubagents(cwd, runtimeName, agentSubagentProfiles(agentSnapshot))
}

func (m Manager) AgentSystemPrompt(agentSnapshot map[string]any) string {
	sections := []string{}
	for _, key := range []string{"systemPrompt", "instructions"} {
		if value, ok := agentSnapshot[key].(string); ok && strings.TrimSpace(value) != "" {
			sections = append(sections, strings.TrimSpace(value))
			break
		}
	}
	if section := agentCapabilitiesSection(agentSnapshot); section != "" {
		sections = append(sections, section)
	}
	return strings.Join(sections, "\n\n")
}

func agentCapabilitiesSection(agentSnapshot map[string]any) string {
	parts := []string{}
	if skills := agentStringArray(agentSnapshot["skills"]); len(skills) > 0 {
		parts = append(parts, "Skills: "+strings.Join(skills, ", "))
	}
	if tags := agentStringArray(agentSnapshot["capabilityTags"]); len(tags) > 0 {
		parts = append(parts, "Capability tags: "+strings.Join(tags, ", "))
	}
	if subagents := agentSubagentSummaries(agentSnapshot["subagents"]); len(subagents) > 0 {
		parts = append(parts, "Available subagents: "+strings.Join(subagents, ", "))
	}
	if policy, ok := agentSnapshot["handoffPolicy"].(map[string]any); ok && len(policy) > 0 {
		encoded, err := json.Marshal(policy)
		if err == nil {
			parts = append(parts, "Handoff policy: "+string(encoded))
		}
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
	values := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			values = append(values, strings.TrimSpace(text))
		}
	}
	return values
}

func agentSubagentSummaries(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	summaries := make([]string, 0, len(raw))
	for _, item := range raw {
		subagent, ok := item.(map[string]any)
		if !ok {
			continue
		}
		username, _ := subagent["username"].(string)
		name, _ := subagent["name"].(string)
		role, _ := subagent["role"].(string)
		label := strings.TrimSpace(username)
		if label == "" {
			label = strings.TrimSpace(name)
		}
		if label == "" {
			continue
		}
		if role != "" {
			label += " (" + role + ")"
		}
		summaries = append(summaries, "@"+label)
	}
	return summaries
}

func agentSkillRefs(agentSnapshot map[string]any) []string {
	raw, ok := agentSnapshot["skills"].([]any)
	if !ok {
		return nil
	}
	skills := make([]string, 0, len(raw))
	for _, value := range raw {
		if skill, ok := value.(string); ok && strings.TrimSpace(skill) != "" {
			skills = append(skills, skill)
		}
	}
	return skills
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
	missing := []string{}
	for _, entry := range entries {
		if !strings.Contains(existing, entry) {
			missing = append(missing, entry)
		}
	}
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
