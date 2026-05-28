package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadConfigFailsFastOnMissingRequiredValues(t *testing.T) {
	_, err := LoadConfig(nil, func(string) string { return "" })
	if err == nil {
		t.Fatal("expected missing config to fail")
	}
	if !strings.Contains(err.Error(), "AMA origin is required") {
		t.Fatalf("expected origin validation error, got %v", err)
	}
}

func TestLoadConfigRequiresUnsafeProcessAcknowledgement(t *testing.T) {
	env := map[string]string{
		"AMA_ORIGIN":              "https://ama.example.test",
		"AMA_TOKEN":               "token",
		"AMA_RUNNER_NAME":         "runner",
		"AMA_RUNNER_CAPABILITIES": "sandbox.exec",
	}
	_, err := LoadConfig(nil, func(key string) string { return env[key] })
	if err == nil {
		t.Fatal("expected unsafe adapter acknowledgement to fail")
	}
	if !strings.Contains(err.Error(), "process-unsafe adapter requires") {
		t.Fatalf("expected unsafe adapter error, got %v", err)
	}
}

func TestLoadConfigRejectsMalformedEnvValues(t *testing.T) {
	env := map[string]string{"AMA_RUNNER_LEASE_SECONDS": "soon"}
	_, err := LoadConfig(nil, func(key string) string { return env[key] })
	if err == nil {
		t.Fatal("expected malformed env value to fail")
	}
	if !strings.Contains(err.Error(), "AMA_RUNNER_LEASE_SECONDS must be an integer") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestLoadConfigRejectsMalformedDurationEnvValues(t *testing.T) {
	env := map[string]string{"AMA_RUNNER_RENEW_INTERVAL": "soon"}
	_, err := LoadConfig(nil, func(key string) string { return env[key] })
	if err == nil {
		t.Fatal("expected malformed duration env value to fail")
	}
	if !strings.Contains(err.Error(), "AMA_RUNNER_RENEW_INTERVAL must be a duration") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestLoadConfigRejectsMalformedBoolEnvValues(t *testing.T) {
	env := map[string]string{"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "maybe"}
	_, err := LoadConfig(nil, func(key string) string { return env[key] })
	if err == nil {
		t.Fatal("expected malformed bool env value to fail")
	}
	if !strings.Contains(err.Error(), "AMA_RUNNER_ALLOW_UNSAFE_PROCESS must be a boolean") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestLoadConfigParsesValidatedRunnerConfig(t *testing.T) {
	env := map[string]string{
		"AMA_ORIGIN":                      "https://ama.example.test",
		"AMA_TOKEN":                       "token",
		"AMA_RUNNER_NAME":                 "runner",
		"AMA_RUNNER_CAPABILITIES":         "sandbox.exec,sandbox.read",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
		"AMA_RUNNER_LEASE_SECONDS":        "90",
		"AMA_RUNNER_RENEW_INTERVAL":       "30s",
	}
	config, err := LoadConfig([]string{"--heartbeat-interval", "25s"}, func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("expected valid config, got %v", err)
	}
	if config.Origin != "https://ama.example.test" || config.RunnerName != "runner" {
		t.Fatalf("unexpected config: %#v", config)
	}
	if got := strings.Join(config.Capabilities, ","); got != "sandbox.exec,sandbox.read" {
		t.Fatalf("unexpected capabilities %q", got)
	}
	if config.LeaseDurationSeconds != 90 || config.RenewInterval != 30*time.Second || config.HeartbeatInterval != 25*time.Second {
		t.Fatalf("unexpected timing config: %#v", config)
	}
}

func TestLoadConfigFlagsOverrideEnvironment(t *testing.T) {
	env := map[string]string{
		"AMA_ORIGIN":                      "https://env.example.test",
		"AMA_TOKEN":                       "env-token",
		"AMA_RUNNER_ID":                   "runner_env",
		"AMA_RUNNER_NAME":                 "env-runner",
		"AMA_ENVIRONMENT_ID":              "env_old",
		"AMA_RUNNER_CAPABILITIES":         "sandbox.exec",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS": "true",
	}
	config, err := LoadConfig([]string{
		"--origin", "https://flag.example.test",
		"--token", "flag-token",
		"--runner-id", "runner_flag",
		"--runner-name", "flag-runner",
		"--environment-id", "env_flag",
		"--capabilities", "sandbox.exec,sandbox.write",
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
	}, func(key string) string { return env[key] })
	if err != nil {
		t.Fatalf("expected valid flag config, got %v", err)
	}
	if config.Origin != "https://flag.example.test" || config.Token != "flag-token" || config.RunnerID != "runner_flag" {
		t.Fatalf("flags did not override env: %#v", config)
	}
	if config.WorkDir != "/tmp/flag-work" || config.PollInterval != 2*time.Second || config.CommandTimeout != 45*time.Second {
		t.Fatalf("unexpected flag values: %#v", config)
	}
}

func TestConfigValidateRejectsInvalidBoundaries(t *testing.T) {
	valid := Config{
		Origin:                "https://ama.example.test",
		Token:                 "token",
		RunnerName:            "runner",
		Capabilities:          []string{"sandbox.exec"},
		SandboxAdapter:        processUnsafeAdapter,
		AllowUnsafeProcess:    true,
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
		{"origin", func(c *Config) { c.Origin = "://bad" }, "absolute URL"},
		{"token", func(c *Config) { c.Token = "" }, "AMA token"},
		{"name", func(c *Config) { c.RunnerName = strings.Repeat("x", 121) }, "runner name"},
		{"capabilities", func(c *Config) { c.Capabilities = nil }, "capabilities"},
		{"adapter", func(c *Config) { c.SandboxAdapter = "docker" }, "unsupported sandbox adapter"},
		{"max", func(c *Config) { c.MaxConcurrent = 2 }, "max-concurrent=1"},
		{"lease", func(c *Config) { c.LeaseDurationSeconds = 10 }, "lease duration"},
		{"heartbeat", func(c *Config) { c.HeartbeatInterval = time.Minute }, "heartbeat interval"},
		{"renew", func(c *Config) { c.RenewInterval = time.Minute }, "renew interval"},
		{"poll", func(c *Config) { c.PollInterval = 0 }, "must be greater than zero"},
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
		"origin": "https://ama.example.test",
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
	config, err := LoadConfig([]string{"--config", configPath}, func(string) string { return "" })
	if err != nil {
		t.Fatalf("expected config file to load, got %v", err)
	}
	if config.WorkDir != "/tmp/ama-runner" || config.RenewInterval != 30*time.Second {
		t.Fatalf("unexpected config file values: %#v", config)
	}
}

func TestLoadConfigFileCanExplicitlyDisableUnsafeEnv(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := os.WriteFile(configPath, []byte(`{
		"origin": "https://ama.example.test",
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
	_, err := LoadConfig([]string{"--config", configPath}, func(key string) string { return env[key] })
	if err == nil || !strings.Contains(err.Error(), "process-unsafe adapter requires") {
		t.Fatalf("expected explicit false to override env, got %v", err)
	}
}

func TestLoadConfigReadsJSONConfigFileWithNumericDuration(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	if err := os.WriteFile(configPath, []byte(`{
		"origin": "https://ama.example.test",
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
	config, err := LoadConfig([]string{"--config", configPath}, func(string) string { return "" })
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
		"origin": "https://ama.example.test",
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
	_, err := LoadConfig([]string{"--config", configPath}, func(key string) string { return env[key] })
	if err == nil || !strings.Contains(err.Error(), "process-unsafe adapter requires") {
		t.Fatalf("expected config file false to override env true, got %v", err)
	}
}

func TestLoadConfigFileErrors(t *testing.T) {
	_, err := LoadConfig([]string{"--config", filepath.Join(t.TempDir(), "missing.json")}, func(string) string { return "" })
	if err == nil {
		t.Fatal("expected missing config file error")
	}
	badPath := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(badPath, []byte(`{"renewInterval": false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = LoadConfig([]string{"--config", badPath}, func(string) string { return "" })
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
