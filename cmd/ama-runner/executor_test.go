package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProcessAdapterExecutesSandboxExecInWorkdir(t *testing.T) {
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "sandbox.exec",
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
		ToolName: "sandbox.exec",
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

func TestProcessCommandEnvironmentFailsWhenWorkspaceHomeOrTempCannotBeCreated(t *testing.T) {
	fileWorkDir := filepath.Join(t.TempDir(), "workspace-file")
	if err := os.WriteFile(fileWorkDir, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := processCommandEnvironment(fileWorkDir); err == nil {
		t.Fatal("expected home directory creation error")
	}

	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, ".tmp"), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := processCommandEnvironment(workDir); err == nil {
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
			ToolName: "sandbox.exec",
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
		ToolName: "sandbox.read",
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
		ToolName: "sandbox.read",
		Input:    map[string]any{"path": "readlink"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "under workspace") {
		t.Fatalf("expected read symlink boundary error, got %v", err)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "sandbox.write",
		Input:    map[string]any{"path": "writelink/out.txt", "content": "bad"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("expected write symlink boundary error, got %v", err)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "sandbox.write",
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
		ToolName: "sandbox.write",
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
		ToolName: "sandbox.read",
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
		{ToolName: "sandbox.read", Input: map[string]any{}, WorkDir: t.TempDir()},
		{ToolName: "sandbox.read", Input: map[string]any{"path": "missing.txt"}, WorkDir: t.TempDir()},
		{ToolName: "sandbox.write", Input: map[string]any{"path": "x"}, WorkDir: t.TempDir()},
		{ToolName: "sandbox.write", Input: map[string]any{"path": "../x", "content": "bad"}, WorkDir: t.TempDir()},
		{ToolName: "sandbox.write", Input: map[string]any{"path": "child.txt", "content": "bad"}, WorkDir: fileWorkDir},
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
		ToolName: "sandbox.read",
		Input:    map[string]any{"path": "secret-link"},
		WorkDir:  workDir,
	})
	if readErr == nil || !strings.Contains(readErr.Error(), "under workspace") {
		t.Fatalf("expected symlink read escape rejection, got %v", readErr)
	}
	_, writeErr := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "sandbox.write",
		Input:    map[string]any{"path": "outside-dir/new.txt", "content": "bad"},
		WorkDir:  workDir,
	})
	if writeErr == nil || !strings.Contains(writeErr.Error(), "symlinks") {
		t.Fatalf("expected symlink write escape rejection, got %v", writeErr)
	}
}

func TestProcessAdapterReportsCommandFailureAndTimeout(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: 20 * time.Millisecond, ShutdownGraceInterval: time.Millisecond}
	failed, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "sandbox.exec",
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
		ToolName: "sandbox.exec",
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
