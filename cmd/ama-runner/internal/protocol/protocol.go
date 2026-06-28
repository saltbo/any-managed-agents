package protocol

import (
	"encoding/json"
	"fmt"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"github.com/samber/lo"
)

type Volume struct {
	Type        string           `json:"type"`
	Name        string           `json:"name"`
	Owner       string           `json:"owner"`
	Repo        string           `json:"repo"`
	Ref         string           `json:"ref"`
	StoreID     string           `json:"storeId"`
	Description *string          `json:"description"`
	Access      string           `json:"access"`
	SecretRef   string           `json:"secretRef"`
	Memories    []MemorySnapshot `json:"memories"`
}

type VolumeMount struct {
	Name      string `json:"name"`
	MountPath string `json:"mountPath"`
	ReadOnly  bool   `json:"readOnly"`
}

type MemorySnapshot struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type ResolvedVolumeFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type ResolvedVolumeMount struct {
	Name      string               `json:"name"`
	MountPath string               `json:"mountPath"`
	ReadOnly  bool                 `json:"readOnly"`
	Files     []ResolvedVolumeFile `json:"files"`
}

type RunnerChannelMessage = ama.RunnerChannelMessage
type RunnerSandboxRequest = ama.RunnerSandboxRequest
type RunnerSessionCommand = ama.RunnerSessionCommand
type RunnerRuntimeRequest = ama.RunnerRuntimeRequest
type RunnerRuntimeToolCall = ama.RunnerRuntimeToolCall

type WorkPayload struct {
	Protocol                 string                `json:"protocol"`
	Type                     string                `json:"type"`
	SessionID                string                `json:"sessionId"`
	HostingMode              string                `json:"hostingMode"`
	Runtime                  string                `json:"runtime"`
	RuntimeConfig            map[string]any        `json:"runtimeConfig"`
	Volumes                  []Volume              `json:"volumes"`
	VolumeMounts             []VolumeMount         `json:"volumeMounts"`
	Provider                 string                `json:"provider"`
	Model                    string                `json:"model"`
	AgentSnapshot            map[string]any        `json:"agentSnapshot"`
	RuntimeDriver            string                `json:"runtimeDriver"`
	RequiredRunnerCapability string                `json:"requiredRunnerCapability"`
	RuntimeEnv               map[string]string     `json:"runtimeEnv"`
	ResolvedVolumes          []ResolvedVolumeMount `json:"resolvedVolumes"`
	InitialPrompt            *string               `json:"initialPrompt"`
	Resume                   bool                  `json:"resume"`
	ResumeToken              string                `json:"resumeToken"`
	Approved                 bool                  `json:"approved"`
	ToolCallID               string                `json:"toolCallId"`
	ToolName                 string                `json:"toolName"`
	Input                    map[string]any        `json:"input"`
	ToolCall                 *ToolCall             `json:"toolCall"`
}

type ToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
	Input     map[string]any `json:"input"`
	Approved  bool           `json:"approved"`
}

func ParseWorkPayload(payload any) (WorkPayload, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return WorkPayload{}, err
	}
	var parsed ama.RunnerWorkPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		return WorkPayload{}, err
	}
	normalized := workPayloadFromSDK(parsed)
	if normalized.Protocol != "ama-runner-work" {
		return WorkPayload{}, fmt.Errorf("unsupported work protocol %q", normalized.Protocol)
	}
	if normalized.Type == "session.start" {
		if normalized.SessionID == "" {
			return WorkPayload{}, fmt.Errorf("session.start work item must include sessionId")
		}
		if normalized.HostingMode != "self_hosted" {
			return WorkPayload{}, fmt.Errorf("session.start work item must target self_hosted hostingMode")
		}
		if normalized.Runtime == "" || normalized.Provider == "" || normalized.RuntimeConfig == nil {
			return WorkPayload{}, fmt.Errorf("session.start work item must include runtime, runtimeConfig, and provider")
		}
		if normalized.RequiredRunnerCapability == "" {
			return WorkPayload{}, fmt.Errorf("session.start work item must include requiredRunnerCapability")
		}
		return normalized, nil
	}
	if normalized.ToolCall != nil {
		normalized.ToolCallID = normalized.ToolCall.ID
		normalized.ToolName = normalized.ToolCall.Name
		normalized.Input = normalized.ToolCall.Arguments
		if normalized.Input == nil {
			normalized.Input = normalized.ToolCall.Input
		}
		normalized.Approved = normalized.ToolCall.Approved
	}
	if !normalized.Approved {
		return WorkPayload{}, fmt.Errorf("runner work item is not approved for local execution")
	}
	if normalized.ToolCallID == "" || normalized.ToolName == "" || normalized.Input == nil {
		return WorkPayload{}, fmt.Errorf("runner work item must include toolCallId, toolName, and input")
	}
	if normalized.ToolName != "sandbox.exec" && normalized.ToolName != "sandbox.read" && normalized.ToolName != "sandbox.write" {
		return WorkPayload{}, fmt.Errorf("unsupported sandbox tool: %s", normalized.ToolName)
	}
	return normalized, nil
}

func workPayloadFromSDK(payload ama.RunnerWorkPayload) WorkPayload {
	return WorkPayload{
		Protocol:                 runnerWorkPayloadProtocol(payload.Protocol),
		Type:                     stringValue(payload.Type),
		SessionID:                stringValue(payload.SessionId),
		HostingMode:              stringValue(payload.HostingMode),
		Runtime:                  stringValue(payload.Runtime),
		RuntimeConfig:            jsonMap(payload.RuntimeConfig),
		Volumes:                  volumesFromSDK(payload.Volumes),
		VolumeMounts:             volumeMountsFromSDK(payload.VolumeMounts),
		Provider:                 stringValue(payload.Provider),
		Model:                    stringValue(payload.Model),
		AgentSnapshot:            jsonMap(payload.AgentSnapshot),
		RuntimeDriver:            stringValue(payload.RuntimeDriver),
		RequiredRunnerCapability: stringValue(payload.RequiredRunnerCapability),
		RuntimeEnv:               stringMap(payload.RuntimeEnv),
		ResolvedVolumes:          resolvedVolumesFromSDK(payload.ResolvedVolumes),
		InitialPrompt:            payload.InitialPrompt,
		Resume:                   boolValue(payload.Resume),
		ResumeToken:              stringValue(payload.ResumeToken),
		Approved:                 boolValue(payload.Approved),
		ToolCallID:               stringValue(payload.ToolCallId),
		ToolName:                 stringValue(payload.ToolName),
		Input:                    jsonMap(payload.Input),
		ToolCall:                 toolCallFromSDK(payload.ToolCall),
	}
}

func toolCallFromSDK(toolCall *ama.RunnerToolCall) *ToolCall {
	if toolCall == nil {
		return nil
	}
	return &ToolCall{
		ID:        stringValue(toolCall.Id),
		Name:      stringValue(toolCall.Name),
		Arguments: jsonMap(toolCall.Arguments),
		Input:     jsonMap(toolCall.Input),
		Approved:  boolValue(toolCall.Approved),
	}
}

func resolvedVolumesFromSDK(volumes *[]ama.RunnerResolvedVolumeMount) []ResolvedVolumeMount {
	if volumes == nil {
		return nil
	}
	return lo.Map(*volumes, func(volume ama.RunnerResolvedVolumeMount, _ int) ResolvedVolumeMount {
		return ResolvedVolumeMount{
			Name:      volume.Name,
			MountPath: volume.MountPath,
			ReadOnly:  volume.ReadOnly,
			Files:     resolvedVolumeFilesFromSDK(volume.Files),
		}
	})
}

func resolvedVolumeFilesFromSDK(files []ama.RunnerResolvedVolumeFile) []ResolvedVolumeFile {
	return lo.Map(files, func(file ama.RunnerResolvedVolumeFile, _ int) ResolvedVolumeFile {
		return ResolvedVolumeFile{Path: file.Path, Content: file.Content}
	})
}

func volumesFromSDK(volumes *[]ama.RunnerVolume) []Volume {
	if volumes == nil {
		return nil
	}
	return lo.Map(*volumes, func(volume ama.RunnerVolume, _ int) Volume {
		return volumeFromSDK(volume)
	})
}

func volumeFromSDK(volume ama.RunnerVolume) Volume {
	return Volume{
		Type:        string(volume.Type),
		Name:        volume.Name,
		Owner:       stringValue(volume.Owner),
		Repo:        stringValue(volume.Repo),
		Ref:         stringValue(volume.Ref),
		StoreID:     stringValue(volume.StoreId),
		Description: volume.Description,
		Access:      stringValue(volume.Access),
		SecretRef:   stringValue(volume.SecretRef),
		Memories:    memorySnapshotsFromSDK(volume.Memories),
	}
}

func volumeMountsFromSDK(mounts *[]ama.RunnerVolumeMount) []VolumeMount {
	if mounts == nil {
		return nil
	}
	return lo.Map(*mounts, func(mount ama.RunnerVolumeMount, _ int) VolumeMount {
		return VolumeMount{
			Name:      mount.Name,
			MountPath: mount.MountPath,
			ReadOnly:  boolValue(mount.ReadOnly),
		}
	})
}

func memorySnapshotsFromSDK(memories *[]ama.RunnerMemorySnapshot) []MemorySnapshot {
	if memories == nil {
		return nil
	}
	return lo.Map(*memories, func(memory ama.RunnerMemorySnapshot, _ int) MemorySnapshot {
		return MemorySnapshot{Path: memory.Path, Content: memory.Content}
	})
}

func MessageEventID(message RunnerChannelMessage) string {
	return stringValue(message.EventId)
}

func MessageRequestID(message RunnerChannelMessage) string {
	return stringValue(message.RequestId)
}

func MessageSessionID(message RunnerChannelMessage) string {
	return stringValue(message.SessionId)
}

func MessageCommand(message RunnerChannelMessage) RunnerSessionCommand {
	if message.Command == nil {
		return RunnerSessionCommand{}
	}
	return *message.Command
}

func MessageSandboxRequest(message RunnerChannelMessage) RunnerSandboxRequest {
	if message.Request == nil {
		return RunnerSandboxRequest{}
	}
	return *message.Request
}

func CommandMessage(command RunnerSessionCommand) string {
	return stringValue(command.Message)
}

func CommandReason(command RunnerSessionCommand) string {
	return stringValue(command.Reason)
}

func CommandPermissionID(command RunnerSessionCommand) string {
	return stringValue(command.PermissionId)
}

func CommandAllowed(command RunnerSessionCommand) bool {
	return boolValue(command.Allowed)
}

func SandboxRequestType(request RunnerSandboxRequest) string {
	return request.Type
}

func SandboxRequestToolCallID(request RunnerSandboxRequest) string {
	return stringValue(request.ToolCallId)
}

func SandboxRequestToolName(request RunnerSandboxRequest) string {
	return stringValue(request.ToolName)
}

func SandboxRequestInput(request RunnerSandboxRequest) map[string]any {
	return jsonMap(request.Input)
}

func SandboxRequestVolumes(request RunnerSandboxRequest) []Volume {
	return volumesFromSDK(request.Volumes)
}

func SandboxRequestVolumeMounts(request RunnerSandboxRequest) []VolumeMount {
	return volumeMountsFromSDK(request.VolumeMounts)
}

func runnerWorkPayloadProtocol(protocol *ama.RunnerWorkPayloadProtocol) string {
	if protocol == nil {
		return ""
	}
	return string(*protocol)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func boolValue(value *bool) bool {
	return value != nil && *value
}

func stringMap(value *map[string]string) map[string]string {
	if value == nil {
		return nil
	}
	return lo.Assign(map[string]string{}, *value)
}

func jsonMap(value *map[string]*interface{}) map[string]any {
	if value == nil {
		return nil
	}
	return lo.MapEntries(*value, func(key string, item *interface{}) (string, any) {
		if item == nil {
			return key, nil
		}
		return key, *item
	})
}
