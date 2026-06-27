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
	AgentSnapshot map[string]any
	InitialPrompt string
	Resume        bool
	ResumeToken   string
	WorkDir       string
	// OnResumeToken is invoked as soon as the runtime learns (or rotates) its
	// resume token, so the runner can persist it before the run completes.
	OnResumeToken func(resumeToken string)
	// RegisterPromptSender hands the runner a function that injects a prompt
	// into the live runtime. Adapters that support mid-run input call it once
	// the runtime is ready to receive prompts.
	RegisterPromptSender func(send func(message string) error)
	// RegisterStopSender hands the runner a function that aborts the live
	// runtime handle when AMA sends a stop command over the session channel.
	RegisterStopSender func(send func(reason string) error)
	// RegisterPermissionSender hands the runner a function that forwards an
	// AMA permission decision to the live runtime handle.
	RegisterPermissionSender func(send func(permissionId string, allowed bool, reason string) error)
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
		"AMA_WORKSPACE="+request.WorkDir,
		"AMA_RUNTIME_CONFIG="+string(config),
	)
	if request.AgentSnapshot != nil {
		snapshot, err := json.Marshal(request.AgentSnapshot)
		if err != nil {
			return nil, err
		}
		env = append(env, "AMA_AGENT_SNAPSHOT="+string(snapshot))
	}
	if request.Model != "" {
		env = append(env, "AMA_MODEL="+request.Model)
	}
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
	sessionDir := filepath.Join(resolvedRoot, runtimeSessionsDirName, sessionID)
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
	workspaceDir := filepath.Join(resolvedSessionDir, runtimeWorkspaceDirName)
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return "", err
	}
	resolvedWorkspaceDir, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		return "", err
	}
	if err := ensureUnderWorkspace(resolvedSessionDir, resolvedWorkspaceDir); err != nil {
		return "", err
	}
	return resolvedWorkspaceDir, nil
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
