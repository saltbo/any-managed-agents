package main

import (
	"context"
	"os"
	"os/exec"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// The claude and copilot SDKs spawn the host CLI to list models, which can
// take several seconds; results are cached per process (see runtimeProbesFor).
const runtimeModelDetectTimeout = 30 * time.Second

// runtimeProbe is the per-runtime result of probing the host CLI through the
// embedded bridge: the enumerated model ids plus a safe availability report
// (status, version, diagnostic detail) for the runner heartbeat inventory.
type runtimeProbe struct {
	Models  []string
	Status  string
	Version string
	Detail  string
}

func unavailableRuntimeProbe(detail string) runtimeProbe {
	return runtimeProbe{Status: "unhealthy", Detail: detail}
}

// detectRuntimeProbe spawns the embedded bridge to enumerate the model ids the
// host CLI account can serve for a runtime and to classify the runtime's
// availability. A probe with no models leaves the runtime on its pinned
// fallback model so old single-model behavior degrades gracefully.
func detectRuntimeProbe(ctx context.Context, runtimeName string) runtimeProbe {
	bridgePath, err := materializeRuntimeBridge()
	if err != nil {
		return unavailableRuntimeProbe("runtime bridge is unavailable on this host")
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return unavailableRuntimeProbe("node is required to probe host runtimes")
	}
	hostHome, err := os.UserHomeDir()
	if err != nil || hostHome == "" {
		return unavailableRuntimeProbe("host home directory is unavailable")
	}
	commandCtx, cancel := context.WithTimeout(ctx, runtimeModelDetectTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, nodePath, bridgePath)
	cmd.Env = os.Environ()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return unavailableRuntimeProbe("runtime bridge could not start")
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return unavailableRuntimeProbe("runtime bridge could not start")
	}
	if err := cmd.Start(); err != nil {
		return unavailableRuntimeProbe("runtime bridge could not start")
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	scanner := bridgeScanner(stdout)
	if err := waitBridgeReady(scanner); err != nil {
		return unavailableRuntimeProbe("runtime bridge did not become ready")
	}
	requestID := "models_" + runtimeName
	bridgeStdin := &bridgeStdin{writer: stdin}
	if err := bridgeStdin.WriteJSON(ama.JSON{
		"type":      "detectModels",
		"requestId": requestID,
		"runtime":   runtimeName,
		"env":       ama.JSON{"AMA_RUNTIME_BRIDGE_HOST_HOME": hostHome},
	}); err != nil {
		return unavailableRuntimeProbe("runtime bridge probe request failed")
	}
	var result ama.JSON
	noop := func(string, ama.JSON) error { return nil }
	if err := readBridgeMessages(scanner, requestID, noop, nil, &result); err != nil {
		return unavailableRuntimeProbe("runtime bridge probe failed")
	}
	return runtimeProbe{
		Models:  parseModelIDs(result["models"]),
		Status:  stringValue(result["status"]),
		Version: stringValue(result["version"]),
		Detail:  stringValue(result["detail"]),
	}
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
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
