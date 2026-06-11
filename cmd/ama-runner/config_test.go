package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadConfigFailsFastOnMissingRequiredValues(t *testing.T) {
	_, err := LoadConfig(nil, testGetenv(t, nil))
	if err == nil {
		t.Fatal("expected missing config to fail")
	}
	if !strings.Contains(err.Error(), "AMA API server URL is required") {
		t.Fatalf("expected API server validation error, got %v", err)
	}
}

func TestLoadConfigRequiresUnsafeProcessAcknowledgement(t *testing.T) {
	env := map[string]string{
		"AMA_API_SERVER": "https://ama.example.test",
		"AMA_TOKEN":      "token",
	}
	_, err := LoadConfig(nil, testGetenv(t, env))
	if err == nil {
		t.Fatal("expected unsafe adapter acknowledgement to fail")
	}
	if !strings.Contains(err.Error(), "process-unsafe adapter requires") {
		t.Fatalf("expected unsafe adapter error, got %v", err)
	}
}

func TestLoadConfigRejectsMalformedEnvValues(t *testing.T) {
	env := map[string]string{"AMA_RUNNER_LEASE_SECONDS": "soon"}
	_, err := LoadConfig(nil, testGetenv(t, env))
	if err == nil {
		t.Fatal("expected malformed env value to fail")
	}
	if !strings.Contains(err.Error(), "AMA_RUNNER_LEASE_SECONDS must be an integer") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestLoadConfigRejectsMalformedDurationEnvValues(t *testing.T) {
	env := map[string]string{"AMA_RUNNER_RENEW_INTERVAL": "soon"}
	_, err := LoadConfig(nil, testGetenv(t, env))
	if err == nil {
		t.Fatal("expected malformed duration env value to fail")
	}
	if !strings.Contains(err.Error(), "AMA_RUNNER_RENEW_INTERVAL must be a duration") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestLoadConfigRejectsMalformedBoolEnvValues(t *testing.T) {
	env := map[string]string{"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "maybe"}
	_, err := LoadConfig(nil, testGetenv(t, env))
	if err == nil {
		t.Fatal("expected malformed bool env value to fail")
	}
	if !strings.Contains(err.Error(), "AMA_RUNNER_ALLOW_UNSAFE_PROCESS must be a boolean") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestLoadConfigParsesValidatedRunnerConfig(t *testing.T) {
	env := map[string]string{
		"AMA_API_SERVER":                  "https://ama.example.test",
		"AMA_TOKEN":                       "token",
		"AMA_PROJECT_ID":                  "project_env",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
		"AMA_RUNNER_LEASE_SECONDS":        "90",
		"AMA_RUNNER_RENEW_INTERVAL":       "30s",
	}
	config, err := LoadConfig([]string{"--heartbeat-interval", "25s"}, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected valid config, got %v", err)
	}
	if config.Origin != "https://ama.example.test" || config.ProjectID != "project_env" {
		t.Fatalf("unexpected config: %#v", config)
	}
	if config.LeaseDurationSeconds != 90 || config.RenewInterval != 30*time.Second || config.HeartbeatInterval != 25*time.Second {
		t.Fatalf("unexpected timing config: %#v", config)
	}
	if config.MaxConcurrent != 5 {
		t.Fatalf("expected default max concurrent leases to be 5, got %d", config.MaxConcurrent)
	}
}

func TestLoadConfigUsesSavedDeviceLoginTokenWhenNoExplicitTokenIsProvided(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := SaveRunnerConfig(configPath, SavedRunnerConfig{
		Origin:      "https://ama.example.test",
		AccessToken: "saved-token",
		ProjectID:   "project_saved",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"AMA_RUNNER_CONFIG":               configPath,
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
		"AMA_RUNNER_HEARTBEAT_INTERVAL":   "20s",
		"AMA_RUNNER_RENEW_INTERVAL":       "20s",
		"AMA_RUNNER_LEASE_SECONDS":        "60",
		"AMA_RUNNER_COMMAND_TIMEOUT":      "1s",
		"AMA_RUNNER_SHUTDOWN_GRACE":       "1s",
	}
	config, err := LoadConfig(nil, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected saved token config to load, got %v", err)
	}
	if config.Origin != "https://ama.example.test" || config.Token != "saved-token" || config.ProjectID != "project_saved" {
		t.Fatalf("unexpected saved token config: %#v", config)
	}

	env["AMA_TOKEN"] = "override-token"
	config, err = LoadConfig(nil, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected env token override to load, got %v", err)
	}
	if config.Token != "override-token" {
		t.Fatalf("expected explicit env token to win, got %q", config.Token)
	}
}

func TestLoadConfigFlagsOverrideEnvironment(t *testing.T) {
	env := map[string]string{
		"AMA_API_SERVER":                  "https://env.example.test",
		"AMA_TOKEN":                       "env-token",
		"AMA_PROJECT_ID":                  "project_env",
		"AMA_ENVIRONMENT_ID":              "env_old",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
	}
	config, err := LoadConfig([]string{
		"--api-server", "https://flag.example.test",
		"--token", "flag-token",
		"--project-id", "project_flag",
		"--environment-id", "env_flag",
		"--sandbox-adapter", processUnsafeAdapter,
		"--allow-unsafe-process=false",
		"--allow-unsafe-process",
		"--workdir", "/tmp/flag-work",
		"--max-concurrent", "1",
		"--poll-interval", "2s",
		"--heartbeat-interval", "10s",
		"--lease-seconds", "30",
		"--renew-interval", "5s",
		"--command-timeout", "45s",
		"--shutdown-grace", "3s",
	}, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected valid flag config, got %v", err)
	}
	if config.Origin != "https://flag.example.test" || config.Token != "flag-token" || config.ProjectID != "project_flag" {
		t.Fatalf("flags did not override env: %#v", config)
	}
	if config.WorkDir != "/tmp/flag-work" || config.PollInterval != 2*time.Second || config.CommandTimeout != 45*time.Second {
		t.Fatalf("unexpected flag values: %#v", config)
	}
}

func TestLoadConfigMaxSessionDuration(t *testing.T) {
	env := map[string]string{
		"AMA_API_SERVER":                  "https://ama.example.test",
		"AMA_TOKEN":                       "token",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
	}
	config, err := LoadConfig(nil, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected valid config, got %v", err)
	}
	if config.MaxSessionDuration != 2*time.Hour {
		t.Fatalf("expected default max session duration of 2h, got %v", config.MaxSessionDuration)
	}

	env["AMA_RUNNER_MAX_SESSION_DURATION"] = "45m"
	config, err = LoadConfig(nil, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected valid env config, got %v", err)
	}
	if config.MaxSessionDuration != 45*time.Minute {
		t.Fatalf("expected env max session duration, got %v", config.MaxSessionDuration)
	}

	config, err = LoadConfig([]string{"--max-session-duration", "0"}, testGetenv(t, env))
	if err != nil {
		t.Fatalf("expected valid flag config, got %v", err)
	}
	if config.MaxSessionDuration != 0 {
		t.Fatalf("expected flag to disable max session duration, got %v", config.MaxSessionDuration)
	}
}

func TestConfigValidateRejectsInvalidBoundaries(t *testing.T) {
	valid := Config{
		Origin:                "https://ama.example.test",
		Token:                 "token",
		SandboxAdapter:        processUnsafeAdapter,
		AllowUnsafeProcess:    true,
		StateDir:              t.TempDir(),
		WorkDir:               t.TempDir(),
		MaxConcurrent:         1,
		PollInterval:          time.Second,
		HeartbeatInterval:     20 * time.Second,
		LeaseDurationSeconds:  60,
		RenewInterval:         20 * time.Second,
		CommandTimeout:        time.Second,
		ShutdownGraceInterval: time.Millisecond,
	}
	cases := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"apiServer", func(c *Config) { c.Origin = "://bad" }, "absolute URL"},
		{"token", func(c *Config) { c.Token = "" }, "AMA token"},
		{"adapter", func(c *Config) { c.SandboxAdapter = "docker" }, "unsupported sandbox adapter"},
		{"max", func(c *Config) { c.MaxConcurrent = 0 }, "max concurrent"},
		{"lease", func(c *Config) { c.LeaseDurationSeconds = 10 }, "lease duration"},
		{"heartbeat", func(c *Config) { c.HeartbeatInterval = time.Minute }, "heartbeat interval"},
		{"renew", func(c *Config) { c.RenewInterval = time.Minute }, "renew interval"},
		{"poll", func(c *Config) { c.PollInterval = 0 }, "must be greater than zero"},
		{"maxSession", func(c *Config) { c.MaxSessionDuration = -time.Second }, "max session duration"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			config := valid
			tc.mutate(&config)
			err := config.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q validation error, got %v", tc.want, err)
			}
		})
	}
}

func TestLoadConfigReadsJSONConfigFileWithDurationStrings(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := os.WriteFile(configPath, []byte(`{
		"apiServer": "https://ama.example.test",
		"token": "token",
		"runnerName": "runner",
		"capabilities": ["sandbox.exec"],
		"sandboxAdapter": "process-unsafe",
		"allowUnsafeProcess": true,
		"workDir": "/tmp/ama-runner",
		"maxConcurrent": 1,
		"leaseDurationSeconds": 90,
		"heartbeatInterval": "25s",
		"renewInterval": "30s"
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfig([]string{"--config", configPath}, testGetenv(t, nil))
	if err != nil {
		t.Fatalf("expected config file to load, got %v", err)
	}
	if config.WorkDir != "/tmp/ama-runner" || config.RenewInterval != 30*time.Second {
		t.Fatalf("unexpected config file values: %#v", config)
	}
}

func TestLoadConfigReadsJSONConfigFileWithSingleHyphenFlag(t *testing.T) {
	for _, args := range [][]string{{"-config"}, {}} {
		configPath := filepath.Join(t.TempDir(), "runner.json")
		if err := os.WriteFile(configPath, []byte(`{
			"apiServer": "https://ama.example.test",
			"token": "token",
			"runnerName": "runner",
			"capabilities": ["sandbox.exec"],
			"sandboxAdapter": "process-unsafe",
			"allowUnsafeProcess": true,
			"maxConcurrent": 1,
			"leaseDurationSeconds": 90,
			"heartbeatInterval": "25s",
			"renewInterval": "30s"
		}`), 0o644); err != nil {
			t.Fatal(err)
		}
		if len(args) == 1 {
			args = append(args, configPath)
		} else {
			args = []string{"-config=" + configPath}
		}
		config, err := LoadConfig(args, testGetenv(t, nil))
		if err != nil {
			t.Fatalf("expected config file to load for args %v, got %v", args, err)
		}
		if config.ConfigPath != configPath || config.Origin != "https://ama.example.test" {
			t.Fatalf("unexpected config for args %v: %#v", args, config)
		}
	}
}

func TestLoadConfigFileCanExplicitlyDisableUnsafeEnv(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := os.WriteFile(configPath, []byte(`{
		"apiServer": "https://ama.example.test",
		"token": "token",
		"runnerName": "runner",
		"capabilities": ["sandbox.exec"],
		"sandboxAdapter": "process-unsafe",
		"allowUnsafeProcess": false,
		"workDir": "/tmp/ama-runner",
		"maxConcurrent": 1,
		"leaseDurationSeconds": 90,
		"heartbeatInterval": "25s",
		"renewInterval": "30s"
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true"}
	_, err := LoadConfig([]string{"--config", configPath}, testGetenv(t, env))
	if err == nil || !strings.Contains(err.Error(), "process-unsafe adapter requires") {
		t.Fatalf("expected explicit false to override env, got %v", err)
	}
}

func TestLoadConfigReadsJSONConfigFileWithNumericDuration(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := os.WriteFile(configPath, []byte(`{
		"apiServer": "https://ama.example.test",
		"token": "token",
		"runnerName": "runner",
		"capabilities": ["sandbox.exec"],
		"sandboxAdapter": "process-unsafe",
		"allowUnsafeProcess": true,
		"workDir": "/tmp/ama-runner",
		"maxConcurrent": 1,
		"leaseDurationSeconds": 90,
		"heartbeatInterval": 25000000000,
		"renewInterval": 30000000000
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfig([]string{"--config", configPath}, testGetenv(t, nil))
	if err != nil {
		t.Fatalf("expected config file to load, got %v", err)
	}
	if config.HeartbeatInterval != 25*time.Second || config.RenewInterval != 30*time.Second {
		t.Fatalf("unexpected duration values: %#v", config)
	}
}

func TestLoadConfigFileCanDisableUnsafeProcessInheritedFromEnv(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := os.WriteFile(configPath, []byte(`{
		"apiServer": "https://ama.example.test",
		"token": "token",
		"runnerName": "runner",
		"capabilities": ["sandbox.exec"],
		"sandboxAdapter": "process-unsafe",
		"allowUnsafeProcess": false,
		"workDir": "/tmp/ama-runner",
		"maxConcurrent": 1,
		"leaseDurationSeconds": 90,
		"heartbeatInterval": "25s",
		"renewInterval": "30s"
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true"}
	_, err := LoadConfig([]string{"--config", configPath}, testGetenv(t, env))
	if err == nil || !strings.Contains(err.Error(), "process-unsafe adapter requires") {
		t.Fatalf("expected config file false to override env true, got %v", err)
	}
}

func TestLoadConfigFileErrors(t *testing.T) {
	_, err := LoadConfig([]string{"--config", filepath.Join(t.TempDir(), "missing.json")}, testGetenv(t, nil))
	if err == nil {
		t.Fatal("expected missing config file error")
	}
	badPath := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(badPath, []byte(`{"renewInterval": false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = LoadConfig([]string{"--config", badPath}, testGetenv(t, nil))
	if err == nil {
		t.Fatal("expected invalid config file error")
	}
}

func TestDurationJSONRejectsInvalidString(t *testing.T) {
	var value durationJSON
	if err := value.UnmarshalJSON([]byte(`"soon"`)); err == nil {
		t.Fatal("expected invalid duration string error")
	}
}

func TestEnvOrUsesFallbackForMissingValue(t *testing.T) {
	value := envOr(testGetenv(t, nil), "AMA_RUNNER_WORKDIR", "/state/ama-runner/work")
	if value != "/state/ama-runner/work" {
		t.Fatalf("expected fallback value, got %q", value)
	}
}

func TestDefaultStateDirFollowsXDGStateDirectory(t *testing.T) {
	env := map[string]string{
		"XDG_STATE_HOME": "/state",
		"HOME":           "/home/runner",
	}
	if got := defaultStateDir(func(key string) string { return env[key] }); got != filepath.Join("/state", "ama-runner") {
		t.Fatalf("expected XDG state dir, got %q", got)
	}
	if got := defaultWorkDir(func(key string) string { return env[key] }); got != filepath.Join("/state", "ama-runner", "work") {
		t.Fatalf("expected XDG work dir, got %q", got)
	}
	delete(env, "XDG_STATE_HOME")
	if got := defaultStateDir(func(key string) string { return env[key] }); got != filepath.Join("/home/runner", ".local", "state", "ama-runner") {
		t.Fatalf("expected HOME state dir, got %q", got)
	}
	if got := defaultWorkDir(func(key string) string { return env[key] }); got != filepath.Join("/home/runner", ".local", "state", "ama-runner", "work") {
		t.Fatalf("expected HOME work dir, got %q", got)
	}
	delete(env, "HOME")
	if got := defaultStateDir(func(key string) string { return env[key] }); got != "" {
		t.Fatalf("expected empty state dir without XDG_STATE_HOME or HOME, got %q", got)
	}
}

func testGetenv(t *testing.T, env map[string]string) func(string) string {
	t.Helper()
	stateHome := t.TempDir()
	return func(key string) string {
		if env != nil {
			if value, ok := env[key]; ok {
				return value
			}
		}
		if key == "XDG_STATE_HOME" {
			return stateHome
		}
		return ""
	}
}
