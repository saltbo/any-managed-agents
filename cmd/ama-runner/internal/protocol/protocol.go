package protocol

import (
	"encoding/json"
	"fmt"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type ResourceRef struct {
	Type        string           `json:"type"`
	Owner       string           `json:"owner"`
	Repo        string           `json:"repo"`
	Ref         string           `json:"ref"`
	MountPath   string           `json:"mountPath"`
	StoreID     string           `json:"storeId"`
	Name        string           `json:"name"`
	Description *string          `json:"description"`
	Access      string           `json:"access"`
	Memories    []MemorySnapshot `json:"memories"`
}

type MemorySnapshot struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type WorkPayload struct {
	Protocol                 string            `json:"protocol"`
	Type                     string            `json:"type"`
	SessionID                string            `json:"sessionId"`
	HostingMode              string            `json:"hostingMode"`
	Runtime                  string            `json:"runtime"`
	RuntimeConfig            map[string]any    `json:"runtimeConfig"`
	ResourceRefs             []ResourceRef     `json:"resourceRefs"`
	Provider                 string            `json:"provider"`
	Model                    string            `json:"model"`
	AgentSnapshot            map[string]any    `json:"agentSnapshot"`
	RuntimeDriver            string            `json:"runtimeDriver"`
	RequiredRunnerCapability string            `json:"requiredRunnerCapability"`
	RuntimeEnv               map[string]string `json:"runtimeEnv"`
	InitialPrompt            *string           `json:"initialPrompt"`
	Resume                   bool              `json:"resume"`
	ResumeToken              string            `json:"resumeToken"`
	Approved                 bool              `json:"approved"`
	ToolCallID               string            `json:"toolCallId"`
	ToolName                 string            `json:"toolName"`
	Input                    map[string]any    `json:"input"`
	ToolCall                 *ToolCall         `json:"toolCall"`
}

type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
	Input     map[string]any `json:"input"`
	Approved  bool           `json:"approved"`
}

type RunnerChannelMessage struct {
	Type       string               `json:"type"`
	EventID    string               `json:"eventId"`
	RequestID  string               `json:"requestId"`
	Message    string               `json:"message"`
	SessionID  string               `json:"sessionId"`
	RunnerID   string               `json:"runnerId"`
	LeaseID    string               `json:"leaseId"`
	WorkItemID string               `json:"workItemId"`
	Command    RunnerSessionCommand `json:"command"`
	Request    RunnerSandboxRequest `json:"request"`
}

type RunnerSandboxRequest struct {
	Type         string         `json:"type"`
	ToolCallID   string         `json:"toolCallId"`
	ToolName     string         `json:"toolName"`
	Input        map[string]any `json:"input"`
	ResourceRefs []ResourceRef  `json:"resourceRefs"`
}

type RunnerSessionCommand struct {
	ID           string               `json:"id"`
	Type         string               `json:"type"`
	Path         string               `json:"path"`
	Message      string               `json:"message"`
	Reason       string               `json:"reason"`
	PermissionID string               `json:"permissionId"`
	Allowed      bool                 `json:"allowed"`
	Body         RunnerRuntimeRequest `json:"body"`
}

type RunnerRuntimeRequest struct {
	ToolCalls []RunnerRuntimeToolCall `json:"toolCalls"`
}

type RunnerRuntimeToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Input     map[string]any `json:"input"`
	Arguments map[string]any `json:"arguments"`
}

func ParseWorkPayload(payload ama.JSON) (WorkPayload, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return WorkPayload{}, err
	}
	var parsed WorkPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		return WorkPayload{}, err
	}
	if parsed.Protocol != "ama-runner-work" {
		return WorkPayload{}, fmt.Errorf("unsupported work protocol %q", parsed.Protocol)
	}
	if parsed.Type == "session.start" {
		if parsed.SessionID == "" {
			return WorkPayload{}, fmt.Errorf("session.start work item must include sessionId")
		}
		if parsed.HostingMode != "self_hosted" {
			return WorkPayload{}, fmt.Errorf("session.start work item must target self_hosted hostingMode")
		}
		if parsed.Runtime == "" || parsed.Provider == "" || parsed.RuntimeConfig == nil {
			return WorkPayload{}, fmt.Errorf("session.start work item must include runtime, runtimeConfig, and provider")
		}
		if parsed.RequiredRunnerCapability == "" {
			return WorkPayload{}, fmt.Errorf("session.start work item must include requiredRunnerCapability")
		}
		return parsed, nil
	}
	if parsed.ToolCall != nil {
		parsed.ToolCallID = parsed.ToolCall.ID
		parsed.ToolName = parsed.ToolCall.Name
		parsed.Input = parsed.ToolCall.Arguments
		if parsed.Input == nil {
			parsed.Input = parsed.ToolCall.Input
		}
		parsed.Approved = parsed.ToolCall.Approved
	}
	if !parsed.Approved {
		return WorkPayload{}, fmt.Errorf("runner work item is not approved for local execution")
	}
	if parsed.ToolCallID == "" || parsed.ToolName == "" || parsed.Input == nil {
		return WorkPayload{}, fmt.Errorf("runner work item must include toolCallId, toolName, and input")
	}
	if parsed.ToolName != "sandbox.exec" && parsed.ToolName != "sandbox.read" && parsed.ToolName != "sandbox.write" {
		return WorkPayload{}, fmt.Errorf("unsupported sandbox tool: %s", parsed.ToolName)
	}
	return parsed, nil
}
