package runtime

import (
	"context"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/runtimebridge"
)

type JSON = runtimebridge.JSON

type Request struct {
	SessionID     string
	Runtime       string
	RuntimeConfig map[string]any
	Env           map[string]string
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

type BridgeControlFrame = runtimebridge.BridgeControl
type BridgeControlType = runtimebridge.BridgeControlType

type EventWriter func(eventType string, payload JSON) error

type Adapter interface {
	Run(ctx context.Context, request Request, write EventWriter) (JSON, error)
}

type Result struct {
	Output   JSON
	Err      error
	TimedOut bool
}

type InventorySnapshot struct {
	Runtimes []InventoryRuntime
}

type InventoryRuntime struct {
	Runtime        string
	Binary         string
	Installed      bool
	FallbackModels []string
	Models         []string
	Status         string
	Version        string
	Detail         string
	UsageWindows   []UsageWindow
	LimitedDetail  string
}

type UsageSnapshot struct {
	Usage   []RuntimeUsage
	Limited map[string]string
}

type RuntimeInventoryEntry struct {
	Runtime string
	Version string
	State   string
	Detail  string
}

const (
	RuntimeInventoryStateReady           = "ready"
	RuntimeInventoryStateLimited         = "limited"
	RuntimeInventoryStateMissing         = "missing"
	RuntimeInventoryStateUnhealthy       = "unhealthy"
	RuntimeInventoryStateUnauthenticated = "unauthenticated"
	RuntimeInventoryStateUnauthorized    = "unauthorized"
)

type RuntimeUsage struct {
	Runtime string
	Windows []UsageWindow
}

type UsageWindow = runtimebridge.BridgeUsageWindow
