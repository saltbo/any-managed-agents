package main

import (
	"bufio"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestRuntimeAdapterForUsesSDKBridgeForOfficialRuntimes(t *testing.T) {
	for _, runtimeName := range []string{"codex", "claude-code", "copilot"} {
		adapter, err := runtimeAdapterFor(runtimeName, time.Second, time.Millisecond)
		if err != nil {
			t.Fatalf("expected %s adapter, got %v", runtimeName, err)
		}
		bridge, ok := adapter.(SDKBridgeRuntimeAdapter)
		if !ok {
			t.Fatalf("expected %s to use SDK bridge adapter, got %T", runtimeName, adapter)
		}
		if bridge.Runtime != runtimeName {
			t.Fatalf("expected bridge runtime %q, got %#v", runtimeName, bridge)
		}
	}
	if _, err := runtimeAdapterFor("unknown", time.Second, time.Millisecond); err == nil || !strings.Contains(err.Error(), "unsupported external runtime") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentSanitizesRunnerSecrets(t *testing.T) {
	t.Setenv("AMA_TOKEN", "operator-token")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "operator-secret")
	workDir := t.TempDir()
	env, err := runtimeCommandEnvironment(RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"mode": "test"},
		Provider:      "provider_codex",
		Model:         "gpt-5.3-codex",
		WorkDir:       workDir,
	})
	if err != nil {
		t.Fatalf("expected runtime env, got %v", err)
	}
	envText := strings.Join(env, "\n")
	for _, expected := range []string{
		"AMA_SESSION_ID=session_1",
		"AMA_RUNTIME=codex",
		"AMA_PROVIDER=provider_codex",
		"AMA_MODEL=gpt-5.3-codex",
		"AMA_WORKSPACE=" + workDir,
		`AMA_RUNTIME_CONFIG={"mode":"test"}`,
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected env %q in %q", expected, envText)
		}
	}
	for _, leaked := range []string{"operator-token", "operator-secret", "AMA_INITIAL_PROMPT="} {
		if strings.Contains(envText, leaked) {
			t.Fatalf("expected sanitized runtime env, found %q in %q", leaked, envText)
		}
	}
}

func TestRuntimeCommandEnvironmentRejectsUnserializableConfig(t *testing.T) {
	if _, err := runtimeCommandEnvironment(RuntimeRequest{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"bad": make(chan int)},
		WorkDir:       t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected runtime config marshal error, got %v", err)
	}
}

func TestRuntimeBridgeHostEnvIncludesNodeToolchainAndTestModeOnly(t *testing.T) {
	t.Setenv("VOLTA_HOME", "/volta")
	t.Setenv("NODE_PATH", "/node-path")
	t.Setenv("PNPM_HOME", "/pnpm")
	t.Setenv("NVM_DIR", "/nvm")
	t.Setenv("AMA_RUNTIME_BRIDGE_TEST_MODE", "1")
	t.Setenv("AMA_TOKEN", "raw-secret-value")
	env := appendRuntimeBridgeHostEnv([]string{"PATH=/bin"})
	envText := strings.Join(env, "\n")
	for _, expected := range []string{
		"AMA_RUNTIME_BRIDGE_HOST_HOME=",
		"VOLTA_HOME=/volta",
		"NODE_PATH=/node-path",
		"PNPM_HOME=/pnpm",
		"NVM_DIR=/nvm",
		"AMA_RUNTIME_BRIDGE_TEST_MODE=1",
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected bridge host env %q in %q", expected, envText)
		}
	}
	if strings.Contains(envText, "raw-secret-value") {
		t.Fatalf("expected runner secrets to remain filtered, got %q", envText)
	}
}

func TestSDKBridgeRuntimeContextDoesNotApplyCommandTimeout(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	commandCtx, cancelCommand := SDKBridgeRuntimeAdapter{
		CommandTimeout: time.Nanosecond,
	}.commandContext(parent)
	defer cancelCommand()

	select {
	case <-commandCtx.Done():
		t.Fatal("expected SDK bridge context to ignore per-command timeout")
	case <-time.After(5 * time.Millisecond):
	}

	cancelParent()
	select {
	case <-commandCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("expected SDK bridge context to follow parent cancellation")
	}
}

func TestSDKBridgeStopProcessKillsProcessGroup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process group signalling is Unix-specific")
	}
	marker := filepath.Join(t.TempDir(), "child.pid")
	cmd := exec.Command("sh", "-lc", "sleep 300 & echo $! > \"$1\"; wait", "sh", marker)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var childPID string
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(marker)
		if err == nil && strings.TrimSpace(string(data)) != "" {
			childPID = strings.TrimSpace(string(data))
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if childPID == "" {
		t.Fatal("timed out waiting for child pid")
	}
	SDKBridgeRuntimeAdapter{ShutdownGraceInterval: 10 * time.Millisecond}.stopProcess(cmd)
	_ = cmd.Wait()
	if err := exec.Command("kill", "-0", childPID).Run(); err == nil {
		t.Fatalf("expected child process %s to be killed with process group", childPID)
	}
}

func TestRuntimeWorkspaceSafety(t *testing.T) {
	workDir := t.TempDir()
	workspace, err := runtimeWorkspace(filepath.Join(workDir, "missing-parent", "child"), "session_1")
	if err != nil {
		t.Fatalf("expected workspace creation success, got %v", err)
	}
	if !strings.HasSuffix(workspace, filepath.Join("sessions", "session_1")) {
		t.Fatalf("expected session workspace path, got %q", workspace)
	}
	if _, err := runtimeWorkspace(workDir, "../outside-session"); err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected traversal rejection, got %v", err)
	}
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runtimeWorkspace(fileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace root file error")
	}
}

func TestPrepareRuntimeWorkspaceMountsGitHubRepositoryWorktree(t *testing.T) {
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

	workspace, err := prepareRuntimeWorkspace(context.Background(), workDir, "session_1", []ResourceRef{{
		Type:      "github_repository",
		Owner:     "saltbo",
		Repo:      "zpan",
		Ref:       "main",
		MountPath: "/workspace/repos/saltbo/zpan",
	}})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if !strings.HasSuffix(workspace.Root, filepath.Join("sessions", "session_1")) {
		t.Fatalf("expected session root, got %q", workspace.Root)
	}
	if !strings.HasSuffix(workspace.Cwd, filepath.Join("sessions", "session_1", "repos", "saltbo", "zpan")) {
		t.Fatalf("expected repo worktree cwd, got %q", workspace.Cwd)
	}
	if data, err := os.ReadFile(filepath.Join(workspace.Cwd, "README.md")); err != nil || string(data) != "zpan\n" {
		t.Fatalf("expected mounted repo content, got %q err=%v", string(data), err)
	}
	gitFile, err := os.Stat(filepath.Join(workspace.Cwd, ".git"))
	if err != nil {
		t.Fatal(err)
	}
	if gitFile.IsDir() {
		t.Fatal("expected git worktree metadata file, got a full clone")
	}
	manifest, err := os.ReadFile(filepath.Join(workspace.Root, ".ama", "resources.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(manifest), `"status": "mounted"`) || !strings.Contains(string(manifest), workspace.Cwd) {
		t.Fatalf("expected mounted resource manifest, got %s", string(manifest))
	}
	if err := cleanupRuntimeWorkspace(context.Background(), workspace); err != nil {
		t.Fatalf("expected workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("expected session root cleanup, got err=%v", err)
	}
	worktrees := runGitOutput(t, cacheDir, "worktree", "list", "--porcelain")
	if strings.Contains(worktrees, workspace.Cwd) {
		t.Fatalf("expected git worktree metadata cleanup, got %s", worktrees)
	}
}

func TestPrepareRuntimeWorkspaceSerializesSharedRepositoryCache(t *testing.T) {
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

	resource := ResourceRef{
		Type:      "github_repository",
		Owner:     "saltbo",
		Repo:      "zpan",
		Ref:       "main",
		MountPath: "/workspace/repos/saltbo/zpan",
	}
	workspaces := make(chan PreparedWorkspace, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, sessionID := range []string{"session_1", "session_2"} {
		wg.Add(1)
		go func(sessionID string) {
			defer wg.Done()
			workspace, err := prepareRuntimeWorkspace(context.Background(), workDir, sessionID, []ResourceRef{resource})
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
		if data, err := os.ReadFile(filepath.Join(workspace.Cwd, "README.md")); err != nil || string(data) != "zpan\n" {
			t.Fatalf("expected mounted repo content, got %q err=%v", string(data), err)
		}
		if err := cleanupRuntimeWorkspace(context.Background(), workspace); err != nil {
			t.Fatalf("expected concurrent workspace cleanup success, got %v", err)
		}
	}
}

func TestCleanupStaleRuntimeWorkspacesRemovesExpiredSessionRoots(t *testing.T) {
	workDir := t.TempDir()
	sessionRoot := filepath.Join(workDir, "sessions", "session_old")
	if err := os.MkdirAll(filepath.Join(sessionRoot, ".ama"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(sessionRoot, old, old); err != nil {
		t.Fatal(err)
	}
	if err := cleanupStaleRuntimeWorkspaces(context.Background(), workDir, time.Hour); err != nil {
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

func TestMaterializeRuntimeBridgeWritesEmbeddedBundle(t *testing.T) {
	path, err := materializeRuntimeBridge()
	if err != nil {
		t.Fatalf("expected embedded bridge to materialize, got %v", err)
	}
	if !strings.HasSuffix(path, ".mjs") {
		t.Fatalf("expected bridge bundle path, got %q", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(embeddedRuntimeBridge) {
		t.Fatal("expected materialized bridge to match embedded bundle")
	}
}

func TestBridgeProtocolReadsReadyEventsResultsErrorsAndLogs(t *testing.T) {
	output := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"event","requestId":"run_session_1","event":{"type":"message_end","payload":{"message":{"role":"assistant","content":"ok"}}}}`,
		`{"type":"log","requestId":"run_session_1","message":"bridge diagnostic"}`,
		`{"type":"event","requestId":"other","event":{"type":"message_end","payload":{"message":{"role":"assistant","content":"ignored"}}}}`,
		`{"type":"result","requestId":"run_session_1","result":{"exitCode":0,"providerThreadId":"thread_1"}}`,
	}, "\n")
	scanner := bridgeScanner(strings.NewReader(output))
	if err := waitBridgeReady(scanner); err != nil {
		t.Fatalf("expected bridge ready, got %v", err)
	}
	var events []string
	var result ama.JSON
	err := readBridgeMessages(scanner, "run_session_1", func(eventType string, payload ama.JSON) error {
		events = append(events, eventType+":"+mustJSON(t, payload))
		return nil
	}, &result)
	if err != nil {
		t.Fatalf("expected bridge messages, got %v", err)
	}
	if len(events) != 2 || !strings.Contains(events[0], "message_end") || !strings.Contains(events[1], "bridge diagnostic") {
		t.Fatalf("expected forwarded event and log, got %v", events)
	}
	if result["providerThreadId"] != "thread_1" {
		t.Fatalf("expected bridge result, got %#v", result)
	}
}

func TestBridgeProtocolErrorBranches(t *testing.T) {
	if err := waitBridgeReady(bufio.NewScanner(strings.NewReader(`{"type":"log"}` + "\n"))); err == nil || !strings.Contains(err.Error(), "did not send ready") {
		t.Fatalf("expected ready error, got %v", err)
	}
	scanner := bridgeScanner(strings.NewReader(strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"event","requestId":"run_session_1","event":{"payload":{}}}`,
	}, "\n")))
	if err := waitBridgeReady(scanner); err != nil {
		t.Fatal(err)
	}
	var result ama.JSON
	if err := readBridgeMessages(scanner, "run_session_1", func(string, ama.JSON) error { return nil }, &result); err == nil || !strings.Contains(err.Error(), "missing type") {
		t.Fatalf("expected missing event type error, got %v", err)
	}
	scanner = bridgeScanner(strings.NewReader(`{"type":"error","requestId":"run_session_1","error":{"message":"sdk failed"}}` + "\n"))
	if err := readBridgeMessages(scanner, "run_session_1", func(string, ama.JSON) error { return nil }, &result); err == nil || !strings.Contains(err.Error(), "sdk failed") {
		t.Fatalf("expected bridge error, got %v", err)
	}
	writeErr := errors.New("write failed")
	scanner = bridgeScanner(strings.NewReader(`{"type":"log","requestId":"run_session_1","message":"diag"}` + "\n"))
	if err := readBridgeMessages(scanner, "run_session_1", func(string, ama.JSON) error { return writeErr }, &result); !errors.Is(err, writeErr) {
		t.Fatalf("expected writer error, got %v", err)
	}
}

func TestBridgePipeClosedAfterResultOnlyIgnoresCompletedBridgeClose(t *testing.T) {
	if !bridgePipeClosedAfterResult(os.ErrClosed, ama.JSON{"exitCode": 0}) {
		t.Fatal("expected closed bridge pipe after result to be ignored")
	}
	if bridgePipeClosedAfterResult(os.ErrClosed, nil) {
		t.Fatal("expected closed bridge pipe before result to remain fatal")
	}
	if bridgePipeClosedAfterResult(errors.New("bridge failed"), ama.JSON{"exitCode": 0}) {
		t.Fatal("expected non-close bridge errors to remain fatal")
	}
}
