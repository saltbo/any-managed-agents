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
	"sync"
	"time"
)

const runtimeWorkspaceRetention = 24 * time.Hour

type ResourceRef struct {
	Type          string `json:"type"`
	Owner         string `json:"owner"`
	Repo          string `json:"repo"`
	Ref           string `json:"ref"`
	MountPath     string `json:"mountPath"`
	CredentialRef string `json:"credentialRef"`
}

type PreparedWorkspace struct {
	Root      string
	Cwd       string
	worktrees []preparedWorktree
}

type preparedWorktree struct {
	cacheDir string
	path     string
}

var repositoryCacheLocks sync.Map

func repositoryCacheLock(cacheDir string) *sync.Mutex {
	absolute, err := filepath.Abs(cacheDir)
	if err != nil {
		absolute = cacheDir
	}
	lock, _ := repositoryCacheLocks.LoadOrStore(absolute, &sync.Mutex{})
	return lock.(*sync.Mutex)
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

func prepareRuntimeWorkspace(ctx context.Context, workDir string, sessionID string, resourceRefs []ResourceRef, runtimeEnv map[string]string) (PreparedWorkspace, error) {
	root, err := runtimeWorkspace(workDir, sessionID)
	if err != nil {
		return PreparedWorkspace{}, err
	}
	resources := githubRepositoryResources(resourceRefs)
	mounted := make([]mountedResource, 0, len(resources))
	worktrees := make([]preparedWorktree, 0, len(resources))
	cwd := root
	for index, resource := range resources {
		localPath, cacheDir, err := materializeGitHubRepository(ctx, workDir, root, resource)
		if err != nil {
			_ = cleanupRuntimeWorkspace(context.Background(), PreparedWorkspace{Root: root, Cwd: cwd, worktrees: worktrees})
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
		worktrees = append(worktrees, preparedWorktree{cacheDir: cacheDir, path: localPath})
	}
	if err := configureWorkspaceGitCredential(ctx, root, worktrees, workspaceGitHubToken(runtimeEnv)); err != nil {
		_ = cleanupRuntimeWorkspace(context.Background(), PreparedWorkspace{Root: root, Cwd: cwd, worktrees: worktrees})
		return PreparedWorkspace{}, err
	}
	if err := writeWorkspaceManifest(root, mounted); err != nil {
		_ = cleanupRuntimeWorkspace(context.Background(), PreparedWorkspace{Root: root, Cwd: cwd, worktrees: worktrees})
		return PreparedWorkspace{}, err
	}
	return PreparedWorkspace{Root: root, Cwd: cwd, worktrees: worktrees}, nil
}

// workspaceGitHubToken mirrors the cloud workspace token resolution:
// GH_TOKEN wins, GITHUB_TOKEN is the alternate spelling.
func workspaceGitHubToken(runtimeEnv map[string]string) string {
	if token := runtimeEnv["GH_TOKEN"]; token != "" {
		return token
	}
	return runtimeEnv["GITHUB_TOKEN"]
}

// configureWorkspaceGitCredential gives each mounted worktree a repo-local
// credential helper backed by a session-scoped store file, so a plain
// `git push` authenticates with the work item's GH_TOKEN instead of host
// credentials (parity with the cloud prepareCloudWorkspace). The spawned
// agent already receives GH_TOKEN via runtimeEnv, which covers gh; this
// covers git itself. Worktree-scoped config keeps the credential out of the
// shared repository cache and never touches the host's global config.
func configureWorkspaceGitCredential(ctx context.Context, sessionRoot string, worktrees []preparedWorktree, token string) error {
	if token == "" || len(worktrees) == 0 {
		return nil
	}
	credentialsPath := filepath.Join(sessionRoot, ".git-credentials")
	credential := "https://x-access-token:" + token + "@github.com\n"
	if err := os.WriteFile(credentialsPath, []byte(credential), 0o600); err != nil {
		return err
	}
	for _, worktree := range worktrees {
		lock := repositoryCacheLock(worktree.cacheDir)
		lock.Lock()
		err := configureWorktreeCredentialHelper(ctx, worktree.path, credentialsPath)
		lock.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

func configureWorktreeCredentialHelper(ctx context.Context, worktreePath string, credentialsPath string) error {
	// extensions.worktreeConfig lives in the shared cache config and only
	// unlocks per-worktree config files; the credential itself stays scoped
	// to this session's worktree.
	if err := git(ctx, worktreePath, "config", "extensions.worktreeConfig", "true"); err != nil {
		return err
	}
	// An empty first helper resets inherited helpers so the session token
	// wins over any host-level credential helpers.
	if err := git(ctx, worktreePath, "config", "--worktree", "credential.helper", ""); err != nil {
		return err
	}
	helper := fmt.Sprintf("store --file %q", credentialsPath)
	return git(ctx, worktreePath, "config", "--worktree", "--add", "credential.helper", helper)
}

func cleanupRuntimeWorkspace(ctx context.Context, workspace PreparedWorkspace) error {
	var errs []string
	for i := len(workspace.worktrees) - 1; i >= 0; i-- {
		worktree := workspace.worktrees[i]
		if !fileExists(filepath.Join(worktree.cacheDir, ".git")) {
			continue
		}
		lock := repositoryCacheLock(worktree.cacheDir)
		lock.Lock()
		if fileExists(worktree.path) {
			if err := git(ctx, worktree.cacheDir, "worktree", "remove", "--force", worktree.path); err != nil {
				errs = append(errs, err.Error())
			}
		}
		if err := git(ctx, worktree.cacheDir, "worktree", "prune"); err != nil {
			errs = append(errs, err.Error())
		}
		lock.Unlock()
	}
	if workspace.Root != "" {
		if err := os.RemoveAll(workspace.Root); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("cleanup runtime workspace failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

func cleanupStaleRuntimeWorkspaces(ctx context.Context, workDir string, retention time.Duration) error {
	if retention <= 0 {
		return nil
	}
	sessionsDir := filepath.Join(workDir, "sessions")
	entries, err := os.ReadDir(sessionsDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-retention)
	var errs []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if !info.ModTime().Before(cutoff) {
			continue
		}
		root := filepath.Join(sessionsDir, entry.Name())
		workspace := staleRuntimeWorkspace(workDir, root)
		if err := cleanupRuntimeWorkspace(ctx, workspace); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("cleanup stale runtime workspaces failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

func staleRuntimeWorkspace(workDir string, root string) PreparedWorkspace {
	workspace := PreparedWorkspace{Root: root, Cwd: root}
	data, err := os.ReadFile(filepath.Join(root, ".ama", "resources.json"))
	if err != nil {
		return workspace
	}
	var manifest struct {
		Resources []mountedResource `json:"resources"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return workspace
	}
	for _, resource := range manifest.Resources {
		if resource.Type != "github_repository" || resource.LocalPath == "" {
			continue
		}
		if !safeGitHubSegment(resource.Owner) || !safeGitHubSegment(resource.Repo) {
			continue
		}
		workspace.worktrees = append(workspace.worktrees, preparedWorktree{
			cacheDir: filepath.Join(workDir, "repositories", resource.Owner, resource.Repo),
			path:     resource.LocalPath,
		})
	}
	return workspace
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
	return materializeSubagents(cwd, runtimeName, agentSubagentProfiles(agentSnapshot))
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

func githubRepositoryResources(resourceRefs []ResourceRef) []ResourceRef {
	resources := make([]ResourceRef, 0, len(resourceRefs))
	for _, resource := range resourceRefs {
		if resource.Type == "github_repository" {
			resources = append(resources, resource)
		}
	}
	return resources
}

func materializeGitHubRepository(ctx context.Context, workDir string, sessionRoot string, resource ResourceRef) (string, string, error) {
	if !safeGitHubSegment(resource.Owner) || !safeGitHubSegment(resource.Repo) {
		return "", "", fmt.Errorf("github repository resource must include safe owner and repo")
	}
	mountPath, err := localMountPath(sessionRoot, resource)
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(mountPath), 0o755); err != nil {
		return "", "", err
	}
	cacheDir := filepath.Join(workDir, "repositories", resource.Owner, resource.Repo)
	lock := repositoryCacheLock(cacheDir)
	lock.Lock()
	defer lock.Unlock()
	if err := ensureRepositoryCache(ctx, cacheDir, resource); err != nil {
		return "", "", err
	}
	if fileExists(mountPath) {
		return mountPath, cacheDir, nil
	}
	targetRef, err := resolveWorktreeRef(ctx, cacheDir, resource.Ref)
	if err != nil {
		return "", "", err
	}
	if err := git(ctx, cacheDir, "worktree", "add", "--detach", mountPath, targetRef); err != nil {
		return "", "", err
	}
	return mountPath, cacheDir, nil
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
