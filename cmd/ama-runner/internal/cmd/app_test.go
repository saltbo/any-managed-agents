package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunFailsOnInvalidConfig(t *testing.T) {
	err := Application{Args: []string{"--api-server", "://bad"}}.Run(context.Background())
	if err == nil {
		t.Fatal("expected invalid config error")
	}
	if !strings.Contains(err.Error(), "absolute URL") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestRunVersionPrintsBuildMetadata(t *testing.T) {
	var output bytes.Buffer
	err := Application{Stdout: &output}.runVersion([]string{"--json"})
	if err != nil {
		t.Fatalf("expected version output, got %v", err)
	}
	if !strings.Contains(output.String(), `"name":"ama-runner"`) || !strings.Contains(output.String(), `"version":"`) {
		t.Fatalf("unexpected version output: %s", output.String())
	}
}

func TestRunLoginDiscoversDeviceFlowAndStoresToken(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	var output bytes.Buffer
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":         "ok",
				"name":           "Any Managed Agents",
				"runtime":        "cloudflare-workers",
				"oidcIssuer":     "http://" + r.Host + "/issuer",
				"runnerClientId": "runner-client",
				"runnerScopes":   "openid profile email offline_access",
			})
		case "/issuer/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        "http://" + r.Host + "/issuer",
				"device_authorization_endpoint": "http://" + r.Host + "/device",
				"token_endpoint":                "http://" + r.Host + "/token",
			})
		case "/device":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":      "device-code",
				"user_code":        "LOGIN-CODE",
				"verification_uri": "https://issuer.example.test/device",
				"expires_in":       60,
			})
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "login-access-token",
				"refresh_token": "login-refresh-token",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	err := Application{
		Getenv: func(string) string { return "" },
		Stdout: &output,
	}.runLogin(context.Background(), []string{"--api-server", server.URL, "--config", configPath})
	if err != nil {
		t.Fatalf("expected login to succeed, got %v", err)
	}
	if !strings.Contains(output.String(), "LOGIN-CODE") || strings.Contains(output.String(), "login-access-token") {
		t.Fatalf("unexpected login output: %s", output.String())
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "login-access-token") || !strings.Contains(string(data), server.URL) {
		t.Fatalf("expected saved token config, got %s", string(data))
	}
}

func TestRunWithContextWiresSDKDaemonAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	heartbeatCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok","name":"Any Managed Agents","runtime":"cloudflare-workers","oidcIssuer":"https://issuer.example.test","runnerClientId":"runner-client","runnerScopes":"openid profile email offline_access"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/runners":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"runner_1","name":"runner","capabilities":["sandbox.exec"],"state":"offline","currentLoad":0,"maxConcurrent":1}`))
		case r.Method == http.MethodPut && r.URL.Path == "/api/v1/runners/runner_1/heartbeat":
			heartbeatCount += 1
			if heartbeatCount == 1 {
				go func() {
					time.Sleep(time.Millisecond)
					cancel()
				}()
			}
			_, _ = w.Write([]byte(`{"runnerId":"runner_1","state":"active","currentLoad":0,"runtimeUsage":[],"runtimeInventory":[],"lastHeartbeatAt":null}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/work-items":
			_, _ = w.Write([]byte(`{"data":[],"pagination":{"limit":50,"hasMore":false,"nextCursor":null}}`))
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/channel"):
			if got := r.Header.Get("authorization"); got != "Bearer token" {
				t.Fatalf("expected runner channel authorization header, got %q", got)
			}
			// The relay hub dials the runner pool channel via WebSocket upgrade.
			// A non-upgrade response causes the hub to log a warning and retry
			// after its reconnect delay, which is fine for this integration test.
			w.WriteHeader(http.StatusBadRequest)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	env := map[string]string{
		"AMA_API_SERVER":                  server.URL,
		"AMA_TOKEN":                       "token",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
		"XDG_STATE_HOME":                  t.TempDir(),
	}
	err := Application{Getenv: func(key string) string { return env[key] }}.Run(ctx)
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if heartbeatCount < 2 {
		t.Fatalf("expected active and offline heartbeats, got %d", heartbeatCount)
	}
}
