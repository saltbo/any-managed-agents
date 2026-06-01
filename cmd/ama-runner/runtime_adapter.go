package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

type RuntimeRequest struct {
	SessionID     string
	Runtime       string
	RuntimeConfig map[string]any
	Provider      string
	Model         string
	InitialPrompt string
	WorkDir       string
}

type RuntimeEventWriter func(eventType string, payload ama.JSON) error

type RuntimeAdapter interface {
	Run(ctx context.Context, request RuntimeRequest, write RuntimeEventWriter) (ama.JSON, error)
}

type ClaudeCodeRuntimeAdapter struct {
	CommandTimeout        time.Duration
	ShutdownGraceInterval time.Duration
}

type ExternalCommandRuntimeAdapter struct {
	Runtime               string
	CommandTimeout        time.Duration
	ShutdownGraceInterval time.Duration
}

func (a ClaudeCodeRuntimeAdapter) Run(
	ctx context.Context,
	request RuntimeRequest,
	write RuntimeEventWriter,
) (ama.JSON, error) {
	return ExternalCommandRuntimeAdapter{
		Runtime:               "claude-code",
		CommandTimeout:        a.CommandTimeout,
		ShutdownGraceInterval: a.ShutdownGraceInterval,
	}.Run(ctx, request, write)
}

func (a ExternalCommandRuntimeAdapter) Run(
	ctx context.Context,
	request RuntimeRequest,
	write RuntimeEventWriter,
) (ama.JSON, error) {
	if request.Runtime != a.Runtime {
		return nil, fmt.Errorf("unsupported external runtime %q", request.Runtime)
	}
	command, args, err := runtimeCommand(request.Runtime, request.RuntimeConfig)
	if err != nil {
		return nil, err
	}
	workspace, err := runtimeWorkspace(request.WorkDir)
	if err != nil {
		return nil, err
	}
	request.WorkDir = workspace
	timeout := a.CommandTimeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	env, err := runtimeCommandEnvironment(request)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(commandCtx, command, args...)
	cmd.Dir = request.WorkDir
	cmd.Env = env
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	cmd.Stdin = strings.NewReader(request.InitialPrompt)
	stdoutReader, stdoutWriter, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer stdoutReader.Close()
	stderrReader, stderrWriter, err := os.Pipe()
	if err != nil {
		stdoutWriter.Close()
		return nil, err
	}
	defer stderrReader.Close()
	cmd.Stdout = stdoutWriter
	cmd.Stderr = stderrWriter

	if err := cmd.Start(); err != nil {
		stdoutWriter.Close()
		stderrWriter.Close()
		return nil, err
	}
	stdoutWriter.Close()
	stderrWriter.Close()
	if err := write(request.Runtime+".lifecycle", ama.JSON{"stage": "runtime_process_started", "status": "running"}); err != nil {
		a.stopProcess(cmd)
		_ = cmd.Wait()
		return nil, err
	}
	var stdoutText bytes.Buffer
	var stderrText bytes.Buffer
	var writeMu sync.Mutex
	writeSerialized := func(eventType string, payload ama.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return write(eventType, payload)
	}
	streamErrors := make(chan error, 2)
	go func() {
		streamErrors <- streamRuntimeOutput(stdoutReader, &stdoutText, request.Runtime, "stdout", writeSerialized)
	}()
	go func() {
		streamErrors <- streamRuntimeOutput(stderrReader, &stderrText, request.Runtime, "stderr", writeSerialized)
	}()

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	var waitErr error
	var streamErr error
	streamsRead := 0
	select {
	case waitErr = <-done:
	case <-commandCtx.Done():
		a.stopProcess(cmd)
		waitErr = <-done
	case streamErr = <-streamErrors:
		streamsRead = 1
		if streamErr != nil {
			a.stopProcess(cmd)
			waitErr = <-done
		} else {
			waitErr = <-done
		}
	}
	for streamsRead < 2 {
		if err := <-streamErrors; err != nil && streamErr == nil {
			streamErr = err
		}
		streamsRead++
	}

	result := ama.JSON{"stdout": stdoutText.String(), "stderr": stderrText.String(), "exitCode": exitCode(waitErr)}
	if streamErr != nil {
		result["error"] = streamErr.Error()
		return result, streamErr
	}
	if commandCtx.Err() != nil {
		result["error"] = commandCtx.Err().Error()
		return result, commandCtx.Err()
	}
	if waitErr != nil {
		result["error"] = waitErr.Error()
		return result, fmt.Errorf("%s command exited with code %d", request.Runtime, exitCode(waitErr))
	}
	if err := write(request.Runtime+".lifecycle", ama.JSON{"stage": "runtime_process_exited", "status": "completed"}); err != nil {
		return result, err
	}
	return result, nil
}

func runtimeCommand(runtimeName string, config map[string]any) (string, []string, error) {
	value, ok := config["command"]
	if !ok {
		return "", nil, fmt.Errorf("%s runtimeConfig.command is required", runtimeName)
	}
	switch command := value.(type) {
	case string:
		fields := strings.Fields(command)
		if len(fields) == 0 {
			return "", nil, fmt.Errorf("%s runtimeConfig.command is required", runtimeName)
		}
		return fields[0], fields[1:], nil
	case []any:
		parts := make([]string, 0, len(command))
		for _, part := range command {
			text, ok := part.(string)
			if !ok || strings.TrimSpace(text) == "" {
				return "", nil, fmt.Errorf("%s runtimeConfig.command entries must be non-empty strings", runtimeName)
			}
			parts = append(parts, text)
		}
		if len(parts) == 0 {
			return "", nil, fmt.Errorf("%s runtimeConfig.command is required", runtimeName)
		}
		return parts[0], parts[1:], nil
	case []string:
		if len(command) == 0 || strings.TrimSpace(command[0]) == "" {
			return "", nil, fmt.Errorf("%s runtimeConfig.command is required", runtimeName)
		}
		return command[0], command[1:], nil
	default:
		return "", nil, fmt.Errorf("%s runtimeConfig.command must be a string or string array", runtimeName)
	}
}

func runtimeCommandEnvironment(request RuntimeRequest) ([]string, error) {
	env, err := processCommandEnvironment(request.WorkDir)
	if err != nil {
		return nil, err
	}
	config, err := json.Marshal(request.RuntimeConfig)
	if err != nil {
		return nil, err
	}
	return append(env,
		"AMA_SESSION_ID="+request.SessionID,
		"AMA_RUNTIME="+request.Runtime,
		"AMA_PROVIDER="+request.Provider,
		"AMA_MODEL="+request.Model,
		"AMA_WORKSPACE="+request.WorkDir,
		"AMA_RUNTIME_CONFIG="+string(config),
	), nil
}

func runtimeWorkspace(workDir string) (string, error) {
	root, err := filepath.Abs(workDir)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(root)
}

func streamRuntimeOutput(
	reader io.Reader,
	output *bytes.Buffer,
	runtimeName string,
	stream string,
	write RuntimeEventWriter,
) error {
	scanner := bufio.NewScanner(reader)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		output.WriteString(line)
		output.WriteByte('\n')
		if stream == "stdout" {
			if eventType, payload, ok := runtimeEventFromLine(line); ok {
				if err := write(eventType, payload); err != nil {
					return err
				}
				continue
			}
		}
		if err := write(runtimeName+".output", ama.JSON{"stream": stream, "content": line}); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func runtimeEventFromLine(line string) (string, ama.JSON, bool) {
	var record map[string]any
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		return "", nil, false
	}
	eventType, ok := record["type"].(string)
	if !ok || strings.TrimSpace(eventType) == "" {
		return "", nil, false
	}
	payload := ama.JSON{}
	if nested, ok := record["payload"].(map[string]any); ok {
		for key, value := range nested {
			payload[key] = value
		}
	} else {
		for key, value := range record {
			if key != "type" {
				payload[key] = value
			}
		}
	}
	return eventType, payload, true
}

func (a ExternalCommandRuntimeAdapter) stopProcess(cmd *exec.Cmd) {
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

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitError *exec.ExitError
	if asExitError(err, &exitError) {
		return exitError.ExitCode()
	}
	return 1
}
