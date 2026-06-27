package hostruntime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

func TestSDKBridgeRuntimeContextDoesNotApplyCommandTimeout(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	commandCtx, cancelCommand := SDKBridgeRuntimeAdapter{
		CommandTimeout: time.Nanosecond,
	}.commandContext(parent)
	defer cancelCommand()

	select {
	case <-commandCtx.Done():
		t.Fatal("expected SDK bridge context to ignore per-command timeout")
	case <-time.After(5 * time.Millisecond):
	}

	cancelParent()
	select {
	case <-commandCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("expected SDK bridge context to follow parent cancellation")
	}
}

func TestSDKBridgeStopProcessKillsProcessGroup(t *testing.T) {
	if runtime.GOOS == "windows" {
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
	SDKBridgeRuntimeAdapter{ShutdownGraceInterval: 10 * time.Millisecond}.stopProcess(cmd)
	_ = cmd.Wait()
	if err := exec.Command("kill", "-0", childPID).Run(); err == nil {
		t.Fatalf("expected child process %s to be killed with process group", childPID)
	}
}

func TestMaterializeRuntimeBridgeWritesEmbeddedBundle(t *testing.T) {
	path, err := materializeRuntimeBridge()
	if err != nil {
		t.Fatalf("expected embedded bridge to materialize, got %v", err)
	}
	if !strings.HasSuffix(path, ".mjs") {
		t.Fatalf("expected bridge bundle path, got %q", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(embeddedRuntimeBridge) {
		t.Fatal("expected materialized bridge to match embedded bundle")
	}
}

func TestBridgeProtocolReadsReadyEventsResultsErrorsAndLogs(t *testing.T) {
	output := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"resumeToken","requestId":"run_session_1","resumeToken":"thread_1"}`,
		`{"type":"sessionEvent","requestId":"run_session_1","eventType":"message_end","payload":{"message":{"role":"assistant","content":"ok"}}}`,
		`{"type":"resumeToken","requestId":"other","resumeToken":"ignored"}`,
		`{"type":"sessionEvent","requestId":"run_session_1","eventType":"runtime.output","payload":{"stream":"bridge","content":"bridge diagnostic"}}`,
		`{"type":"sessionEvent","requestId":"other","eventType":"message_end","payload":{"message":{"role":"assistant","content":"ignored"}}}`,
		`{"type":"result","requestId":"run_session_1","result":{"exitCode":0,"providerThreadId":"thread_1"}}`,
	}, "\n")
	scanner := bridgeScanner(strings.NewReader(output))
	if err := waitBridgeReady(scanner); err != nil {
		t.Fatalf("expected bridge ready, got %v", err)
	}
	var events []string
	var resumeTokens []string
	var result ama.JSON
	err := readBridgeMessages(scanner, "run_session_1", func(eventType string, payload ama.JSON) error {
		events = append(events, eventType+":"+mustJSON(t, payload))
		return nil
	}, func(resumeToken string) {
		resumeTokens = append(resumeTokens, resumeToken)
	}, &result)
	if err != nil {
		t.Fatalf("expected bridge messages, got %v", err)
	}
	if len(events) != 2 || !strings.Contains(events[0], "message_end") || !strings.Contains(events[1], "bridge diagnostic") {
		t.Fatalf("expected forwarded event and log, got %v", events)
	}
	if len(resumeTokens) != 1 || resumeTokens[0] != "thread_1" {
		t.Fatalf("expected scoped resume token callback, got %v", resumeTokens)
	}
	if result["providerThreadId"] != "thread_1" {
		t.Fatalf("expected bridge result, got %#v", result)
	}
}

func TestBridgeProtocolErrorBranches(t *testing.T) {
	if err := waitBridgeReady(bufio.NewScanner(strings.NewReader(`{"type":"log"}` + "\n"))); err == nil || !strings.Contains(err.Error(), "did not send ready") {
		t.Fatalf("expected ready error, got %v", err)
	}
	scanner := bridgeScanner(strings.NewReader(strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"sessionEvent","requestId":"run_session_1","payload":{}}`,
	}, "\n")))
	if err := waitBridgeReady(scanner); err != nil {
		t.Fatal(err)
	}
	var result ama.JSON
	if err := readBridgeMessages(scanner, "run_session_1", func(string, ama.JSON) error { return nil }, nil, &result); err == nil || !strings.Contains(err.Error(), "missing type") {
		t.Fatalf("expected missing event type error, got %v", err)
	}
	scanner = bridgeScanner(strings.NewReader(`{"type":"error","requestId":"run_session_1","error":{"message":"sdk failed"}}` + "\n"))
	if err := readBridgeMessages(scanner, "run_session_1", func(string, ama.JSON) error { return nil }, nil, &result); err == nil || !strings.Contains(err.Error(), "sdk failed") {
		t.Fatalf("expected bridge error, got %v", err)
	}
	writeErr := errors.New("write failed")
	scanner = bridgeScanner(strings.NewReader(`{"type":"sessionEvent","requestId":"run_session_1","eventType":"runtime.output","payload":{"content":"diag"}}` + "\n"))
	if err := readBridgeMessages(scanner, "run_session_1", func(string, ama.JSON) error { return writeErr }, nil, &result); !errors.Is(err, writeErr) {
		t.Fatalf("expected writer error, got %v", err)
	}
}

func TestBridgePipeClosedAfterResultOnlyIgnoresCompletedBridgeClose(t *testing.T) {
	if !bridgePipeClosedAfterResult(os.ErrClosed, ama.JSON{"exitCode": 0}) {
		t.Fatal("expected closed bridge pipe after result to be ignored")
	}
	if bridgePipeClosedAfterResult(os.ErrClosed, nil) {
		t.Fatal("expected closed bridge pipe before result to remain fatal")
	}
	if bridgePipeClosedAfterResult(errors.New("bridge failed"), ama.JSON{"exitCode": 0}) {
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
