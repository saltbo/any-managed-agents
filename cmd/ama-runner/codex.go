package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type codexCommand struct {
	Path string
	Args []string
}

type codexProcessResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

func (d *RunnerDaemon) runCodexSession(
	ctx context.Context,
	channel RunnerSessionChannel,
	lease *ama.RunnerWorkLease,
	payload WorkPayload,
) error {
	startedAt := time.Now()
	var emitMu sync.Mutex
	emit := func(eventType string, eventPayload ama.JSON) error {
		emitMu.Lock()
		defer emitMu.Unlock()
		return d.writeAcknowledgedChannelEvent(ctx, channel, eventType, eventPayload)
	}
	result, runErr := d.runCodexProcess(ctx, payload, emit)
	eventPayload := ama.JSON{
		"sessionId":  payload.SessionID,
		"status":     "completed",
		"exitCode":   result.ExitCode,
		"durationMs": time.Since(startedAt).Milliseconds(),
	}
	if runErr != nil {
		eventPayload["status"] = "error"
		eventPayload["error"] = ama.JSON{"message": runErr.Error()}
		_ = d.writeAcknowledgedChannelEvent(ctx, channel, "codex.error", ama.JSON{
			"error": ama.JSON{"message": runErr.Error()},
			"code":  result.ExitCode,
		})
		if err := d.writeAcknowledgedChannelEvent(ctx, channel, "codex.lifecycle", eventPayload); err != nil {
			return err
		}
		return d.finishFailed(context.Background(), lease, runErr, ama.JSON{
			"stdout":   result.Stdout,
			"stderr":   result.Stderr,
			"exitCode": result.ExitCode,
		})
	}
	if err := d.writeAcknowledgedChannelEvent(ctx, channel, "codex.lifecycle", eventPayload); err != nil {
		return err
	}
	_, err := d.Client.UpdateRunnerLease(ctx, d.RunnerID, lease.ID, ama.UpdateRunnerLeaseRequest{
		Status: "completed",
		Result: ama.JSON{
			"runtime":  payload.Runtime,
			"provider": payload.Provider,
			"model":    payload.Model,
			"stdout":   result.Stdout,
			"stderr":   result.Stderr,
			"exitCode": result.ExitCode,
		},
	})
	return err
}

func (d *RunnerDaemon) runCodexProcess(
	ctx context.Context,
	payload WorkPayload,
	emit func(eventType string, eventPayload ama.JSON) error,
) (codexProcessResult, error) {
	command, err := codexCommandFromRuntimeConfig(payload.RuntimeConfig)
	if err != nil {
		return codexProcessResult{ExitCode: 1}, err
	}
	workDir, err := prepareSessionWorkspace(d.Config.WorkDir, payload.SessionID)
	if err != nil {
		return codexProcessResult{ExitCode: 1}, err
	}
	env, err := codexProcessEnvironment(workDir, payload)
	if err != nil {
		return codexProcessResult{ExitCode: 1}, err
	}
	commandCtx, cancel := context.WithTimeout(ctx, d.Config.CommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, command.Path, command.Args...)
	cmd.Dir = workDir
	cmd.Env = env
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	stdin := strings.NewReader(initialPrompt(payload))
	stdout := newCodexEventWriter("stdout", emit)
	stderr := newCodexEventWriter("stderr", emit)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Stdin = stdin
	if err := cmd.Start(); err != nil {
		return codexProcessResult{ExitCode: 1}, err
	}

	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cmd.Wait()
	}()

	var waitErr error
	select {
	case waitErr = <-waitDone:
	case <-commandCtx.Done():
		d.stopCodexProcess(cmd)
		waitErr = <-waitDone
	}
	if err := stdout.Flush(); err != nil {
		return codexProcessResult{ExitCode: 1, Stdout: stdout.String(), Stderr: stderr.String()}, err
	}
	if err := stderr.Flush(); err != nil {
		return codexProcessResult{ExitCode: 1, Stdout: stdout.String(), Stderr: stderr.String()}, err
	}

	exitCode := 0
	if waitErr != nil {
		exitCode = 1
		var exitError *exec.ExitError
		if asExitError(waitErr, &exitError) {
			exitCode = exitError.ExitCode()
		}
	}
	result := codexProcessResult{ExitCode: exitCode, Stdout: stdout.String(), Stderr: stderr.String()}
	if commandCtx.Err() != nil {
		return result, commandCtx.Err()
	}
	if waitErr != nil {
		return result, fmt.Errorf("codex command exited with code %d", exitCode)
	}
	return result, nil
}

func codexCommandFromRuntimeConfig(runtimeConfig map[string]any) (codexCommand, error) {
	value, ok := runtimeConfig["command"].(string)
	if !ok || strings.TrimSpace(value) == "" {
		return codexCommand{}, fmt.Errorf("codex runtimeConfig.command is required")
	}
	args, err := stringSliceConfig(runtimeConfig["args"])
	if err != nil {
		return codexCommand{}, err
	}
	return codexCommand{Path: value, Args: args}, nil
}

func stringSliceConfig(value any) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("codex runtimeConfig.args must be a string array")
	}
	args := make([]string, 0, len(items))
	for _, item := range items {
		arg, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("codex runtimeConfig.args must be a string array")
		}
		args = append(args, arg)
	}
	return args, nil
}

func prepareSessionWorkspace(root string, sessionID string) (string, error) {
	if sessionID == "" || filepath.Base(sessionID) != sessionID || sessionID == "." || sessionID == ".." {
		return "", fmt.Errorf("session id must be a single path segment")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(absRoot, 0o755); err != nil {
		return "", err
	}
	resolvedRoot, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		return "", err
	}
	sessionDir := filepath.Join(resolvedRoot, "sessions", sessionID)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return "", err
	}
	resolvedSessionDir, err := filepath.EvalSymlinks(sessionDir)
	if err != nil {
		return "", err
	}
	if err := ensureUnderWorkspace(resolvedRoot, resolvedSessionDir); err != nil {
		return "", err
	}
	return resolvedSessionDir, nil
}

func codexProcessEnvironment(workDir string, payload WorkPayload) ([]string, error) {
	env, err := processCommandEnvironment(workDir)
	if err != nil {
		return nil, err
	}
	runtimeConfig, err := json.Marshal(payload.RuntimeConfig)
	if err != nil {
		return nil, err
	}
	env = append(env,
		"AMA_SESSION_ID="+payload.SessionID,
		"AMA_RUNTIME="+payload.Runtime,
		"AMA_RUNTIME_DRIVER="+payload.RuntimeDriver,
		"AMA_PROVIDER="+payload.Provider,
		"AMA_MODEL="+payload.Model,
		"AMA_WORKSPACE="+workDir,
		"AMA_RUNTIME_CONFIG="+string(runtimeConfig),
	)
	return env, nil
}

func initialPrompt(payload WorkPayload) string {
	if payload.InitialPrompt == nil {
		return ""
	}
	return *payload.InitialPrompt
}

type codexEventWriter struct {
	stream   string
	emit     func(string, ama.JSON) error
	mu       sync.Mutex
	captured bytes.Buffer
	pending  bytes.Buffer
	err      error
}

func newCodexEventWriter(stream string, emit func(string, ama.JSON) error) *codexEventWriter {
	return &codexEventWriter{stream: stream, emit: emit}
}

func (w *codexEventWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	written := len(data)
	w.captured.Write(data)
	for len(data) > 0 {
		index := bytes.IndexByte(data, '\n')
		if index < 0 {
			w.pending.Write(data)
			return written, w.err
		}
		w.pending.Write(data[:index])
		w.emitLine(w.pending.String())
		w.pending.Reset()
		data = data[index+1:]
	}
	return written, w.err
}

func (w *codexEventWriter) Flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.pending.Len() > 0 {
		w.emitLine(w.pending.String())
		w.pending.Reset()
	}
	return w.err
}

func (w *codexEventWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.captured.String()
}

func (w *codexEventWriter) emitLine(line string) {
	if w.err != nil {
		return
	}
	if w.stream == "stdout" {
		w.err = writeCodexStdoutLine(line, w.emit)
		return
	}
	w.err = w.emit("codex.output", ama.JSON{"stream": w.stream, "content": line})
}

func writeCodexStdoutLine(line string, emit func(string, ama.JSON) error) error {
	var event struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if json.Unmarshal([]byte(line), &event) == nil && event.Type != "" {
		payload := event.Payload
		if payload == nil {
			payload = map[string]any{}
		}
		return emit(event.Type, ama.JSON(payload))
	}
	return emit("codex.output", ama.JSON{"stream": "stdout", "content": line})
}

func (d *RunnerDaemon) stopCodexProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if runtime.GOOS != "windows" {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		time.Sleep(d.Config.ShutdownGraceInterval)
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		return
	}
	_ = cmd.Process.Kill()
}
