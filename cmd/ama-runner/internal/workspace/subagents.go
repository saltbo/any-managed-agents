package workspace

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// subagentProfile mirrors the subagent entries the control plane embeds in the
// agent snapshot: id, username, name, bio, instructions, role,
// modelPreferences (runtime name -> model), skills.
type subagentProfile struct {
	ID               string
	Username         string
	Name             string
	Bio              string
	Instructions     string
	Role             string
	ModelPreferences map[string]string
}

func agentSubagentProfiles(agentSnapshot map[string]any) []subagentProfile {
	raw, ok := agentSnapshot["subagents"].([]any)
	if !ok {
		return nil
	}
	profiles := make([]subagentProfile, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		profiles = append(profiles, subagentProfile{
			ID:               snapshotString(entry["id"]),
			Username:         snapshotString(entry["username"]),
			Name:             snapshotString(entry["name"]),
			Bio:              snapshotString(entry["bio"]),
			Instructions:     snapshotString(entry["instructions"]),
			Role:             snapshotString(entry["role"]),
			ModelPreferences: snapshotStringMap(entry["modelPreferences"]),
		})
	}
	return profiles
}

func snapshotString(value any) string {
	text, _ := value.(string)
	return text
}

func snapshotStringMap(value any) map[string]string {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	values := make(map[string]string, len(raw))
	for key, item := range raw {
		if text, ok := item.(string); ok && text != "" {
			values[key] = text
		}
	}
	return values
}

// materializeSubagents writes provider-native subagent definition files into
// the session worktree, replicating the format the AK daemon used:
// claude-code and copilot read `.claude/agents/<name>.md` with YAML
// frontmatter, codex reads `.codex/agents/<name>.toml`.
func materializeSubagents(cwd string, runtimeName string, subagents []subagentProfile) error {
	if len(subagents) == 0 {
		return nil
	}
	var gitignoreEntry string
	switch runtimeName {
	case "claude-code", "copilot":
		gitignoreEntry = ".claude/agents/"
	case "codex":
		gitignoreEntry = ".codex/agents/"
	default:
		return fmt.Errorf("runtime %q does not support workspace subagent definitions", runtimeName)
	}
	for _, agent := range subagents {
		name := subagentName(agent)
		if strings.TrimSpace(name) == "" || name == "." || name == ".." || filepath.Base(name) != name {
			return fmt.Errorf("subagent name %q must be a single path segment", name)
		}
		var relativePath, content string
		if runtimeName == "codex" {
			relativePath = filepath.Join(".codex", "agents", name+".toml")
			content = renderCodexSubagent(agent)
		} else {
			relativePath = filepath.Join(".claude", "agents", name+".md")
			content = renderMarkdownSubagent(runtimeName, agent)
		}
		path := filepath.Join(cwd, relativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return err
		}
	}
	return ensureGitignoreEntries(cwd, "# agent definitions (managed by AMA runner)", []string{gitignoreEntry})
}

func subagentName(agent subagentProfile) string {
	if agent.Username != "" {
		return agent.Username
	}
	return agent.ID
}

func subagentDescription(agent subagentProfile) string {
	if agent.Bio != "" {
		return agent.Bio
	}
	return agent.Name + " specialist"
}

func subagentPrompt(agent subagentProfile) string {
	sections := []string{"You are " + agent.Name + "."}
	if agent.Bio != "" {
		sections = append(sections, agent.Bio)
	}
	if agent.Role != "" {
		sections = append(sections, "Role: "+agent.Role)
	}
	if agent.Instructions != "" {
		sections = append(sections, agent.Instructions)
	}
	return strings.Join(sections, "\n\n")
}

// subagentModel resolves the preferred model for a runtime. Preferences are
// keyed by the AK runtime name, so claude-code also accepts the "claude" key.
func subagentModel(runtimeName string, agent subagentProfile) string {
	if model := agent.ModelPreferences[runtimeName]; model != "" {
		return model
	}
	if runtimeName == "claude-code" {
		return agent.ModelPreferences["claude"]
	}
	return ""
}

func renderMarkdownSubagent(runtimeName string, agent subagentProfile) string {
	lines := []string{
		"---",
		"name: " + yamlScalar(subagentName(agent)),
		"description: " + yamlScalar(subagentDescription(agent)),
	}
	// Only claude-code supports a model override in the markdown frontmatter.
	if runtimeName == "claude-code" {
		if model := subagentModel(runtimeName, agent); model != "" {
			lines = append(lines, "model: "+yamlScalar(model))
		}
	}
	lines = append(lines, "---")
	return strings.Join(lines, "\n") + "\n" + subagentPrompt(agent) + "\n"
}

func renderCodexSubagent(agent subagentProfile) string {
	lines := []string{
		"name = " + jsonString(subagentName(agent)),
		"description = " + jsonString(subagentDescription(agent)),
	}
	if model := subagentModel("codex", agent); model != "" {
		lines = append(lines, "model = "+jsonString(model))
	}
	escapedPrompt := strings.ReplaceAll(subagentPrompt(agent), `"""`, `\"\"\"`)
	lines = append(lines, `developer_instructions = """`+"\n"+escapedPrompt+"\n"+`"""`)
	return strings.Join(lines, "\n") + "\n"
}

func yamlScalar(value string) string {
	safe := value != "" &&
		!strings.ContainsAny(value, ":#\"'\n\t{}[]&*!|>%@`,") &&
		value == strings.TrimSpace(value) &&
		!strings.HasPrefix(value, "-") &&
		!strings.HasPrefix(value, "?")
	if safe {
		return value
	}
	return jsonString(value)
}

// jsonString encodes a string as a JSON literal, which is also a valid YAML
// double-quoted scalar and TOML basic string.
func jsonString(value string) string {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return strings.TrimSuffix(buffer.String(), "\n")
}
