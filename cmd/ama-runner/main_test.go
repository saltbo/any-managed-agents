package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestRunWithContextWiresSDKDaemonAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	heartbeatCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/health":
			_, _ = w.Write([]byte(`{"status":"ok","name":"Any Managed Agents","runtime":"cloudflare-workers"}`))
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
