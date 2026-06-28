package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/samber/lo"
)

func githubRepositoryVolumes(volumes []protocol.Volume) []protocol.Volume {
	return lo.Filter(volumes, func(volume protocol.Volume, _ int) bool {
		return volume.Type == "github_repository"
	})
}

func memoryStoreVolumes(volumes []protocol.Volume) []protocol.Volume {
	return lo.Filter(volumes, func(volume protocol.Volume, _ int) bool {
		return volume.Type == "memory_store"
	})
}

func memoryManifestEntries(memories []protocol.MemorySnapshot) []protocol.MemorySnapshot {
	return lo.Map(memories, func(memory protocol.MemorySnapshot, _ int) protocol.MemorySnapshot {
		return protocol.MemorySnapshot{Path: memory.Path}
	})
}

func materializeGitHubRepository(ctx context.Context, workDir string, sessionRoot string, volume protocol.Volume, mounts []protocol.VolumeMount) (string, string, error) {
	if !safeGitHubSegment(volume.Owner) || !safeGitHubSegment(volume.Repo) {
		return "", "", fmt.Errorf("github repository volume must include safe owner and repo")
	}
	mountPath, err := localMountPath(sessionRoot, mountPathForVolume(volume.Name, mounts, defaultGitHubMountPath(volume)))
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(mountPath), 0o755); err != nil {
		return "", "", err
	}
	cacheDir := filepath.Join(workDir, "repositories", volume.Owner, volume.Repo)
	lock := repositoryCacheLock(cacheDir)
	lock.Lock()
	defer lock.Unlock()
	if err := ensureRepositoryCache(ctx, cacheDir, volume); err != nil {
		return "", "", err
	}
	if fileExists(mountPath) {
		return mountPath, cacheDir, nil
	}
	targetRef, err := resolveWorktreeRef(ctx, cacheDir, volume.Ref)
	if err != nil {
		return "", "", err
	}
	if err := git(ctx, cacheDir, "worktree", "add", "--detach", mountPath, targetRef); err != nil {
		return "", "", err
	}
	return mountPath, cacheDir, nil
}

func materializeMemoryStore(sessionRoot string, volume protocol.Volume, mounts []protocol.VolumeMount) (string, error) {
	if strings.TrimSpace(volume.StoreID) == "" {
		return "", fmt.Errorf("memory store volume must include storeId")
	}
	mountPath, err := localMountPath(sessionRoot, mountPathForVolume(volume.Name, mounts, defaultMemoryStoreMountPath(volume)))
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(mountPath, 0o755); err != nil {
		return "", err
	}
	for _, memory := range volume.Memories {
		relative, err := cleanMemoryPath(memory.Path)
		if err != nil {
			return "", err
		}
		fullPath := filepath.Join(mountPath, relative)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(fullPath, []byte(memory.Content), 0o644); err != nil {
			return "", err
		}
	}
	if volume.Access == "read_only" {
		if err := filepath.WalkDir(mountPath, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return os.Chmod(path, 0o555)
			}
			return os.Chmod(path, 0o444)
		}); err != nil {
			return "", err
		}
	}
	return mountPath, nil
}

func materializeResolvedVolume(sessionRoot string, volume protocol.ResolvedVolumeMount) (string, error) {
	mountPath, err := localMountPathForWorkspacePath(sessionRoot, volume.MountPath)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(mountPath, 0o700); err != nil {
		return "", err
	}
	for _, file := range volume.Files {
		relative, err := cleanMemoryPath(file.Path)
		if err != nil {
			return "", err
		}
		fullPath := filepath.Join(mountPath, relative)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o700); err != nil {
			return "", err
		}
		if err := os.WriteFile(fullPath, []byte(file.Content), 0o400); err != nil {
			return "", err
		}
	}
	if !volume.ReadOnly {
		return mountPath, nil
	}
	return mountPath, filepath.WalkDir(mountPath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return os.Chmod(path, 0o500)
		}
		return os.Chmod(path, 0o400)
	})
}

func resetMemoryStorePermissions(root string) error {
	if strings.TrimSpace(root) == "" || !fileExists(root) {
		return nil
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return os.Chmod(path, 0o755)
		}
		return os.Chmod(path, 0o644)
	})
}

func localMountPathForWorkspacePath(sessionRoot string, mountPath string) (string, error) {
	relative := strings.TrimSpace(mountPath)
	if strings.HasPrefix(relative, "/workspace/") {
		relative = strings.TrimPrefix(relative, "/workspace/")
	}
	if relative == "" || relative == "/workspace" {
		return "", fmt.Errorf("secret volume mount path is required")
	}
	if filepath.IsAbs(relative) {
		return "", fmt.Errorf("secret volume mount path must be under /workspace")
	}
	clean := filepath.Clean(relative)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("secret volume mount path must stay inside the session workspace")
	}
	resolved := filepath.Join(sessionRoot, clean)
	if err := ensureUnderWorkspace(sessionRoot, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

type MemoryStoreSnapshot struct {
	StoreID  string                    `json:"storeId"`
	Memories []protocol.MemorySnapshot `json:"memories"`
}

func readMemoryFiles(root string) ([]protocol.MemorySnapshot, error) {
	memories := []protocol.MemorySnapshot{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		clean, err := cleanMemoryPath(relative)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		memories = append(memories, protocol.MemorySnapshot{Path: filepath.ToSlash(clean), Content: string(content)})
		return nil
	})
	return memories, err
}

func cleanMemoryPath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("memory path is required")
	}
	if filepath.IsAbs(path) || strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("memory path must be relative")
	}
	clean := filepath.Clean(filepath.FromSlash(path))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("memory path must stay inside the memory store")
	}
	return clean, nil
}

func ensureRepositoryCache(ctx context.Context, cacheDir string, volume protocol.Volume) error {
	if fileExists(filepath.Join(cacheDir, ".git")) {
		return git(ctx, cacheDir, "fetch", "--prune", "origin")
	}
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		return err
	}
	cloneURL := (&url.URL{Scheme: "https", Host: "github.com", Path: volume.Owner + "/" + volume.Repo + ".git"}).String()
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

func localMountPath(sessionRoot string, mountPath string) (string, error) {
	relative := strings.TrimSpace(mountPath)
	if strings.HasPrefix(relative, "/workspace/") {
		relative = strings.TrimPrefix(relative, "/workspace/")
	}
	if relative == "" || relative == "/workspace" || filepath.IsAbs(relative) {
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

func mountPathForVolume(name string, mounts []protocol.VolumeMount, fallback string) string {
	for _, mount := range mounts {
		if mount.Name == name {
			return mount.MountPath
		}
	}
	return fallback
}

func defaultGitHubMountPath(volume protocol.Volume) string {
	return filepath.Join("repos", volume.Owner, volume.Repo)
}

func defaultMemoryStoreMountPath(volume protocol.Volume) string {
	return filepath.Join(".ama", "memory-stores", volume.StoreID)
}

func writeSessionState(sessionDir string, workspaceRoot string, volumes []mountedVolume) error {
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(map[string]any{
		"version":       1,
		"workspaceRoot": workspaceRoot,
		"volumes":       volumes,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(sessionDir, SessionStateFileName), data, 0o600)
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
