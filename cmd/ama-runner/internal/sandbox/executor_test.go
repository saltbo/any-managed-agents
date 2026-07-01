package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
)

func TestWorkspaceRootAndRelativePathRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	gotRoot, relative, err := WorkspaceRootAndRelativePath(root, "/workspace/nested/file.txt")
	if err != nil {
		t.Fatalf("expected /workspace path to resolve: %v", err)
	}
	if gotRoot == "" || relative != filepath.Join("nested", "file.txt") {
		t.Fatalf("unexpected workspace path result root=%q relative=%q", gotRoot, relative)
	}
	for _, path := range []string{"../outside", "/tmp/outside", "/workspace/../outside"} {
		if _, _, err := WorkspaceRootAndRelativePath(root, path); err == nil {
			t.Fatalf("expected %q to be rejected", path)
		}
	}
}

func TestEnsureWorkspaceParentRejectsUnsafeParents(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file-parent"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureWorkspaceParent(root, filepath.Join("file-parent", "child")); err == nil {
		t.Fatal("expected file parent error")
	}

	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link-parent")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := EnsureWorkspaceParent(root, filepath.Join("link-parent", "child")); err == nil {
		t.Fatal("expected symlink parent error")
	}
}

func TestEnsureUnderWorkspaceRejectsOutsidePath(t *testing.T) {
	root := t.TempDir()
	if err := EnsureUnderWorkspace(root, filepath.Dir(root)); err == nil {
		t.Fatal("expected outside workspace error")
	}
}

func TestAsExitErrorIgnoresNonExitErrors(t *testing.T) {
	var exitErr *exec.ExitError
	if AsExitError(os.ErrPermission, &exitErr) || exitErr != nil {
		t.Fatal("expected non-exit error not to match exec.ExitError")
	}
}

func TestResolveWritePathRejectsSymlinkParents(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveWritePath(root, filepath.Join("link", "file.txt")); err == nil {
		t.Fatal("expected symlink parent to be rejected")
	}
}

func TestProcessCommandEnvironmentUsesSessionPrivateDirs(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "sessions", "session_1", "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	env, err := ProcessCommandEnvironment(workspace)
	if err != nil {
		t.Fatal(err)
	}
	sessionDir, err := filepath.EvalSymlinks(filepath.Dir(workspace))
	if err != nil {
		t.Fatal(err)
	}
	joined := "\n" + strings.Join(env, "\n") + "\n"
	if !strings.Contains(joined, "\nHOME="+filepath.Join(sessionDir, ".home")+"\n") {
		t.Fatalf("expected session-private HOME in env: %v", env)
	}
}

func TestProcessAdapterExecutesSandboxExecInWorkdir(t *testing.T) {
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "pwd && printf ok"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected command success, got %v", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	if !strings.Contains(stdout, workDir) || !strings.Contains(stdout, "ok") {
		t.Fatalf("unexpected stdout %q", stdout)
	}
	if result.Output["exitCode"] != 0 {
		t.Fatalf("unexpected exit code %#v", result.Output["exitCode"])
	}
}

func TestProcessAdapterValidatesToolsAndInputs(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	workDir := t.TempDir()
	cases := []ToolRequest{
		{ToolName: "sandbox.unknown", WorkDir: workDir},
		{ToolName: "bash", Input: map[string]any{"command": " "}, WorkDir: workDir},
		{ToolName: "read", Input: map[string]any{}, WorkDir: workDir},
		{ToolName: "write", Input: map[string]any{"path": " "}, WorkDir: workDir},
		{ToolName: "write", Input: map[string]any{"path": "file.txt"}, WorkDir: workDir},
	}
	for _, request := range cases {
		if _, err := adapter.Execute(context.Background(), request); err == nil {
			t.Fatalf("expected %s with input %#v to fail", request.ToolName, request.Input)
		}
	}
}

func TestProcessAdapterReadAndWrite(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	workDir := t.TempDir()
	if _, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "notes/plan.md", "content": "ship it"},
		WorkDir:  workDir,
	}); err != nil {
		t.Fatalf("write tool failed: %v", err)
	}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "/workspace/notes/plan.md"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("read tool failed: %v", err)
	}
	if result.Output["content"] != "ship it" {
		t.Fatalf("unexpected read result %#v", result.Output)
	}
}

func TestProcessAdapterFindSupportsGlob(t *testing.T) {
	if _, err := exec.LookPath("rg"); err != nil {
		t.Skip("rg is required for find glob support")
	}
	workDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workDir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "src", "app.test.ts"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "src", "app.ts"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}

	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "find",
		Input:    map[string]any{"glob": "**/*.test.ts", "path": "."},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("find tool failed: %v", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	if !strings.Contains(stdout, "src/app.test.ts") || strings.Contains(stdout, "src/app.ts") {
		t.Fatalf("unexpected find output %q", stdout)
	}
}

func TestProcessAdapterExecReportsFailureAndTimeout(t *testing.T) {
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "printf err >&2; exit 7"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "code 7") {
		t.Fatalf("expected exit error, got %v", err)
	}
	if result.Output["exitCode"] != 7 || result.Output["stderr"] != "err" {
		t.Fatalf("unexpected failed output %#v", result.Output)
	}

	timeoutAdapter := ProcessAdapter{CommandTimeout: time.Millisecond, ShutdownGraceInterval: time.Millisecond}
	if _, err := timeoutAdapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "sleep 1"},
		WorkDir:  workDir,
	}); err == nil {
		t.Fatal("expected command timeout")
	}
}

func TestProcessAdapterDoesNotExposeDaemonAMAEnvironment(t *testing.T) {
	operatorHome := t.TempDir()
	t.Setenv("AMA_TOKEN", "secret-token")
	t.Setenv("AMA_ORIGIN", "https://ama.example.com")
	t.Setenv("AMA_RUNNER_NAME", "operator-runner")
	t.Setenv("AMA_RUNNER_ALLOW_UNSAFE_PROCESS", "true")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "runner-operator-secret")
	t.Setenv("AMA_CUSTOM_SECRET", "custom-operator-secret")
	t.Setenv("HOME", operatorHome)

	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "env"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected command success, got %v", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	for _, leaked := range []string{
		"AMA_TOKEN=", "secret-token",
		"AMA_ORIGIN=",
		"AMA_RUNNER_NAME=", "operator-runner",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS=",
		"AMA_RUNNER_OPERATOR_SECRET=", "runner-operator-secret",
		"AMA_CUSTOM_SECRET=", "custom-operator-secret",
		operatorHome,
	} {
		if strings.Contains(stdout, leaked) {
			t.Fatalf("expected scrubbed AMA environment, found %q in %q", leaked, stdout)
		}
	}
	resolvedWorkDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	workspaceHome := filepath.Join(resolvedWorkDir, ".home")
	workspaceTemp := filepath.Join(resolvedWorkDir, ".tmp")
	for _, expected := range []string{"HOME=" + workspaceHome, "TMPDIR=" + workspaceTemp, "TEMP=" + workspaceTemp, "TMP=" + workspaceTemp} {
		if !strings.Contains(stdout, expected) {
			t.Fatalf("expected workspace-scoped environment %q, got %q", expected, stdout)
		}
	}
	if !strings.Contains(stdout, "PATH=") {
		t.Fatalf("expected minimal command environment to include PATH, got %q", stdout)
	}
}

func TestProcessCommandEnvironmentUsesSessionPrivateDirsForRuntimeWorkspace(t *testing.T) {
	sessionDir := filepath.Join(t.TempDir(), "sessions", "session_1")
	workDir := filepath.Join(sessionDir, workspace.WorkspaceDirName)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	env, err := ProcessCommandEnvironment(workDir)
	if err != nil {
		t.Fatalf("expected command environment success, got %v", err)
	}
	resolvedSessionDir, err := filepath.EvalSymlinks(sessionDir)
	if err != nil {
		t.Fatal(err)
	}
	sessionHome := filepath.Join(resolvedSessionDir, ".home")
	sessionTemp := filepath.Join(resolvedSessionDir, ".tmp")
	joined := strings.Join(env, "\n")
	for _, expected := range []string{"HOME=" + sessionHome, "TMPDIR=" + sessionTemp, "TEMP=" + sessionTemp, "TMP=" + sessionTemp} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected session-scoped environment %q, got %q", expected, joined)
		}
	}
	for _, unexpected := range []string{
		filepath.Join(workDir, ".home"),
		filepath.Join(workDir, ".tmp"),
	} {
		if strings.Contains(joined, unexpected) {
			t.Fatalf("expected no workspace-local process directory %q, got %q", unexpected, joined)
		}
	}
}

func TestProcessCommandEnvironmentKeepsOrdinaryWorkspaceDirsLocal(t *testing.T) {
	parent := t.TempDir()
	workDir := filepath.Join(parent, workspace.WorkspaceDirName)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	env, err := ProcessCommandEnvironment(workDir)
	if err != nil {
		t.Fatalf("expected command environment success, got %v", err)
	}
	resolvedWorkDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(env, "\n")
	for _, expected := range []string{
		"HOME=" + filepath.Join(resolvedWorkDir, ".home"),
		"TMPDIR=" + filepath.Join(resolvedWorkDir, ".tmp"),
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected workspace-local environment %q, got %q", expected, joined)
		}
	}
}

func TestProcessCommandEnvironmentFailsWhenWorkspaceHomeOrTempCannotBeCreated(t *testing.T) {
	fileWorkDir := filepath.Join(t.TempDir(), "workspace-file")
	if err := os.WriteFile(fileWorkDir, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ProcessCommandEnvironment(fileWorkDir); err == nil {
		t.Fatal("expected home directory creation error")
	}

	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, ".tmp"), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ProcessCommandEnvironment(workDir); err == nil {
		t.Fatal("expected temp directory creation error")
	}
}

func TestProcessAdapterRejectsSymlinkedEnvironmentDirectories(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	for _, name := range []string{".home", ".tmp"} {
		workDir := t.TempDir()
		outside := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(workDir, name)); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		marker := filepath.Join(workDir, "ran")
		_, err := adapter.Execute(context.Background(), ToolRequest{
			ToolName: "bash",
			Input:    map[string]any{"command": "touch ran"},
			WorkDir:  workDir,
		})
		if err == nil || !strings.Contains(err.Error(), "symlinks") {
			t.Fatalf("expected symlink environment directory rejection for %s, got %v", name, err)
		}
		if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
			t.Fatalf("expected command not to run for %s, marker stat error %v", name, statErr)
		}
	}
}

func TestProcessAdapterRejectsPathsOutsideWorkspace(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "../secret.txt"},
		WorkDir:  t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected path boundary error")
	}
	if !strings.Contains(err.Error(), "under workspace") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestProcessAdapterRejectsSymlinkWorkspaceEscapes(t *testing.T) {
	workDir := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(workDir, "readlink")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(workDir, "writelink")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "readlink"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "under workspace") {
		t.Fatalf("expected read symlink boundary error, got %v", err)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "writelink/out.txt", "content": "bad"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("expected write symlink boundary error, got %v", err)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "readlink", "content": "bad"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("expected final symlink write error, got %v", err)
	}
}

func TestProcessAdapterReadsAndWritesInsideWorkspace(t *testing.T) {
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	write, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "notes/todo.txt", "content": "done"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected write success, got %v", err)
	}
	if write.Output["ok"] != true {
		t.Fatalf("unexpected write output %#v", write.Output)
	}
	if content, err := os.ReadFile(filepath.Join(workDir, "notes", "todo.txt")); err != nil || string(content) != "done" {
		t.Fatalf("unexpected written content %q, %v", content, err)
	}
	read, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "/workspace/notes/todo.txt"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected read success, got %v", err)
	}
	if read.Output["content"] != "done" {
		t.Fatalf("unexpected read output %#v", read.Output)
	}
}

func TestProcessAdapterValidatesReadWriteInputs(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	fileWorkDir := filepath.Join(t.TempDir(), "workspace-file")
	if err := os.WriteFile(fileWorkDir, []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}
	tests := []ToolRequest{
		{ToolName: "read", Input: map[string]any{}, WorkDir: t.TempDir()},
		{ToolName: "read", Input: map[string]any{"path": "missing.txt"}, WorkDir: t.TempDir()},
		{ToolName: "write", Input: map[string]any{"path": "x"}, WorkDir: t.TempDir()},
		{ToolName: "write", Input: map[string]any{"path": "../x", "content": "bad"}, WorkDir: t.TempDir()},
		{ToolName: "write", Input: map[string]any{"path": "child.txt", "content": "bad"}, WorkDir: fileWorkDir},
	}
	for _, request := range tests {
		if _, err := adapter.Execute(context.Background(), request); err == nil {
			t.Fatalf("expected validation error for %#v", request)
		}
	}
}

func TestProcessAdapterRejectsSymlinkEscapes(t *testing.T) {
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	workDir := t.TempDir()
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(workDir, "secret-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workDir, "outside-dir")); err != nil {
		t.Fatal(err)
	}
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, readErr := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "secret-link"},
		WorkDir:  workDir,
	})
	if readErr == nil || !strings.Contains(readErr.Error(), "under workspace") {
		t.Fatalf("expected symlink read escape rejection, got %v", readErr)
	}
	_, writeErr := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "outside-dir/new.txt", "content": "bad"},
		WorkDir:  workDir,
	})
	if writeErr == nil || !strings.Contains(writeErr.Error(), "symlinks") {
		t.Fatalf("expected symlink write escape rejection, got %v", writeErr)
	}
}

func TestProcessAdapterReportsCommandFailureAndTimeout(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: 500 * time.Millisecond, ShutdownGraceInterval: 50 * time.Millisecond}
	failed, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "printf bad >&2; exit 7"},
		WorkDir:  t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected command failure")
	}
	if failed.Output["exitCode"] != 7 {
		t.Fatalf("unexpected failure output %#v", failed.Output)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "sleep 1"},
		WorkDir:  t.TempDir(),
	})
	if err == nil || !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("expected timeout error, got %v", err)
	}
}

func TestProcessAdapterRejectsUnsupportedTools(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "mcp.github.repo.read",
		Input:    map[string]any{},
		WorkDir:  t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected unsupported tool error")
	}
}
