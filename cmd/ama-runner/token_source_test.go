package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunnerTokenSourceRefreshesExpiredSavedToken(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := SaveRunnerConfig(configPath, SavedRunnerConfig{
		Origin:        "http://ama.example.test",
		AccessToken:   "expired-access-token",
		RefreshToken:  "old-refresh-token",
		TokenType:     "Bearer",
		ExpiresAt:     time.Now().Add(-time.Minute).UTC().Format(time.RFC3339),
		ProjectID:     "project_1",
		EnvironmentID: "env_1",
		RunnerID:      "runner_1",
	}); err != nil {
		t.Fatal(err)
	}
	refreshes := 0
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
		case "/token":
			refreshes += 1
			if r.FormValue("grant_type") != refreshGrantType ||
				r.FormValue("client_id") != "runner-client" ||
				r.FormValue("refresh_token") != "old-refresh-token" {
				t.Fatalf("unexpected refresh form: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "fresh-access-token",
				"refresh_token": "new-refresh-token",
				"token_type":    "Bearer",
				"expires_in":    3600,
				"scope":         "openid profile email offline_access",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	source, err := NewRunnerTokenSource(Config{
		ConfigPath: configPath,
		Origin:     server.URL,
		Token:      "expired-access-token",
	}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	token, err := source.AccessToken(context.Background())
	if err != nil {
		t.Fatalf("expected refresh to succeed, got %v", err)
	}
	if token != "fresh-access-token" || refreshes != 1 {
		t.Fatalf("unexpected refresh result token=%q refreshes=%d", token, refreshes)
	}
	saved, err := LoadSavedRunnerConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.AccessToken != "fresh-access-token" ||
		saved.RefreshToken != "new-refresh-token" ||
		saved.ProjectID != "project_1" ||
		saved.EnvironmentID != "env_1" ||
		saved.RunnerID != "runner_1" {
		t.Fatalf("unexpected persisted refreshed config: %#v", saved)
	}
}

func TestRunnerAuthTransportRefreshesAndRetriesUnauthorizedRequest(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := SaveRunnerConfig(configPath, SavedRunnerConfig{
		Origin:       "http://ama.example.test",
		AccessToken:  "stale-access-token",
		RefreshToken: "refresh-token",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	secureRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/secure":
			secureRequests += 1
			if r.Header.Get("authorization") == "Bearer stale-access-token" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"message":"expired"}}`))
				return
			}
			if r.Header.Get("authorization") != "Bearer fresh-access-token" {
				t.Fatalf("unexpected authorization header: %s", r.Header.Get("authorization"))
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/api/health":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":         "ok",
				"name":           "Any Managed Agents",
				"runtime":        "cloudflare-workers",
				"oidcIssuer":     "http://" + r.Host + "/issuer",
				"runnerClientId": "runner-client",
			})
		case "/issuer/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        "http://" + r.Host + "/issuer",
				"device_authorization_endpoint": "http://" + r.Host + "/device",
				"token_endpoint":                "http://" + r.Host + "/token",
			})
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fresh-access-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	source, err := NewRunnerTokenSource(Config{
		ConfigPath: configPath,
		Origin:     server.URL,
		Token:      "stale-access-token",
	}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: runnerAuthTransport{Base: http.DefaultTransport, Tokens: source}}
	res, err := client.Post(server.URL+"/secure", "application/json", strings.NewReader(`{"ping":true}`))
	if err != nil {
		t.Fatalf("expected retry request to succeed, got %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || secureRequests != 2 {
		t.Fatalf("expected one unauthorized request and one retry, status=%d requests=%d", res.StatusCode, secureRequests)
	}
}
