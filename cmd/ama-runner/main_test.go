package main

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

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestRunFailsOnInvalidConfig(t *testing.T) {
	err := run([]string{"--origin", "://bad"})
	if err == nil {
		t.Fatal("expected invalid config error")
	}
	if !strings.Contains(err.Error(), "absolute URL") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestRunLoginDiscoversDeviceFlowAndStoresToken(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	var output bytes.Buffer
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/health":
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

	err := runLogin(
		context.Background(),
		[]string{"--origin", server.URL, "--config", configPath},
		func(string) string { return "" },
		&output,
	)
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
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/health":
			_, _ = w.Write([]byte(`{"status":"ok","name":"Any Managed Agents","runtime":"cloudflare-workers","oidcIssuer":"https://issuer.example.test","runnerClientId":"runner-client","runnerScopes":"openid profile email offline_access"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/runners":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"runner_1","name":"runner","capabilities":["sandbox.exec"],"status":"offline","currentLoad":0,"maxConcurrent":1}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/runners/runner_1/heartbeats":
			heartbeatCount += 1
			if heartbeatCount == 1 {
				go func() {
					time.Sleep(time.Millisecond)
					cancel()
				}()
			}
			_, _ = w.Write([]byte(`{"id":"runner_1","name":"runner","capabilities":["sandbox.exec"],"status":"active","currentLoad":0,"maxConcurrent":1}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/runners/runner_1/leases":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	env := map[string]string{
		"AMA_ORIGIN":                      server.URL,
		"AMA_TOKEN":                       "token",
		"AMA_RUNNER_NAME":                 "runner",
		"AMA_RUNNER_CAPABILITIES":         "sandbox.exec",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
		"AMA_RUNNER_POLL_INTERVAL":        "1s",
	}
	err := runWithContext(ctx, nil, func(key string) string { return env[key] })
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if heartbeatCount < 2 {
		t.Fatalf("expected active and offline heartbeats, got %d", heartbeatCount)
	}
}

func TestSDKRunnerSessionChannelOpenerReturnsURLValidationErrors(t *testing.T) {
	opener := sdkRunnerSessionChannelOpener{client: &ama.Client{Origin: "ftp://ama.example.test"}}
	_, err := opener.OpenRunnerSessionChannel(context.Background(), "runner_1", "lease_1")
	if err == nil || !strings.Contains(err.Error(), "http or https") {
		t.Fatalf("expected URL validation error, got %v", err)
	}
}
