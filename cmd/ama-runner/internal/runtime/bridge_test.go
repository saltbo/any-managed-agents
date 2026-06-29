package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRuntimeBridgeHostEnvIncludesNodeToolchainAndTestModeOnly(t *testing.T) {
	t.Setenv("VOLTA_HOME", "/volta")
	t.Setenv("NODE_PATH", "/node-path")
	t.Setenv("PNPM_HOME", "/pnpm")
	t.Setenv("NVM_DIR", "/nvm")
	t.Setenv("AMA_RUNTIME_BRIDGE_TEST_MODE", "1")
	t.Setenv("AMA_TOKEN", "raw-secret-value")
	env := appendRuntimeBridgeHostEnv([]string{"PATH=/bin"})
	envText := strings.Join(env, "\n")
	for _, expected := range []string{
		"AMA_RUNTIME_BRIDGE_HOST_HOME=",
		"VOLTA_HOME=/volta",
		"NODE_PATH=/node-path",
		"PNPM_HOME=/pnpm",
		"NVM_DIR=/nvm",
		"AMA_RUNTIME_BRIDGE_TEST_MODE=1",
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected bridge host env %q in %q", expected, envText)
		}
	}
	if strings.Contains(envText, "raw-secret-value") {
		t.Fatalf("expected runner secrets to remain filtered, got %q", envText)
	}
}

func TestRuntimeBridgeReturnsProviderRegistryErrorForUnsupportedRuntime(t *testing.T) {
	_, err := (Bridge{}).Run(context.Background(), Request{Runtime: "unknown"}, func(string, JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "Unsupported runtime provider") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentSanitizesRunnerSecrets(t *testing.T) {
	t.Setenv("AMA_TOKEN", "operator-token")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "operator-secret")
	workDir := t.TempDir()
	env, err := commandEnvironment(Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"mode": "test"},
		Provider:      "provider_codex",
		Model:         "gpt-5.3-codex",
		WorkDir:       workDir,
	})
	if err != nil {
		t.Fatalf("expected runtime env, got %v", err)
	}
	envText := strings.Join(env, "\n")
	for _, expected := range []string{
		"AMA_SESSION_ID=session_1",
		"AMA_RUNTIME=codex",
		"AMA_PROVIDER=provider_codex",
		"AMA_MODEL=gpt-5.3-codex",
		"AMA_WORKSPACE=" + workDir,
		`AMA_RUNTIME_CONFIG={"mode":"test"}`,
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected env %q in %q", expected, envText)
		}
	}
	for _, leaked := range []string{"operator-token", "operator-secret", "AMA_INITIAL_PROMPT="} {
		if strings.Contains(envText, leaked) {
			t.Fatalf("expected sanitized runtime env, found %q in %q", leaked, envText)
		}
	}
}

func TestRuntimeCommandEnvironmentRejectsUnserializableConfig(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"bad": make(chan int)},
		WorkDir:       t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected runtime config marshal error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentRejectsReservedEnv(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID: "session_1",
		Runtime:   "codex",
		Env:       map[string]string{"AMA_SESSION_ID": "override"},
		WorkDir:   t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("expected reserved env error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentRejectsInvalidEnvKey(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID: "session_1",
		Runtime:   "codex",
		Env:       map[string]string{"BAD=KEY": "value"},
		WorkDir:   t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected invalid env key error, got %v", err)
	}
}

func TestRuntimeBridgeRuntimeContextFollowsParentCancellation(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	commandCtx, cancelCommand := Bridge{}.commandContext(parent)
	defer cancelCommand()

	select {
	case <-commandCtx.Done():
		t.Fatal("expected runtime bridge context to ignore per-command timeout")
	case <-time.After(5 * time.Millisecond):
	}

	cancelParent()
	select {
	case <-commandCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("expected runtime bridge context to follow parent cancellation")
	}
}

func TestRuntimeBridgeStopProcessKillsProcessGroup(t *testing.T) {
	if goruntime.GOOS == "windows" {
		t.Skip("process group signalling is Unix-specific")
	}
	marker := filepath.Join(t.TempDir(), "child.pid")
	cmd := exec.Command("sh", "-lc", "sleep 300 & echo $! > \"$1\"; wait", "sh", marker)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	var childPID string
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(marker)
		if err == nil && strings.TrimSpace(string(data)) != "" {
			childPID = strings.TrimSpace(string(data))
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if childPID == "" {
		t.Fatal("timed out waiting for child pid")
	}
	Bridge{ShutdownGraceInterval: 10 * time.Millisecond}.stopProcess(cmd)
	_ = cmd.Wait()
	if err := exec.Command("kill", "-0", childPID).Run(); err == nil {
		t.Fatalf("expected child process %s to be killed with process group", childPID)
	}
}

func TestBridgePipeClosedAfterResultOnlyIgnoresCompletedBridgeClose(t *testing.T) {
	if !bridgePipeClosedAfterResult(os.ErrClosed, JSON{"exitCode": 0}) {
		t.Fatal("expected closed bridge pipe after result to be ignored")
	}
	if bridgePipeClosedAfterResult(os.ErrClosed, nil) {
		t.Fatal("expected closed bridge pipe before result to remain fatal")
	}
	if bridgePipeClosedAfterResult(errors.New("bridge failed"), JSON{"exitCode": 0}) {
		t.Fatal("expected non-close bridge errors to remain fatal")
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
