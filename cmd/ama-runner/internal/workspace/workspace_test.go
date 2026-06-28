package workspace

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

func TestWorkspaceSafety(t *testing.T) {
	workDir := t.TempDir()
	workspace, err := Open(filepath.Join(workDir, "missing-parent", "child"), "session_1")
	if err != nil {
		t.Fatalf("expected workspace creation success, got %v", err)
	}
	if !strings.HasSuffix(workspace.Root, filepath.Join("sessions", "session_1", "workspace")) {
		t.Fatalf("expected session workspace path, got %q", workspace.Root)
	}
	if _, err := Open(workDir, "../outside-session"); err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected traversal rejection, got %v", err)
	}
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(fileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace root file error")
	}
}

func TestPrepareWorkspaceMountsGitHubRepositoryWorktree(t *testing.T) {
	workDir := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "init", "-b", "main")
	runGit(t, sourceDir, "config", "user.email", "runner@example.test")
	runGit(t, sourceDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("zpan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "commit", "-m", "init")
	cacheDir := filepath.Join(workDir, "repositories", "saltbo", "zpan")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, filepath.Dir(cacheDir), "clone", sourceDir, cacheDir)

	workspace, err := Prepare(context.Background(), PrepareRequest{WorkDir: workDir, SessionID: "session_1", Volumes: []protocol.Volume{{
		Type:  "github_repository",
		Name:  "source",
		Owner: "saltbo",
		Repo:  "zpan",
		Ref:   "main",
	}}})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if !strings.HasSuffix(workspace.Dir, filepath.Join("sessions", "session_1")) {
		t.Fatalf("expected session private dir, got %q", workspace.Dir)
	}
	if !strings.HasSuffix(workspace.Root, filepath.Join("sessions", "session_1", "workspace")) {
		t.Fatalf("expected session root, got %q", workspace.Root)
	}
	if workspace.Cwd != workspace.Root {
		t.Fatalf("expected workspace root cwd, got %q", workspace.Cwd)
	}
	repoPath := filepath.Join(workspace.Root, "repos", "saltbo", "zpan")
	if data, err := os.ReadFile(filepath.Join(repoPath, "README.md")); err != nil || string(data) != "zpan\n" {
		t.Fatalf("expected mounted repo content, got %q err=%v", string(data), err)
	}
	gitFile, err := os.Stat(filepath.Join(repoPath, ".git"))
	if err != nil {
		t.Fatal(err)
	}
	if gitFile.IsDir() {
		t.Fatal("expected git worktree metadata file, got a full clone")
	}
	if _, err := os.Stat(filepath.Join(workspace.Root, ".ama", "resources.json")); !os.IsNotExist(err) {
		t.Fatalf("expected no legacy workspace manifest, got err=%v", err)
	}
	state, err := os.ReadFile(filepath.Join(workspace.Dir, SessionStateFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(state), `"status": "mounted"`) || !strings.Contains(string(state), repoPath) {
		t.Fatalf("expected mounted volume state, got %s", string(state))
	}
	if err := workspace.Cleanup(context.Background()); err != nil {
		t.Fatalf("expected workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("expected session root cleanup, got err=%v", err)
	}
	worktrees := runGitOutput(t, cacheDir, "worktree", "list", "--porcelain")
	if strings.Contains(worktrees, repoPath) {
		t.Fatalf("expected git worktree metadata cleanup, got %s", worktrees)
	}
}

func TestPrepareWorkspaceMountsMemoryStoreFiles(t *testing.T) {
	workDir := t.TempDir()
	description := "maintainer notes"
	workspace, err := Prepare(context.Background(), PrepareRequest{WorkDir: workDir, SessionID: "session_1", Volumes: []protocol.Volume{{
		Type:        "memory_store",
		Name:        "maintainer-memory",
		StoreID:     "memstore_1",
		Description: &description,
		Access:      "read_write",
		Memories: []protocol.MemorySnapshot{{
			Path:    "ak-maintainer-heartbeat.md",
			Content: "initial heartbeat\n",
		}},
	}}})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	memoryPath := filepath.Join(workspace.Root, ".ama", "memory-stores", "memstore_1", "ak-maintainer-heartbeat.md")
	data, err := os.ReadFile(memoryPath)
	if err != nil || string(data) != "initial heartbeat\n" {
		t.Fatalf("expected mounted memory content, got %q err=%v", string(data), err)
	}
	if err := os.WriteFile(memoryPath, []byte("updated heartbeat\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	snapshots, err := workspace.ReadWritableMemoryStores()
	if err != nil {
		t.Fatalf("expected memory snapshot readback, got %v", err)
	}
	if len(snapshots) != 1 || snapshots[0].StoreID != "memstore_1" || len(snapshots[0].Memories) != 1 {
		t.Fatalf("expected one memory store snapshot, got %#v", snapshots)
	}
	if got := snapshots[0].Memories[0]; got.Path != "ak-maintainer-heartbeat.md" || got.Content != "updated heartbeat\n" {
		t.Fatalf("expected updated memory snapshot, got %#v", got)
	}
	if _, err := os.Stat(filepath.Join(workspace.Root, ".ama", "resources.json")); !os.IsNotExist(err) {
		t.Fatalf("expected no legacy workspace manifest, got err=%v", err)
	}
	state, err := os.ReadFile(filepath.Join(workspace.Dir, SessionStateFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(state), `"type": "memory_store"`) ||
		!strings.Contains(string(state), `"status": "mounted"`) ||
		strings.Contains(string(state), "initial heartbeat") {
		t.Fatalf("expected mounted memory state without memory content, got %s", string(state))
	}
}

func TestWorkspaceReadsWritableMemoryStores(t *testing.T) {
	workDir := t.TempDir()
	volume := protocol.Volume{
		Type:    "memory_store",
		Name:    "maintainer-memory",
		StoreID: "memstore_1",
		Access:  "read_write",
		Memories: []protocol.MemorySnapshot{{
			Path:    "notes/plan.md",
			Content: "initial plan\n",
		}},
	}
	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Volumes:   []protocol.Volume{volume},
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	updatedPath := filepath.Join(workspace.Root, ".ama", "memory-stores", "memstore_1", "notes", "plan.md")
	if err := os.WriteFile(updatedPath, []byte("updated plan\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	stores, err := workspace.ReadWritableMemoryStores()
	if err != nil {
		t.Fatalf("expected memory store read success, got %v", err)
	}
	if len(stores) != 1 || stores[0].StoreID != "memstore_1" || len(stores[0].Memories) != 1 {
		t.Fatalf("expected one memory store, got %#v", stores)
	}
	if got := stores[0].Memories[0]; got.Path != "notes/plan.md" || got.Content != "updated plan\n" {
		t.Fatalf("expected updated memory content, got %#v", got)
	}
}

func TestWorkspaceAgentSystemPromptIncludesCapabilities(t *testing.T) {
	prompt := (&Workspace{}).AgentSystemPrompt(map[string]any{
		"systemPrompt":    "Be precise.",
		"skills":          []any{"review", "triage"},
		"capabilityTags":  []any{"go", "runner"},
		"subagents":       []any{map[string]any{"username": "reviewer", "role": "review"}},
		"handoffPolicy":   map[string]any{"enabled": true},
		"ignoredProperty": "ignored",
	})
	for _, want := range []string{
		"Be precise.",
		"Skills: review, triage",
		"Capability tags: go, runner",
		"Available subagents: @reviewer (review)",
		`Handoff policy: {"enabled":true}`,
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("expected prompt to contain %q, got %s", want, prompt)
		}
	}
}

func TestPrepareWorkspaceRejectsUnsafeMemoryPath(t *testing.T) {
	_, err := Prepare(context.Background(), PrepareRequest{WorkDir: t.TempDir(), SessionID: "session_1", Volumes: []protocol.Volume{{
		Type:    "memory_store",
		Name:    "maintainer-memory",
		StoreID: "memstore_1",
		Access:  "read_write",
		Memories: []protocol.MemorySnapshot{{
			Path:    "../outside.md",
			Content: "bad",
		}},
	}}})
	if err == nil || !strings.Contains(err.Error(), "memory path must stay inside") {
		t.Fatalf("expected unsafe memory path error, got %v", err)
	}
}

func TestCleanupWorkspaceRemovesReadOnlyMemoryStore(t *testing.T) {
	workspace, err := Prepare(context.Background(), PrepareRequest{WorkDir: t.TempDir(), SessionID: "session_1", Volumes: []protocol.Volume{{
		Type:    "memory_store",
		Name:    "maintainer-memory",
		StoreID: "memstore_1",
		Access:  "read_only",
		Memories: []protocol.MemorySnapshot{{
			Path:    "ak-maintainer-heartbeat.md",
			Content: "initial heartbeat\n",
		}},
	}}})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if err := workspace.Cleanup(context.Background()); err != nil {
		t.Fatalf("expected read-only memory workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("expected session root cleanup, got err=%v", err)
	}
}

func TestPrepareWorkspaceConfiguresSessionScopedGitCredentialFromGHToken(t *testing.T) {
	workDir := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "init", "-b", "main")
	runGit(t, sourceDir, "config", "user.email", "runner@example.test")
	runGit(t, sourceDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("zpan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "commit", "-m", "init")
	cacheDir := filepath.Join(workDir, "repositories", "saltbo", "zpan")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, filepath.Dir(cacheDir), "clone", sourceDir, cacheDir)
	volume := protocol.Volume{
		Type:  "github_repository",
		Name:  "source",
		Owner: "saltbo",
		Repo:  "zpan",
		Ref:   "main",
	}

	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:    workDir,
		SessionID:  "session_1",
		Volumes:    []protocol.Volume{volume},
		RuntimeEnv: map[string]string{"GH_TOKEN": "ghs_session_token"},
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	credentialsPath := filepath.Join(workspace.Dir, "git-credentials")
	credentials, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatalf("expected session credential store, got %v", err)
	}
	if string(credentials) != "https://x-access-token:ghs_session_token@github.com\n" {
		t.Fatalf("expected GH_TOKEN credential line, got %q", string(credentials))
	}
	info, err := os.Stat(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected credential store mode 0600, got %v", info.Mode().Perm())
	}
	repoPath := filepath.Join(workspace.Root, "repos", "saltbo", "zpan")
	helpers := runGitOutput(t, repoPath, "config", "--worktree", "--get-all", "credential.helper")
	if !strings.Contains(helpers, fmt.Sprintf("store --file %q", credentialsPath)) {
		t.Fatalf("expected worktree credential helper pointing at the session store, got %q", helpers)
	}
	if !strings.HasPrefix(helpers, "\n") {
		t.Fatalf("expected an empty helper entry resetting inherited helpers, got %q", helpers)
	}

	// A token must stay scoped to its session: a second workspace from the
	// same repository cache prepared without GH_TOKEN sees no helper.
	second, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_2",
		Volumes:   []protocol.Volume{volume},
	})
	if err != nil {
		t.Fatalf("expected second workspace preparation success, got %v", err)
	}
	leakCheck := exec.Command("git", "config", "--worktree", "--get-all", "credential.helper")
	leakCheck.Dir = filepath.Join(second.Root, "repos", "saltbo", "zpan")
	if output, err := leakCheck.CombinedOutput(); err == nil && strings.TrimSpace(string(output)) != "" {
		t.Fatalf("expected no credential helper leak into other sessions, got %q", string(output))
	}
	if _, err := os.Stat(filepath.Join(second.Dir, "git-credentials")); !os.IsNotExist(err) {
		t.Fatalf("expected no credential store without GH_TOKEN, got err=%v", err)
	}
	for _, prepared := range []*Workspace{workspace, second} {
		if err := prepared.Cleanup(context.Background()); err != nil {
			t.Fatalf("expected workspace cleanup success, got %v", err)
		}
	}
}

func TestPrepareWorkspaceSerializesSharedRepositoryCache(t *testing.T) {
	workDir := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "init", "-b", "main")
	runGit(t, sourceDir, "config", "user.email", "runner@example.test")
	runGit(t, sourceDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("zpan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "commit", "-m", "init")
	cacheDir := filepath.Join(workDir, "repositories", "saltbo", "zpan")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, filepath.Dir(cacheDir), "clone", sourceDir, cacheDir)

	volume := protocol.Volume{
		Type:  "github_repository",
		Name:  "source",
		Owner: "saltbo",
		Repo:  "zpan",
		Ref:   "main",
	}
	workspaces := make(chan *Workspace, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, sessionID := range []string{"session_1", "session_2"} {
		wg.Add(1)
		go func(sessionID string) {
			defer wg.Done()
			workspace, err := Prepare(context.Background(), PrepareRequest{
				WorkDir:   workDir,
				SessionID: sessionID,
				Volumes:   []protocol.Volume{volume},
			})
			if err != nil {
				errs <- err
				return
			}
			workspaces <- workspace
		}(sessionID)
	}
	wg.Wait()
	close(errs)
	close(workspaces)
	for err := range errs {
		t.Fatalf("expected concurrent workspace preparation success, got %v", err)
	}
	for workspace := range workspaces {
		repoPath := filepath.Join(workspace.Root, "repos", "saltbo", "zpan")
		if data, err := os.ReadFile(filepath.Join(repoPath, "README.md")); err != nil || string(data) != "zpan\n" {
			t.Fatalf("expected mounted repo content, got %q err=%v", string(data), err)
		}
		if err := workspace.Cleanup(context.Background()); err != nil {
			t.Fatalf("expected concurrent workspace cleanup success, got %v", err)
		}
	}
}

func TestCleanupStaleWorkspacesRemovesExpiredSessionRoots(t *testing.T) {
	workDir := t.TempDir()
	sessionRoot := filepath.Join(workDir, "sessions", "session_old")
	if err := os.MkdirAll(filepath.Join(sessionRoot, ".ama"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(sessionRoot, old, old); err != nil {
		t.Fatal(err)
	}
	if err := CleanupStale(context.Background(), workDir, time.Hour); err != nil {
		t.Fatalf("expected stale workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(sessionRoot); !os.IsNotExist(err) {
		t.Fatalf("expected stale session root cleanup, got err=%v", err)
	}
}

func runGit(t *testing.T, cwd string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v: %s", strings.Join(args, " "), err, string(output))
	}
}

func runGitOutput(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v: %s", strings.Join(args, " "), err, string(output))
	}
	return string(output)
}
