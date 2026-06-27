package hostruntime

import (
	"strings"
	"testing"
	"time"
)

func TestRuntimeAdapterForUsesSDKBridgeForOfficialRuntimes(t *testing.T) {
	service := Service{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	for _, runtimeName := range []string{"codex", "claude-code", "copilot"} {
		adapter, err := service.AdapterFor(runtimeName)
		if err != nil {
			t.Fatalf("expected %s adapter, got %v", runtimeName, err)
		}
		bridge, ok := adapter.(SDKBridgeRuntimeAdapter)
		if !ok {
			t.Fatalf("expected %s to use SDK bridge adapter, got %T", runtimeName, adapter)
		}
		if bridge.Runtime != runtimeName {
			t.Fatalf("expected bridge runtime %q, got %#v", runtimeName, bridge)
		}
	}
	if _, err := service.AdapterFor("unknown"); err == nil || !strings.Contains(err.Error(), "unsupported external runtime") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentSanitizesRunnerSecrets(t *testing.T) {
	t.Setenv("AMA_TOKEN", "operator-token")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "operator-secret")
	workDir := t.TempDir()
	env, err := CommandEnvironment(Request{
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
	if _, err := CommandEnvironment(Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"bad": make(chan int)},
		WorkDir:       t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected runtime config marshal error, got %v", err)
	}
}
