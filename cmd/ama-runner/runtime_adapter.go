package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type RuntimeRequest struct {
	SessionID     string
	Runtime       string
	RuntimeConfig map[string]any
	RuntimeEnv    map[string]string
	Provider      string
	Model         string
	InitialPrompt string
	WorkDir       string
}

type RuntimeEventWriter func(eventType string, payload ama.JSON) error

type RuntimeAdapter interface {
	Run(ctx context.Context, request RuntimeRequest, write RuntimeEventWriter) (ama.JSON, error)
}

func runtimeAdapterFor(runtimeName string, commandTimeout time.Duration, shutdownGraceInterval time.Duration) (RuntimeAdapter, error) {
	switch runtimeName {
	case "codex":
		return SDKBridgeRuntimeAdapter{Runtime: "codex", CommandTimeout: commandTimeout, ShutdownGraceInterval: shutdownGraceInterval}, nil
	case "claude-code":
		return SDKBridgeRuntimeAdapter{Runtime: "claude-code", CommandTimeout: commandTimeout, ShutdownGraceInterval: shutdownGraceInterval}, nil
	case "copilot":
		return SDKBridgeRuntimeAdapter{Runtime: "copilot", CommandTimeout: commandTimeout, ShutdownGraceInterval: shutdownGraceInterval}, nil
	default:
		return nil, fmt.Errorf("unsupported external runtime %q", runtimeName)
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
	env = append(env,
		"AMA_SESSION_ID="+request.SessionID,
		"AMA_RUNTIME="+request.Runtime,
		"AMA_PROVIDER="+request.Provider,
		"AMA_MODEL="+request.Model,
		"AMA_WORKSPACE="+request.WorkDir,
		"AMA_RUNTIME_CONFIG="+string(config),
	)
	for key, value := range request.RuntimeEnv {
		env = append(env, key+"="+value)
	}
	return env, nil
}

func runtimeWorkspace(workDir string, sessionID string) (string, error) {
	if sessionID == "" || filepath.Base(sessionID) != sessionID || sessionID == "." || sessionID == ".." {
		return "", fmt.Errorf("session id must be a single path segment")
	}
	root, err := filepath.Abs(workDir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
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
