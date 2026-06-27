package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/hostruntime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/layout"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

const RuntimeRetention = 24 * time.Hour
const runtimeSessionsDirName = layout.SessionsDirName
const runtimeWorkspaceDirName = layout.WorkspaceDirName
const runtimeSessionStateFileName = layout.SessionStateFileName

type Manager struct{}

type Prepared struct {
	SessionDir   string
	Root         string
	Cwd          string
	worktrees    []preparedWorktree
	memoryStores []preparedMemoryStore
}

type preparedWorktree struct {
	cacheDir string
	path     string
}

type preparedMemoryStore struct {
	storeID string
	path    string
	access  string
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
	Type        string                    `json:"type"`
	Owner       string                    `json:"owner,omitempty"`
	Repo        string                    `json:"repo,omitempty"`
	Ref         string                    `json:"ref,omitempty"`
	StoreID     string                    `json:"storeId,omitempty"`
	Name        string                    `json:"name,omitempty"`
	Description *string                   `json:"description,omitempty"`
	Access      string                    `json:"access,omitempty"`
	MountPath   string                    `json:"mountPath,omitempty"`
	LocalPath   string                    `json:"localPath,omitempty"`
	Memories    []protocol.MemorySnapshot `json:"memories,omitempty"`
	Status      string                    `json:"status"`
}

func (m Manager) PrepareRuntime(ctx context.Context, workDir string, sessionID string, resourceRefs []protocol.ResourceRef, runtimeEnv map[string]string) (Prepared, error) {
	root, err := hostruntime.Workspace(workDir, sessionID)
	if err != nil {
		return Prepared{}, err
	}
	sessionDir := filepath.Dir(root)
	githubResources := githubRepositoryResources(resourceRefs)
	memoryResources := memoryStoreResources(resourceRefs)
	mounted := make([]mountedResource, 0, len(githubResources)+len(memoryResources))
	worktrees := make([]preparedWorktree, 0, len(githubResources))
	memoryStores := make([]preparedMemoryStore, 0, len(memoryResources))
	cwd := root
	for _, resource := range githubResources {
		localPath, cacheDir, err := materializeGitHubRepository(ctx, workDir, root, resource)
		if err != nil {
			_ = m.CleanupRuntime(context.Background(), Prepared{SessionDir: sessionDir, Root: root, Cwd: cwd, worktrees: worktrees, memoryStores: memoryStores})
			return Prepared{}, err
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
	for _, resource := range memoryResources {
		localPath, err := materializeMemoryStore(root, resource)
		if err != nil {
			_ = m.CleanupRuntime(context.Background(), Prepared{SessionDir: sessionDir, Root: root, Cwd: cwd, worktrees: worktrees, memoryStores: memoryStores})
			return Prepared{}, err
		}
		mounted = append(mounted, mountedResource{
			Type:        resource.Type,
			StoreID:     resource.StoreID,
			Name:        resource.Name,
			Description: resource.Description,
			Access:      resource.Access,
			MountPath:   resource.MountPath,
			LocalPath:   localPath,
			Memories:    memoryManifestEntries(resource.Memories),
			Status:      "mounted",
		})
		memoryStores = append(memoryStores, preparedMemoryStore{storeID: resource.StoreID, path: localPath, access: resource.Access})
	}
	if err := configureWorkspaceGitCredential(ctx, sessionDir, worktrees, workspaceGitHubToken(runtimeEnv)); err != nil {
		_ = m.CleanupRuntime(context.Background(), Prepared{SessionDir: sessionDir, Root: root, Cwd: cwd, worktrees: worktrees, memoryStores: memoryStores})
		return Prepared{}, err
	}
	if err := writeSessionState(sessionDir, root, mounted); err != nil {
		_ = m.CleanupRuntime(context.Background(), Prepared{SessionDir: sessionDir, Root: root, Cwd: cwd, worktrees: worktrees, memoryStores: memoryStores})
		return Prepared{}, err
	}
	return Prepared{SessionDir: sessionDir, Root: root, Cwd: cwd, worktrees: worktrees, memoryStores: memoryStores}, nil
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
func configureWorkspaceGitCredential(ctx context.Context, sessionDir string, worktrees []preparedWorktree, token string) error {
	if token == "" || len(worktrees) == 0 {
		return nil
	}
	credentialsPath := filepath.Join(sessionDir, "git-credentials")
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
	// wins over any host-level credential helpers. --replace-all collapses any
	// pre-existing values (a reused worktree config, or a host with multiple
	// credential.helper entries) to the single empty reset; a plain set fails
	// with "cannot overwrite multiple values with a single value".
	if err := git(ctx, worktreePath, "config", "--worktree", "--replace-all", "credential.helper", ""); err != nil {
		return err
	}
	helper := fmt.Sprintf("store --file %q", credentialsPath)
	return git(ctx, worktreePath, "config", "--worktree", "--add", "credential.helper", helper)
}

func (m Manager) CleanupRuntime(ctx context.Context, workspace Prepared) error {
	var errs []string
	for _, memoryStore := range workspace.memoryStores {
		if err := resetMemoryStorePermissions(memoryStore.path); err != nil {
			errs = append(errs, err.Error())
		}
	}
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

func (m Manager) CleanupStaleRuntime(ctx context.Context, workDir string, retention time.Duration) error {
	if retention <= 0 {
		return nil
	}
	sessionsDir := filepath.Join(workDir, runtimeSessionsDirName)
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
		if err := m.CleanupRuntime(ctx, workspace); err != nil {
			errs = append(errs, err.Error())
		}
		if err := os.RemoveAll(root); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("cleanup stale runtime workspaces failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

func staleRuntimeWorkspace(workDir string, sessionDir string) Prepared {
	workspaceRoot := filepath.Join(sessionDir, runtimeWorkspaceDirName)
	workspace := Prepared{SessionDir: sessionDir, Root: workspaceRoot, Cwd: workspaceRoot}
	data, err := os.ReadFile(filepath.Join(sessionDir, runtimeSessionStateFileName))
	if err != nil {
		return staleRuntimeWorkspaceFromLegacyManifest(workDir, sessionDir)
	}
	var state struct {
		Resources []mountedResource `json:"resources"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return workspace
	}
	addMountedResources(workDir, &workspace, state.Resources)
	return workspace
}

func staleRuntimeWorkspaceFromLegacyManifest(workDir string, sessionDir string) Prepared {
	workspace := Prepared{SessionDir: sessionDir, Root: sessionDir, Cwd: sessionDir}
	data, err := os.ReadFile(filepath.Join(sessionDir, ".ama", "resources.json"))
	if err != nil {
		return workspace
	}
	var manifest struct {
		Resources []mountedResource `json:"resources"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return workspace
	}
	addMountedResources(workDir, &workspace, manifest.Resources)
	return workspace
}

func addMountedResources(workDir string, workspace *Prepared, resources []mountedResource) {
	for _, resource := range resources {
		if resource.LocalPath == "" {
			continue
		}
		switch resource.Type {
		case "github_repository":
			if !safeGitHubSegment(resource.Owner) || !safeGitHubSegment(resource.Repo) {
				continue
			}
			workspace.worktrees = append(workspace.worktrees, preparedWorktree{
				cacheDir: filepath.Join(workDir, "repositories", resource.Owner, resource.Repo),
				path:     resource.LocalPath,
			})
		case "memory_store":
			workspace.memoryStores = append(workspace.memoryStores, preparedMemoryStore{
				storeID: resource.StoreID,
				path:    resource.LocalPath,
				access:  resource.Access,
			})
		}
	}
}
