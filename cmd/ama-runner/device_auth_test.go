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
)

func TestLoginWithDeviceAuthorizationStoresTokenWithoutPrintingIt(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "ama-runner", "config.json")
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        "https://issuer.example.test",
				"device_authorization_endpoint": "http://" + r.Host + "/device",
				"token_endpoint":                "http://" + r.Host + "/token",
			})
		case "/device":
			if r.FormValue("client_id") != "runner-client" || r.FormValue("scope") != "openid ama:runner" {
				t.Fatalf("unexpected device request form: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "device-code",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          "https://issuer.example.test/device",
				"verification_uri_complete": "https://issuer.example.test/device?user_code=ABCD-EFGH",
				"expires_in":                60,
				"interval":                  0,
			})
		case "/token":
			polls += 1
			if r.FormValue("grant_type") != deviceGrantType || r.FormValue("device_code") != "device-code" {
				t.Fatalf("unexpected token request form: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "access-token-secret",
				"refresh_token": "refresh-token-secret",
				"token_type":    "Bearer",
				"expires_in":    3600,
				"scope":         "openid ama:runner",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	var output bytes.Buffer
	result, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
		Origin:       "https://ama.example.test",
		Issuer:       server.URL,
		ClientID:     "runner-client",
		Scopes:       "openid ama:runner",
		ConfigPath:   configPath,
		Output:       &output,
		PollInterval: time.Millisecond,
	})
	if err != nil {
		t.Fatalf("expected login to succeed, got %v", err)
	}
	if result.ConfigPath != configPath || polls != 1 {
		t.Fatalf("unexpected result %#v polls=%d", result, polls)
	}
	if strings.Contains(output.String(), "access-token-secret") || strings.Contains(output.String(), "refresh-token-secret") {
		t.Fatalf("login output leaked token material: %s", output.String())
	}
	if !strings.Contains(output.String(), "ABCD-EFGH") || !strings.Contains(output.String(), "https://issuer.example.test/device") {
		t.Fatalf("login output omitted device instructions: %s", output.String())
	}

	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected 0600 config permissions, got %v", info.Mode().Perm())
	}
	saved, err := LoadSavedRunnerConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.AccessToken != "access-token-secret" || saved.RefreshToken != "refresh-token-secret" {
		t.Fatalf("unexpected saved token config: %#v", saved)
	}
}

func TestLoginWithDeviceAuthorizationErrors(t *testing.T) {
	t.Run("missing metadata", func(t *testing.T) {
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{}, DeviceLoginOptions{
			Origin:     "https://ama.example.test",
			ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		})
		if err == nil || !strings.Contains(err.Error(), "OIDC metadata") {
			t.Fatalf("expected metadata error, got %v", err)
		}
	})

	t.Run("discovery failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"issuer":"issuer"}`))
		}))
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			Origin:     "https://ama.example.test",
			Issuer:     server.URL,
			ClientID:   "runner-client",
			ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		})
		if err == nil || !strings.Contains(err.Error(), "device and token endpoints") {
			t.Fatalf("expected discovery error, got %v", err)
		}
	})

	t.Run("device start failure", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/device" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_client","error_description":"runner client rejected"}`))
				return
			}
			t.Fatalf("unexpected request %s", r.URL.Path)
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			Origin:     "https://ama.example.test",
			Issuer:     server.URL,
			ClientID:   "runner-client",
			ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		})
		if err == nil || !strings.Contains(err.Error(), "runner client rejected") {
			t.Fatalf("expected device start error, got %v", err)
		}
	})

	t.Run("poll failure", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/device":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_code":      "device-code",
					"user_code":        "ABCD-EFGH",
					"verification_uri": "https://issuer.example.test/device",
					"expires_in":       60,
				})
			case "/token":
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"access_denied"}`))
			default:
				t.Fatalf("unexpected request %s", r.URL.Path)
			}
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			Origin:       "https://ama.example.test",
			Issuer:       server.URL,
			ClientID:     "runner-client",
			ConfigPath:   filepath.Join(t.TempDir(), "config.json"),
			PollInterval: time.Millisecond,
		})
		if err == nil || !strings.Contains(err.Error(), "denied") {
			t.Fatalf("expected poll error, got %v", err)
		}
	})

	t.Run("save failure", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/device":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_code":      "device-code",
					"user_code":        "ABCD-EFGH",
					"verification_uri": "https://issuer.example.test/device",
					"expires_in":       60,
				})
			case "/token":
				_, _ = w.Write([]byte(`{"access_token":"token","token_type":"Bearer"}`))
			default:
				t.Fatalf("unexpected request %s", r.URL.Path)
			}
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			Origin:       "https://ama.example.test",
			Issuer:       server.URL,
			ClientID:     "runner-client",
			PollInterval: time.Millisecond,
		})
		if err == nil || !strings.Contains(err.Error(), "config path") {
			t.Fatalf("expected save config error, got %v", err)
		}
	})
}

func TestDeviceTokenPollingHandlesPendingSlowDownExpiredAndErrors(t *testing.T) {
	t.Run("pending then slow down then success", func(t *testing.T) {
		polls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			polls += 1
			switch polls {
			case 1:
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
			case 2:
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"slow_down"}`))
			default:
				_, _ = w.Write([]byte(`{"access_token":"token","token_type":"Bearer"}`))
			}
		}))
		defer server.Close()
		token, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
		)
		if err != nil || token.AccessToken != "token" || polls != 3 {
			t.Fatalf("unexpected polling result token=%#v polls=%d err=%v", token, polls, err)
		}
	})

	t.Run("provider error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_request","error_description":"bad device code"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
		)
		if err == nil || !strings.Contains(err.Error(), "bad device code") {
			t.Fatalf("expected provider error, got %v", err)
		}
	})

	t.Run("expired token response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"expired_token"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
		)
		if err == nil || !strings.Contains(err.Error(), "expired") {
			t.Fatalf("expected expired error, got %v", err)
		}
	})

	t.Run("access denied", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"access_denied"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
		)
		if err == nil || !strings.Contains(err.Error(), "denied") {
			t.Fatalf("expected denied error, got %v", err)
		}
	})

	t.Run("missing access token", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"token_type":"Bearer"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
		)
		if err == nil || !strings.Contains(err.Error(), "access token") {
			t.Fatalf("expected missing access token error, got %v", err)
		}
	})

	t.Run("local expiry", func(t *testing.T) {
		_, err := (DeviceAuthClient{}).PollDeviceToken(
			context.Background(),
			"https://issuer.example.test/token",
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: -1},
			time.Millisecond,
		)
		if err == nil || !strings.Contains(err.Error(), "expired") {
			t.Fatalf("expected local expiry error, got %v", err)
		}
	})
}

func TestDeviceAuthorizationStartAndDiscoveryErrors(t *testing.T) {
	t.Run("device endpoint provider error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_client","error_description":"client rejected"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).StartDeviceAuthorization(
			context.Background(),
			server.URL,
			"runner-client",
			"openid ama:runner",
		)
		if err == nil || !strings.Contains(err.Error(), "client rejected") {
			t.Fatalf("expected device endpoint error, got %v", err)
		}
	})

	t.Run("incomplete device response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"device_code":"device"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).StartDeviceAuthorization(
			context.Background(),
			server.URL,
			"runner-client",
			"openid ama:runner",
		)
		if err == nil || !strings.Contains(err.Error(), "incomplete") {
			t.Fatalf("expected incomplete response error, got %v", err)
		}
	})

	t.Run("incomplete discovery metadata", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"issuer":"issuer"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).Discover(context.Background(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "device and token endpoints") {
			t.Fatalf("expected discovery endpoint error, got %v", err)
		}
	})
}

func TestLoadLoginCommandValidation(t *testing.T) {
	_, err := LoadLoginCommand(nil, func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "AMA origin is required") {
		t.Fatalf("expected missing origin error, got %v", err)
	}
	_, err = LoadLoginCommand([]string{"--origin", "://bad"}, func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "absolute URL") {
		t.Fatalf("expected malformed origin error, got %v", err)
	}
	command, err := LoadLoginCommand(
		[]string{"--origin", "https://ama.example.test", "--config", "/tmp/runner.json"},
		func(string) string { return "" },
	)
	if err != nil {
		t.Fatalf("expected login command config, got %v", err)
	}
	if command.Origin != "https://ama.example.test" || command.ConfigPath != "/tmp/runner.json" {
		t.Fatalf("unexpected login command: %#v", command)
	}
}

func TestLoadSavedRunnerConfigRejectsExpiredToken(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := SaveRunnerConfig(configPath, SavedRunnerConfig{
		Origin:      "https://ama.example.test",
		AccessToken: "expired-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	_, err := LoadSavedRunnerConfig(configPath)
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired saved token error, got %v", err)
	}
}

func TestRunnerConfigValidationHelpers(t *testing.T) {
	if err := SaveRunnerConfig("", SavedRunnerConfig{AccessToken: "token"}); err == nil {
		t.Fatal("expected missing config path error")
	}
	if err := SaveRunnerConfig(filepath.Join(t.TempDir(), "config.json"), SavedRunnerConfig{}); err == nil {
		t.Fatal("expected missing access token error")
	}
	malformedPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(malformedPath, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadSavedRunnerConfig(malformedPath); err == nil {
		t.Fatal("expected malformed config error")
	}
	badDatePath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(badDatePath, []byte(`{"origin":"https://ama.example.test","accessToken":"token","expiresAt":"soon"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadSavedRunnerConfig(badDatePath); err == nil {
		t.Fatal("expected malformed expiry error")
	}
	if expiresAt(0) != "" {
		t.Fatal("expected no expiry for non-positive token lifetime")
	}
	if errorDescription(tokenResponse{Description: "described"}) != "described" {
		t.Fatal("expected description to win")
	}
	if errorDescription(tokenResponse{Error: "invalid_request"}) != "invalid_request" {
		t.Fatal("expected error code fallback")
	}
	if errorDescription(tokenResponse{}) != "provider_error" {
		t.Fatal("expected provider fallback")
	}
}

func loginTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        server.URL,
				"device_authorization_endpoint": server.URL + "/device",
				"token_endpoint":                server.URL + "/token",
			})
			return
		}
		handler(w, r)
	}))
	return server
}
