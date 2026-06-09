package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// usageRuntimes are the runtimes whose host provider quota the bridge can resolve.
var usageRuntimes = []string{"claude-code", "codex", "copilot"}

// collectRuntimeUsage spawns the embedded bridge once per runtime to resolve the
// host provider account's quota/rate-limit windows. Runtimes without
// credentials (or with no limited quota) are omitted.
func collectRuntimeUsage(ctx context.Context) []ama.RuntimeUsage {
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
	for _, runtime := range usageRuntimes {
		windows := fetchRuntimeUsageWindows(ctx, nodePath, bridgePath, hostHome, runtime)
		if len(windows) == 0 {
			continue
		}
		usage = append(usage, ama.RuntimeUsage{Runtime: runtime, Windows: windows})
	}
	return usage
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
	if err := writeBridgeInput(stdin, ama.JSON{
		"type":      "fetchUsage",
		"requestId": requestID,
		"runtime":   runtime,
		"env":       ama.JSON{"AMA_RUNTIME_BRIDGE_HOST_HOME": hostHome},
	}); err != nil {
		return nil
	}
	var result ama.JSON
	noop := func(string, ama.JSON) error { return nil }
	if err := readBridgeMessages(scanner, requestID, noop, &result); err != nil {
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
