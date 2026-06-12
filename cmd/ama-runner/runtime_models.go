package main

import (
	"context"
	"os"
	"os/exec"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// The claude and copilot SDKs spawn the host CLI to list models, which can
// take several seconds; results are cached per process (see runtimeModelsFor).
const runtimeModelDetectTimeout = 30 * time.Second

// detectRuntimeModels spawns the embedded bridge to enumerate the model ids
// the host CLI account can serve for a runtime. Returns nil when enumeration
// is not possible (no node, no credentials, SDK failure); the caller then
// advertises the pinned fallback model so old single-model behavior degrades
// gracefully.
func detectRuntimeModels(ctx context.Context, runtimeName string) []string {
	bridgePath, err := materializeRuntimeBridge()
	if err != nil {
		return nil
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil
	}
	hostHome, err := os.UserHomeDir()
	if err != nil || hostHome == "" {
		return nil
	}
	commandCtx, cancel := context.WithTimeout(ctx, runtimeModelDetectTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, nodePath, bridgePath)
	cmd.Env = os.Environ()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil
	}
	if err := cmd.Start(); err != nil {
		return nil
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	scanner := bridgeScanner(stdout)
	if err := waitBridgeReady(scanner); err != nil {
		return nil
	}
	requestID := "models_" + runtimeName
	bridgeStdin := &bridgeStdin{writer: stdin}
	if err := bridgeStdin.WriteJSON(ama.JSON{
		"type":      "detectModels",
		"requestId": requestID,
		"runtime":   runtimeName,
		"env":       ama.JSON{"AMA_RUNTIME_BRIDGE_HOST_HOME": hostHome},
	}); err != nil {
		return nil
	}
	var result ama.JSON
	noop := func(string, ama.JSON) error { return nil }
	if err := readBridgeMessages(scanner, requestID, noop, nil, &result); err != nil {
		return nil
	}
	return parseModelIDs(result["models"])
}

func parseModelIDs(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	models := make([]string, 0, len(raw))
	for _, item := range raw {
		if model, ok := item.(string); ok && model != "" {
			models = append(models, model)
		}
	}
	return models
}
