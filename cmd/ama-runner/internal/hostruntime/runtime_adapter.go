package hostruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/layout"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Request struct {
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
	// RegisterControlSender hands the runner a function that forwards standard
	// bridge control frames (send/abort/permissionDecision) into the live runtime.
	RegisterControlSender func(send func(BridgeControlFrame) error)
}

type BridgeControlFrame struct {
	Type         string
	Message      string
	PermissionID string
	Allowed      bool
	Reason       string
}

type EventWriter func(eventType string, payload ama.JSON) error

type Adapter interface {
	Run(ctx context.Context, request Request, write EventWriter) (ama.JSON, error)
}

type Service struct {
	CommandTimeout        time.Duration
	ShutdownGraceInterval time.Duration
}

func (s Service) AdapterFor(runtimeName string) (Adapter, error) {
	switch runtimeName {
	case "codex":
		return SDKBridgeRuntimeAdapter{Runtime: "codex", CommandTimeout: s.CommandTimeout, ShutdownGraceInterval: s.ShutdownGraceInterval}, nil
	case "claude-code":
		return SDKBridgeRuntimeAdapter{Runtime: "claude-code", CommandTimeout: s.CommandTimeout, ShutdownGraceInterval: s.ShutdownGraceInterval}, nil
	case "copilot":
		return SDKBridgeRuntimeAdapter{Runtime: "copilot", CommandTimeout: s.CommandTimeout, ShutdownGraceInterval: s.ShutdownGraceInterval}, nil
	default:
		return nil, fmt.Errorf("unsupported external runtime %q", runtimeName)
	}
}

func CommandEnvironment(request Request) ([]string, error) {
	env, err := sandbox.ProcessCommandEnvironment(request.WorkDir)
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

func Workspace(workDir string, sessionID string) (string, error) {
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
	sessionDir := filepath.Join(resolvedRoot, layout.SessionsDirName, sessionID)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return "", err
	}
	resolvedSessionDir, err := filepath.EvalSymlinks(sessionDir)
	if err != nil {
		return "", err
	}
	if err := sandbox.EnsureUnderWorkspace(resolvedRoot, resolvedSessionDir); err != nil {
		return "", err
	}
	workspaceDir := filepath.Join(resolvedSessionDir, layout.WorkspaceDirName)
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return "", err
	}
	resolvedWorkspaceDir, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		return "", err
	}
	if err := sandbox.EnsureUnderWorkspace(resolvedSessionDir, resolvedWorkspaceDir); err != nil {
		return "", err
	}
	return resolvedWorkspaceDir, nil
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitError *exec.ExitError
	if sandbox.AsExitError(err, &exitError) {
		return exitError.ExitCode()
	}
	return 1
}
