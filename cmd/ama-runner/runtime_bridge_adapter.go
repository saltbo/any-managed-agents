package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type SDKBridgeRuntimeAdapter struct {
	Runtime               string
	CommandTimeout        time.Duration
	ShutdownGraceInterval time.Duration
}

type bridgeEnvelope struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId,omitempty"`
	Event     json.RawMessage `json:"event,omitempty"`
	Result    ama.JSON        `json:"result,omitempty"`
	Error     *bridgeError    `json:"error,omitempty"`
	Level     string          `json:"level,omitempty"`
	Message   string          `json:"message,omitempty"`
}

type bridgeError struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
	Details any    `json:"details,omitempty"`
}

type bridgeEvent struct {
	Type     string   `json:"type"`
	Payload  ama.JSON `json:"payload"`
	Metadata ama.JSON `json:"metadata,omitempty"`
}

func (a SDKBridgeRuntimeAdapter) Run(ctx context.Context, request RuntimeRequest, write RuntimeEventWriter) (ama.JSON, error) {
	if request.Runtime != a.Runtime {
		return nil, fmt.Errorf("unsupported SDK bridge runtime %q", request.Runtime)
	}
	workspace, err := runtimeWorkspace(request.WorkDir, request.SessionID)
	if err != nil {
		return nil, err
	}
	request.WorkDir = workspace
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil, fmt.Errorf("%s runtime requires Node.js to run the embedded SDK bridge", request.Runtime)
	}
	bridgePath, err := materializeRuntimeBridge()
	if err != nil {
		return nil, err
	}
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
	env = appendRuntimeBridgeHostEnv(env)
	cmd := exec.CommandContext(commandCtx, nodePath, bridgePath)
	cmd.Dir = request.WorkDir
	cmd.Env = env
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	stdinWriter, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdoutReader, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderrReader, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	requestID := "run_" + request.SessionID
	var writeMu sync.Mutex
	writeSerialized := func(eventType string, payload ama.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return write(eventType, payload)
	}
	var stderrText bytes.Buffer
	stderrDone := make(chan error, 1)
	go func() {
		stderrDone <- streamBridgeStderr(stderrReader, &stderrText, request.Runtime, writeSerialized)
	}()
	stdoutScanner := bridgeScanner(stdoutReader)
	if err := waitBridgeReady(stdoutScanner); err != nil {
		a.stopProcess(cmd)
		_ = cmd.Wait()
		<-stderrDone
		if stderrText.Len() > 0 {
			return nil, fmt.Errorf("%w: %s", err, stderrText.String())
		}
		return nil, err
	}
	if err := writeSerialized("runtime.metadata", ama.JSON{"data": ama.JSON{"runtime": request.Runtime, "stage": "sdk_bridge_started", "status": "running"}}); err != nil {
		a.stopProcess(cmd)
		_ = cmd.Wait()
		return nil, err
	}

	runRequest := ama.JSON{
		"type":          "run",
		"requestId":     requestID,
		"runtime":       request.Runtime,
		"sessionId":     request.SessionID,
		"cwd":           request.WorkDir,
		"env":           envMap(env),
		"prompt":        request.InitialPrompt,
		"provider":      request.Provider,
		"model":         request.Model,
		"runtimeConfig": request.RuntimeConfig,
		"resume":        request.Resume,
		"resumeToken":   request.ResumeToken,
	}
	if err := writeBridgeInput(stdinWriter, runRequest); err != nil {
		a.stopProcess(cmd)
		_ = cmd.Wait()
		return nil, err
	}

	var result ama.JSON
	readErr := readBridgeMessages(stdoutScanner, requestID, writeSerialized, &result)
	_ = stdinWriter.Close()
	waitErr := cmd.Wait()
	stderrErr := <-stderrDone

	final := ama.JSON{"stderr": stderrText.String(), "exitCode": exitCode(waitErr)}
	for key, value := range result {
		final[key] = value
	}
	if readErr != nil {
		final["error"] = readErr.Error()
		return final, readErr
	}
	if stderrErr != nil && bridgePipeClosedAfterResult(stderrErr, result) {
		stderrErr = nil
	}
	if stderrErr != nil {
		final["error"] = stderrErr.Error()
		return final, stderrErr
	}
	if commandCtx.Err() != nil {
		final["error"] = commandCtx.Err().Error()
		return final, commandCtx.Err()
	}
	if waitErr != nil {
		final["error"] = waitErr.Error()
		return final, fmt.Errorf("%s SDK bridge exited with code %d", request.Runtime, exitCode(waitErr))
	}
	if err := writeSerialized("runtime.metadata", ama.JSON{"data": ama.JSON{"runtime": request.Runtime, "stage": "sdk_bridge_exited", "status": "completed"}}); err != nil {
		final["finalEventError"] = err.Error()
	}
	return final, nil
}

func bridgeScanner(reader io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(reader)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	return scanner
}

func waitBridgeReady(scanner *bufio.Scanner) error {
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return err
		}
		return fmt.Errorf("runtime SDK bridge exited before ready")
	}
	var envelope bridgeEnvelope
	if err := json.Unmarshal([]byte(scanner.Text()), &envelope); err != nil {
		return fmt.Errorf("invalid runtime SDK bridge ready message: %w", err)
	}
	if envelope.Type != "ready" {
		return fmt.Errorf("runtime SDK bridge did not send ready message")
	}
	return nil
}

func readBridgeMessages(scanner *bufio.Scanner, requestID string, write RuntimeEventWriter, result *ama.JSON) error {
	for scanner.Scan() {
		var envelope bridgeEnvelope
		if err := json.Unmarshal([]byte(scanner.Text()), &envelope); err != nil {
			return fmt.Errorf("invalid runtime SDK bridge message: %w", err)
		}
		if envelope.RequestID != "" && envelope.RequestID != requestID {
			continue
		}
		switch envelope.Type {
		case "event":
			var event bridgeEvent
			if err := json.Unmarshal(envelope.Event, &event); err != nil {
				return fmt.Errorf("invalid runtime SDK bridge event: %w", err)
			}
			if event.Type == "" {
				return fmt.Errorf("runtime SDK bridge event missing type")
			}
			if event.Payload == nil {
				event.Payload = ama.JSON{}
			}
			if err := write(event.Type, event.Payload); err != nil {
				return err
			}
		case "result":
			*result = envelope.Result
			return nil
		case "error":
			if envelope.Error == nil {
				return fmt.Errorf("runtime SDK bridge failed")
			}
			return fmt.Errorf("%s", envelope.Error.Message)
		case "log":
			if err := write("runtime.output", ama.JSON{"stream": "bridge", "content": envelope.Message}); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported runtime SDK bridge message type %q", envelope.Type)
		}
	}
	return scanner.Err()
}

func bridgePipeClosedAfterResult(err error, result ama.JSON) bool {
	return err != nil && result != nil && errors.Is(err, os.ErrClosed)
}

func writeBridgeInput(writer io.Writer, value ama.JSON) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := writer.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

func streamBridgeStderr(reader io.Reader, output *bytes.Buffer, runtimeName string, write RuntimeEventWriter) error {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		output.WriteString(line)
		output.WriteByte('\n')
		if err := write("runtime.output", ama.JSON{"stream": "stderr", "content": line, "runtime": runtimeName}); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func materializeRuntimeBridge() (string, error) {
	hash := sha256.Sum256(embeddedRuntimeBridge)
	name := "ama-runtime-bridge-" + hex.EncodeToString(hash[:8]) + ".mjs"
	root, err := os.UserCacheDir()
	if err != nil {
		root = os.TempDir()
	}
	dir := filepath.Join(root, "ama-runner")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, embeddedRuntimeBridge) {
		return path, nil
	}
	if err := os.WriteFile(path, embeddedRuntimeBridge, 0o755); err != nil {
		return "", err
	}
	return path, nil
}

func envMap(env []string) map[string]string {
	result := make(map[string]string, len(env))
	for _, item := range env {
		for index, char := range item {
			if char == '=' {
				result[item[:index]] = item[index+1:]
				break
			}
		}
	}
	return result
}

func appendRuntimeBridgeHostEnv(env []string) []string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		env = append(env, "AMA_RUNTIME_BRIDGE_HOST_HOME="+home)
	}
	for _, key := range []string{"VOLTA_HOME", "NODE_PATH", "PNPM_HOME", "NVM_DIR", "AMA_RUNTIME_BRIDGE_TEST_MODE"} {
		if value, ok := os.LookupEnv(key); ok && value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func (a SDKBridgeRuntimeAdapter) stopProcess(cmd *exec.Cmd) {
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
