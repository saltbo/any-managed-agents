package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
)

type ToolRequest struct {
	ToolCallID string
	ToolName   string
	Input      map[string]any
	WorkDir    string
}

type ToolResult struct {
	Output map[string]any
}

type SandboxAdapter interface {
	Execute(ctx context.Context, request ToolRequest) (ToolResult, error)
}

type ProcessAdapter struct {
	CommandTimeout        time.Duration
	ShutdownGraceInterval time.Duration
}

func (a ProcessAdapter) Execute(ctx context.Context, request ToolRequest) (ToolResult, error) {
	switch request.ToolName {
	case "sandbox.exec":
		return a.exec(ctx, request)
	case "sandbox.read":
		return a.read(request)
	case "sandbox.write":
		return a.write(request)
	default:
		return ToolResult{}, fmt.Errorf("unsupported sandbox tool: %s", request.ToolName)
	}
}

func (a ProcessAdapter) exec(ctx context.Context, request ToolRequest) (ToolResult, error) {
	command, ok := StringInput(request.Input, "command")
	if !ok || strings.TrimSpace(command) == "" {
		return ToolResult{}, fmt.Errorf("sandbox.exec requires a non-empty command")
	}
	timeout := a.CommandTimeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	env, err := ProcessCommandEnvironment(request.WorkDir)
	if err != nil {
		return ToolResult{}, err
	}
	cmd := exec.CommandContext(commandCtx, "sh", "-lc", command)
	cmd.Dir = request.WorkDir
	cmd.Env = env
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return ToolResult{}, err
	}
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	var waitErr error
	select {
	case waitErr = <-done:
	case <-commandCtx.Done():
		a.stopProcess(cmd)
		waitErr = <-done
	}
	exitCode := 0
	if waitErr != nil {
		exitCode = 1
		var exitError *exec.ExitError
		if AsExitError(waitErr, &exitError) {
			exitCode = exitError.ExitCode()
		}
	}
	output := map[string]any{
		"stdout":   stdout.String(),
		"stderr":   stderr.String(),
		"exitCode": exitCode,
	}
	if commandCtx.Err() != nil {
		return ToolResult{Output: output}, commandCtx.Err()
	}
	if waitErr != nil {
		return ToolResult{Output: output}, fmt.Errorf("command exited with code %d", exitCode)
	}
	return ToolResult{Output: output}, nil
}

func (a ProcessAdapter) read(request ToolRequest) (ToolResult, error) {
	path, ok := StringInput(request.Input, "path")
	if !ok || strings.TrimSpace(path) == "" {
		return ToolResult{}, fmt.Errorf("sandbox.read requires a path")
	}
	resolved, err := ResolveReadPath(request.WorkDir, path)
	if err != nil {
		return ToolResult{}, err
	}
	content, err := os.ReadFile(resolved)
	if err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Output: map[string]any{"content": string(content)}}, nil
}

func (a ProcessAdapter) write(request ToolRequest) (ToolResult, error) {
	path, ok := StringInput(request.Input, "path")
	if !ok || strings.TrimSpace(path) == "" {
		return ToolResult{}, fmt.Errorf("sandbox.write requires a path")
	}
	content, ok := StringInput(request.Input, "content")
	if !ok {
		return ToolResult{}, fmt.Errorf("sandbox.write requires string content")
	}
	resolved, err := ResolveWritePath(request.WorkDir, path)
	if err != nil {
		return ToolResult{}, err
	}
	if err := os.WriteFile(resolved, []byte(content), 0o644); err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Output: map[string]any{"ok": true}}, nil
}

func (a ProcessAdapter) stopProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if runtime.GOOS != "windows" {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		time.Sleep(a.ShutdownGraceInterval)
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		return
	}
	_ = cmd.Process.Kill()
}

func StringInput(input map[string]any, key string) (string, bool) {
	value, ok := input[key].(string)
	return value, ok
}

func ProcessCommandEnvironment(workDir string) ([]string, error) {
	root, err := filepath.Abs(workDir)
	if err != nil {
		return nil, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	envRoot := ProcessEnvironmentRoot(root)
	homeDir, err := PrepareProcessEnvironmentDir(envRoot, ".home")
	if err != nil {
		return nil, err
	}
	tempDir, err := PrepareProcessEnvironmentDir(envRoot, ".tmp")
	if err != nil {
		return nil, err
	}

	env := []string{
		"HOME=" + homeDir,
		"TMPDIR=" + tempDir,
		"TEMP=" + tempDir,
		"TMP=" + tempDir,
	}
	for _, key := range []string{"PATH", "SystemRoot", "ComSpec"} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env, nil
}

func ProcessEnvironmentRoot(workDir string) string {
	if filepath.Base(workDir) != workspace.WorkspaceDirName {
		return workDir
	}
	sessionDir := filepath.Dir(workDir)
	if filepath.Base(filepath.Dir(sessionDir)) != workspace.SessionsDirName {
		return workDir
	}
	return sessionDir
}

func PrepareProcessEnvironmentDir(root string, name string) (string, error) {
	dir := filepath.Join(root, name)
	info, err := os.Lstat(dir)
	if os.IsNotExist(err) {
		if err := os.Mkdir(dir, 0o700); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("process environment directories must not be symlinks")
		}
		if !info.IsDir() {
			return "", fmt.Errorf("process environment path must be a directory")
		}
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", err
	}
	if err := EnsureUnderWorkspace(root, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func ResolveReadPath(workDir string, path string) (string, error) {
	root, relative, err := WorkspaceRootAndRelativePath(workDir, path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, relative))
	if err != nil {
		return "", err
	}
	if err := EnsureUnderWorkspace(root, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func ResolveWritePath(workDir string, path string) (string, error) {
	root, relative, err := WorkspaceRootAndRelativePath(workDir, path)
	if err != nil {
		return "", err
	}
	parent, err := EnsureWorkspaceParent(root, filepath.Dir(relative))
	if err != nil {
		return "", err
	}
	resolved := filepath.Join(parent, filepath.Base(relative))
	if info, err := os.Lstat(resolved); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("sandbox file paths must not traverse symlinks")
	}
	if err := EnsureUnderWorkspace(root, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func WorkspaceRootAndRelativePath(workDir string, path string) (string, string, error) {
	root, err := filepath.Abs(workDir)
	if err != nil {
		return "", "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", "", err
	}
	candidate := path
	if strings.HasPrefix(candidate, "/workspace/") {
		candidate = strings.TrimPrefix(candidate, "/workspace/")
	}
	if filepath.IsAbs(candidate) {
		return "", "", fmt.Errorf("sandbox file paths must stay under workspace")
	}
	relative := filepath.Clean(candidate)
	if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("sandbox file paths must stay under workspace")
	}
	return root, relative, nil
}

func EnsureWorkspaceParent(root string, relativeParent string) (string, error) {
	parent := root
	if relativeParent == "." {
		return parent, nil
	}
	for _, part := range strings.Split(relativeParent, string(filepath.Separator)) {
		next := filepath.Join(parent, part)
		info, err := os.Lstat(next)
		if os.IsNotExist(err) {
			if err := os.Mkdir(next, 0o755); err != nil {
				return "", err
			}
			parent = next
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("sandbox file paths must not traverse symlinks")
		}
		if !info.IsDir() {
			return "", fmt.Errorf("sandbox file parent must be a directory")
		}
		parent = next
	}
	return parent, EnsureUnderWorkspace(root, parent)
}

func EnsureUnderWorkspace(root string, resolved string) error {
	resolved, err := filepath.Abs(resolved)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("sandbox file paths must stay under workspace")
	}
	return nil
}

func AsExitError(err error, target **exec.ExitError) bool {
	if exitError, ok := err.(*exec.ExitError); ok {
		*target = exitError
		return true
	}
	return false
}
