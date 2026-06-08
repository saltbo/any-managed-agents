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
