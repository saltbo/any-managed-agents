package hostruntime

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// CLI maps each external session runtime to the CLI binary the runtime bridge
// providers resolve on the host. A runtime is advertised only when its binary is
// on PATH.
type CLI struct {
	Runtime string
	Binary  string
}

func CLIs() []CLI {
	return []CLI{
		{Runtime: "claude-code", Binary: "claude"},
		{Runtime: "codex", Binary: "codex"},
		{Runtime: "copilot", Binary: "copilot"},
	}
}

func (s Service) DetectAvailable(lookPath func(string) (string, error)) []string {
	available := []string{}
	for _, cli := range CLIs() {
		if _, err := lookPath(cli.Binary); err == nil {
			available = append(available, cli.Runtime)
		}
	}
	return available
}

// The claude and copilot SDKs spawn the host CLI to list models, which can
// take several seconds; results are cached per process (see runtimeProbesFor).
const runtimeModelDetectTimeout = 30 * time.Second

// runtimeProbe is the per-runtime result of probing the host CLI through the
// embedded bridge: the enumerated model ids plus a safe availability report
// (status, version, diagnostic detail) for the runner heartbeat inventory.
type Probe struct {
	Models  []string
	Status  string
	Version string
	Detail  string
}

func UnavailableProbe(detail string) Probe {
	return Probe{Status: "unhealthy", Detail: detail}
}

// detectRuntimeProbe spawns the embedded bridge to enumerate the model ids the
// host CLI account can serve for a runtime and to classify the runtime's
// availability. A probe with no models leaves the runtime on its pinned
// fallback model so old single-model behavior degrades gracefully.
func (s Service) DetectProbe(ctx context.Context, runtimeName string) Probe {
	bridgePath, err := materializeRuntimeBridge()
	if err != nil {
		return UnavailableProbe("runtime bridge is unavailable on this host")
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return UnavailableProbe("node is required to probe host runtimes")
	}
	hostHome, err := os.UserHomeDir()
	if err != nil || hostHome == "" {
		return UnavailableProbe("host home directory is unavailable")
	}
	commandCtx, cancel := context.WithTimeout(ctx, runtimeModelDetectTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, nodePath, bridgePath)
	cmd.Env = os.Environ()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return UnavailableProbe("runtime bridge could not start")
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return UnavailableProbe("runtime bridge could not start")
	}
	if err := cmd.Start(); err != nil {
		return UnavailableProbe("runtime bridge could not start")
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	scanner := bridgeScanner(stdout)
	if err := waitBridgeReady(scanner); err != nil {
		return UnavailableProbe("runtime bridge did not become ready")
	}
	requestID := "models_" + runtimeName
	bridgeStdin := &bridgeStdin{writer: stdin}
	if err := bridgeStdin.WriteJSON(ama.JSON{
		"type":      "detectModels",
		"requestId": requestID,
		"runtime":   runtimeName,
		"env":       ama.JSON{"AMA_RUNTIME_BRIDGE_HOST_HOME": hostHome},
	}); err != nil {
		return UnavailableProbe("runtime bridge probe request failed")
	}
	var result ama.JSON
	noop := func(string, ama.JSON) error { return nil }
	if err := readBridgeMessages(scanner, requestID, noop, nil, &result); err != nil {
		return UnavailableProbe("runtime bridge probe failed")
	}
	return Probe{
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

// usageRuntimes are the runtimes whose host provider quota the bridge can resolve.
var usageRuntimes = []string{"claude-code", "codex", "copilot"}

const ClaudeCodeUsageUnavailableDetail = "Claude Code quota usage unavailable; scheduling paused until the usage probe succeeds"

type UsageSnapshot struct {
	Usage   []ama.RuntimeUsage
	Limited map[string]string
}

// CollectUsage spawns the embedded bridge once per runtime to resolve the host
// provider account's quota/rate-limit windows. Runtimes without limited quota
// are omitted. Claude Code is quota-governed for scheduling, so an unavailable
// usage probe is reported as a temporary runtime limit.
func (s Service) CollectUsage(ctx context.Context) *UsageSnapshot {
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
	var usage []ama.RuntimeUsage
	limited := map[string]string{}
	for _, runtime := range usageRuntimes {
		windows := fetchRuntimeUsageWindows(ctx, nodePath, bridgePath, hostHome, runtime)
		if len(windows) == 0 {
			if runtime == "claude-code" {
				limited[runtime] = ClaudeCodeUsageUnavailableDetail
			}
			continue
		}
		usage = append(usage, ama.RuntimeUsage{Runtime: runtime, Windows: windows})
	}
	return &UsageSnapshot{Usage: usage, Limited: limited}
}

func fetchRuntimeUsageWindows(ctx context.Context, nodePath, bridgePath, hostHome, runtime string) []ama.RuntimeUsageWindow {
	commandCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
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
	requestID := "usage_" + runtime
	bridgeStdin := &bridgeStdin{writer: stdin}
	if err := bridgeStdin.WriteJSON(ama.JSON{
		"type":      "fetchUsage",
		"requestId": requestID,
		"runtime":   runtime,
		"env":       ama.JSON{"AMA_RUNTIME_BRIDGE_HOST_HOME": hostHome},
	}); err != nil {
		return nil
	}
	var result ama.JSON
	noop := func(string, ama.JSON) error { return nil }
	if err := readBridgeMessages(scanner, requestID, noop, nil, &result); err != nil {
		return nil
	}
	return parseUsageWindows(result["windows"])
}

func parseUsageWindows(value any) []ama.RuntimeUsageWindow {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var windows []ama.RuntimeUsageWindow
	if err := json.Unmarshal(data, &windows); err != nil {
		return nil
	}
	return windows
}
