package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

const RuntimeRetention = 24 * time.Hour

const SessionsDirName = "sessions"
const WorkspaceDirName = "workspace"
const SessionStateFileName = "state.json"

type PrepareRequest struct {
	WorkDir      string
	SessionID    string
	ResourceRefs []protocol.ResourceRef
	RuntimeEnv   map[string]string
}

type Workspace struct {
	Dir          string
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

func Prepare(ctx context.Context, request PrepareRequest) (*Workspace, error) {
	workspace, err := Open(request.WorkDir, request.SessionID)
	if err != nil {
		return nil, err
	}
	githubResources := githubRepositoryResources(request.ResourceRefs)
	memoryResources := memoryStoreResources(request.ResourceRefs)
	mounted := make([]mountedResource, 0, len(githubResources)+len(memoryResources))
	worktrees := make([]preparedWorktree, 0, len(githubResources))
	memoryStores := make([]preparedMemoryStore, 0, len(memoryResources))
	for _, resource := range githubResources {
		localPath, cacheDir, err := materializeGitHubRepository(ctx, request.WorkDir, workspace.Root, resource)
		if err != nil {
			workspace.worktrees = worktrees
			workspace.memoryStores = memoryStores
			_ = workspace.Cleanup(context.Background())
			return nil, err
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
		localPath, err := materializeMemoryStore(workspace.Root, resource)
		if err != nil {
			workspace.worktrees = worktrees
			workspace.memoryStores = memoryStores
			_ = workspace.Cleanup(context.Background())
			return nil, err
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
	workspace.worktrees = worktrees
	workspace.memoryStores = memoryStores
	if err := configureWorkspaceGitCredential(ctx, workspace.Dir, worktrees, workspaceGitHubToken(request.RuntimeEnv)); err != nil {
		_ = workspace.Cleanup(context.Background())
		return nil, err
	}
	if err := writeSessionState(workspace.Dir, workspace.Root, mounted); err != nil {
		_ = workspace.Cleanup(context.Background())
		return nil, err
	}
	return workspace, nil
}

func Open(workDir string, sessionID string) (*Workspace, error) {
	if sessionID == "" || filepath.Base(sessionID) != sessionID || sessionID == "." || sessionID == ".." {
		return nil, fmt.Errorf("session id must be a single path segment")
	}
	root, err := filepath.Abs(workDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	sessionDir := filepath.Join(resolvedRoot, SessionsDirName, sessionID)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return nil, err
	}
	resolvedSessionDir, err := filepath.EvalSymlinks(sessionDir)
	if err != nil {
		return nil, err
	}
	if err := ensureUnderWorkspace(resolvedRoot, resolvedSessionDir); err != nil {
		return nil, err
	}
	workspaceDir := filepath.Join(resolvedSessionDir, WorkspaceDirName)
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return nil, err
	}
	resolvedWorkspaceDir, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		return nil, err
	}
	if err := ensureUnderWorkspace(resolvedSessionDir, resolvedWorkspaceDir); err != nil {
		return nil, err
	}
	return &Workspace{Dir: resolvedSessionDir, Root: resolvedWorkspaceDir, Cwd: resolvedWorkspaceDir}, nil
}

func ensureUnderWorkspace(root string, resolved string) error {
	resolved, err := filepath.Abs(resolved)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("workspace paths must stay under workspace")
	}
	return nil
}

func (w *Workspace) PrepareAgent(ctx context.Context, runtimeName string, agentSnapshot map[string]any) error {
	if w == nil || agentSnapshot == nil {
		return nil
	}
	for _, skill := range agentSkillRefs(agentSnapshot) {
		if err := installAgentSkill(ctx, w.Cwd, runtimeName, skill); err != nil {
			return err
		}
	}
	return materializeSubagents(w.Cwd, runtimeName, agentSubagentProfiles(agentSnapshot))
}

func (w *Workspace) AgentSystemPrompt(agentSnapshot map[string]any) string {
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

func (w *Workspace) ReadMemoryStores(resourceRefs []protocol.ResourceRef) ([]MemoryStoreSnapshot, error) {
	if w == nil {
		return nil, errors.New("workspace is not prepared")
	}
	stores := []MemoryStoreSnapshot{}
	for _, resource := range resourceRefs {
		if resource.Type != "memory_store" || resource.Access != "read_write" {
			continue
		}
		mountPath := strings.TrimPrefix(resource.MountPath, "/workspace/")
		if mountPath == "" || strings.HasPrefix(mountPath, "..") {
			return nil, errors.New("invalid memory store mount path")
		}
		localRoot := filepath.Join(w.Root, mountPath)
		if err := ensureUnderWorkspace(w.Root, localRoot); err != nil {
			return nil, err
		}
		memories, err := readMemoryFiles(localRoot)
		if os.IsNotExist(err) {
			err = nil
		}
		if err != nil {
			return nil, err
		}
		sort.Slice(memories, func(i, j int) bool {
			return memories[i].Path < memories[j].Path
		})
		stores = append(stores, MemoryStoreSnapshot{StoreID: resource.StoreID, Memories: memories})
	}
	return stores, nil
}

func (w *Workspace) ReadWritableMemoryStores() ([]MemoryStoreSnapshot, error) {
	if w == nil {
		return nil, errors.New("workspace is not prepared")
	}
	stores := make([]MemoryStoreSnapshot, 0, len(w.memoryStores))
	for _, store := range w.memoryStores {
		if store.access != "read_write" {
			continue
		}
		memories, err := readMemoryFiles(store.path)
		if err != nil {
			return nil, err
		}
		stores = append(stores, MemoryStoreSnapshot{StoreID: store.storeID, Memories: memories})
	}
	return stores, nil
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

func (w *Workspace) Cleanup(ctx context.Context) error {
	if w == nil {
		return nil
	}
	var errs []string
	for _, memoryStore := range w.memoryStores {
		if err := resetMemoryStorePermissions(memoryStore.path); err != nil {
			errs = append(errs, err.Error())
		}
	}
	for i := len(w.worktrees) - 1; i >= 0; i-- {
		worktree := w.worktrees[i]
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
	if w.Root != "" {
		if err := os.RemoveAll(w.Root); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("cleanup runtime workspace failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

func CleanupStale(ctx context.Context, workDir string, retention time.Duration) error {
	if retention <= 0 {
		return nil
	}
	sessionsDir := filepath.Join(workDir, SessionsDirName)
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
		workspace := staleWorkspace(workDir, root)
		if err := workspace.Cleanup(ctx); err != nil {
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

func staleWorkspace(workDir string, sessionDir string) *Workspace {
	workspaceRoot := filepath.Join(sessionDir, WorkspaceDirName)
	workspace := &Workspace{Dir: sessionDir, Root: workspaceRoot, Cwd: workspaceRoot}
	data, err := os.ReadFile(filepath.Join(sessionDir, SessionStateFileName))
	if err != nil {
		return staleWorkspaceFromLegacyManifest(workDir, sessionDir)
	}
	var state struct {
		Resources []mountedResource `json:"resources"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return workspace
	}
	addMountedResources(workDir, workspace, state.Resources)
	return workspace
}

func staleWorkspaceFromLegacyManifest(workDir string, sessionDir string) *Workspace {
	workspace := &Workspace{Dir: sessionDir, Root: sessionDir, Cwd: sessionDir}
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
	addMountedResources(workDir, workspace, manifest.Resources)
	return workspace
}

func addMountedResources(workDir string, workspace *Workspace, resources []mountedResource) {
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
