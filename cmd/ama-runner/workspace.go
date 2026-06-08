package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type ResourceRef struct {
	Type          string `json:"type"`
	Owner         string `json:"owner"`
	Repo          string `json:"repo"`
	Ref           string `json:"ref"`
	MountPath     string `json:"mountPath"`
	CredentialRef string `json:"credentialRef"`
}

type PreparedWorkspace struct {
	Root string
	Cwd  string
}

type mountedResource struct {
	Type      string `json:"type"`
	Owner     string `json:"owner,omitempty"`
	Repo      string `json:"repo,omitempty"`
	Ref       string `json:"ref,omitempty"`
	MountPath string `json:"mountPath,omitempty"`
	LocalPath string `json:"localPath,omitempty"`
	Status    string `json:"status"`
}

func prepareRuntimeWorkspace(ctx context.Context, workDir string, sessionID string, resourceRefs []ResourceRef) (PreparedWorkspace, error) {
	root, err := runtimeWorkspace(workDir, sessionID)
	if err != nil {
		return PreparedWorkspace{}, err
	}
	resources := githubRepositoryResources(resourceRefs)
	mounted := make([]mountedResource, 0, len(resources))
	cwd := root
	for index, resource := range resources {
		localPath, err := materializeGitHubRepository(ctx, workDir, root, resource)
		if err != nil {
			return PreparedWorkspace{}, err
		}
		if index == 0 {
			cwd = localPath
		}
		mounted = append(mounted, mountedResource{
			Type:      resource.Type,
			Owner:     resource.Owner,
			Repo:      resource.Repo,
			Ref:       resource.Ref,
			MountPath: resource.MountPath,
			LocalPath: localPath,
			Status:    "mounted",
		})
	}
	if err := writeWorkspaceManifest(root, mounted); err != nil {
		return PreparedWorkspace{}, err
	}
	return PreparedWorkspace{Root: root, Cwd: cwd}, nil
}

func prepareAgentWorkspace(ctx context.Context, cwd string, runtimeName string, agentSnapshot map[string]any) error {
	if agentSnapshot == nil {
		return nil
	}
	amaDir := filepath.Join(cwd, ".ama")
	if err := os.MkdirAll(amaDir, 0o755); err != nil {
		return err
	}
	snapshot, err := json.MarshalIndent(agentSnapshot, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(amaDir, "agent.json"), snapshot, 0o644); err != nil {
		return err
	}
	if prompt := agentSystemPrompt(agentSnapshot); prompt != "" {
		if err := os.WriteFile(filepath.Join(amaDir, "system-prompt.md"), []byte(prompt), 0o644); err != nil {
			return err
		}
	}
	for _, skill := range agentSkillRefs(agentSnapshot) {
		if err := installAgentSkill(ctx, cwd, runtimeName, skill); err != nil {
			return err
		}
	}
	return nil
}

func agentSystemPrompt(agentSnapshot map[string]any) string {
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
	path := filepath.Join(cwd, ".gitignore")
	existingBytes, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	existing := string(existingBytes)
	missing := []string{}
	for _, entry := range []string{".claude/skills/", ".agents/", "skills-lock.json"} {
		if !strings.Contains(existing, entry) {
			missing = append(missing, entry)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	appendix := "\n# agent skills (managed by AMA runner)\n" + strings.Join(missing, "\n") + "\n"
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(appendix)
	return err
}

func githubRepositoryResources(resourceRefs []ResourceRef) []ResourceRef {
	resources := make([]ResourceRef, 0, len(resourceRefs))
	for _, resource := range resourceRefs {
		if resource.Type == "github_repository" {
			resources = append(resources, resource)
		}
	}
	return resources
}

func materializeGitHubRepository(ctx context.Context, workDir string, sessionRoot string, resource ResourceRef) (string, error) {
	if !safeGitHubSegment(resource.Owner) || !safeGitHubSegment(resource.Repo) {
		return "", fmt.Errorf("github repository resource must include safe owner and repo")
	}
	mountPath, err := localMountPath(sessionRoot, resource)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(mountPath), 0o755); err != nil {
		return "", err
	}
	cacheDir := filepath.Join(workDir, "repositories", resource.Owner, resource.Repo)
	if err := ensureRepositoryCache(ctx, cacheDir, resource); err != nil {
		return "", err
	}
	if fileExists(mountPath) {
		return mountPath, nil
	}
	targetRef, err := resolveWorktreeRef(ctx, cacheDir, resource.Ref)
	if err != nil {
		return "", err
	}
	if err := git(ctx, cacheDir, "worktree", "add", "--detach", mountPath, targetRef); err != nil {
		return "", err
	}
	return mountPath, nil
}

func ensureRepositoryCache(ctx context.Context, cacheDir string, resource ResourceRef) error {
	if fileExists(filepath.Join(cacheDir, ".git")) {
		return git(ctx, cacheDir, "fetch", "--prune", "origin")
	}
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		return err
	}
	cloneURL := (&url.URL{Scheme: "https", Host: "github.com", Path: resource.Owner + "/" + resource.Repo + ".git"}).String()
	return git(ctx, filepath.Dir(cacheDir), "clone", cloneURL, cacheDir)
}

func resolveWorktreeRef(ctx context.Context, cacheDir string, requestedRef string) (string, error) {
	ref := strings.TrimSpace(requestedRef)
	if ref != "" {
		remoteRef := "refs/remotes/origin/" + ref
		if _, err := gitOutput(ctx, cacheDir, "rev-parse", "--verify", remoteRef); err == nil {
			return remoteRef, nil
		}
		if _, err := gitOutput(ctx, cacheDir, "rev-parse", "--verify", ref); err == nil {
			return ref, nil
		}
		return "", fmt.Errorf("repository ref %q is not available", ref)
	}
	if out, err := gitOutput(ctx, cacheDir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"); err == nil {
		return strings.TrimSpace(out), nil
	}
	return "HEAD", nil
}

func localMountPath(sessionRoot string, resource ResourceRef) (string, error) {
	relative := strings.TrimSpace(resource.MountPath)
	if strings.HasPrefix(relative, "/workspace/") {
		relative = strings.TrimPrefix(relative, "/workspace/")
	}
	if relative == "" || relative == "/workspace" {
		relative = filepath.Join("repos", resource.Owner, resource.Repo)
	}
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("mount path must be under /workspace")
	}
	clean := filepath.Clean(relative)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("mount path must stay inside the session workspace")
	}
	resolved := filepath.Join(sessionRoot, clean)
	if err := ensureUnderWorkspace(sessionRoot, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func writeWorkspaceManifest(sessionRoot string, resources []mountedResource) error {
	amaDir := filepath.Join(sessionRoot, ".ama")
	if err := os.MkdirAll(amaDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(map[string]any{
		"version":       1,
		"workspaceRoot": sessionRoot,
		"resources":     resources,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(amaDir, "resources.json"), data, 0o644)
}

func safeGitHubSegment(value string) bool {
	if strings.TrimSpace(value) == "" || value == "." || value == ".." {
		return false
	}
	return !strings.ContainsAny(value, `/\`)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func git(ctx context.Context, cwd string, args ...string) error {
	_, err := gitOutput(ctx, cwd, args...)
	return err
}

func gitOutput(ctx context.Context, cwd string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}
