package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func loadConfigFile(path string) (Config, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, false, err
	}
	var file configFile
	if err := json.Unmarshal(data, &file); err != nil {
		return Config{}, false, err
	}
	return file.Config(), file.AllowUnsafeProcess != nil, nil
}

func defaultConfigPath(getenv func(string) string) string {
	if path := getenv("AMA_RUNNER_CONFIG"); strings.TrimSpace(path) != "" {
		return path
	}
	if configHome := getenv("XDG_CONFIG_HOME"); strings.TrimSpace(configHome) != "" {
		return configHome + string(os.PathSeparator) + "ama-runner" + string(os.PathSeparator) + "config.json"
	}
	if home := getenv("HOME"); strings.TrimSpace(home) != "" {
		return home + string(os.PathSeparator) + ".config" + string(os.PathSeparator) + "ama-runner" + string(os.PathSeparator) + "config.json"
	}
	return ""
}

func defaultStateDir(getenv func(string) string) string {
	if stateHome := getenv("XDG_STATE_HOME"); strings.TrimSpace(stateHome) != "" {
		return filepath.Join(stateHome, "ama-runner")
	}
	if home := getenv("HOME"); strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".local", "state", "ama-runner")
	}
	return ""
}

func defaultWorkDir(getenv func(string) string) string {
	stateDir := defaultStateDir(getenv)
	if strings.TrimSpace(stateDir) == "" {
		return ""
	}
	return filepath.Join(stateDir, "work")
}

func visitedFlag(args []string, name string) bool {
	shortPrefix := "-" + name
	longPrefix := "--" + name
	for _, arg := range args {
		if arg == shortPrefix || arg == longPrefix || strings.HasPrefix(arg, shortPrefix+"=") || strings.HasPrefix(arg, longPrefix+"=") {
			return true
		}
	}
	return false
}

type configFile struct {
	Origin                string       `json:"apiServer"`
	Token                 string       `json:"token"`
	EnvironmentID         string       `json:"environmentId"`
	SandboxAdapter        string       `json:"sandboxAdapter"`
	AllowUnsafeProcess    *bool        `json:"allowUnsafeProcess"`
	StateDir              string       `json:"stateDir"`
	WorkDir               string       `json:"workDir"`
	MaxConcurrent         int          `json:"maxConcurrent"`
	PollInterval          durationJSON `json:"pollInterval"`
	HeartbeatInterval     durationJSON `json:"heartbeatInterval"`
	LeaseDurationSeconds  int          `json:"leaseDurationSeconds"`
	RenewInterval         durationJSON `json:"renewInterval"`
	CommandTimeout        durationJSON `json:"commandTimeout"`
	ShutdownGraceInterval durationJSON `json:"shutdownGraceInterval"`
	MaxSessionDuration    durationJSON `json:"maxSessionDuration"`
}

func (c configFile) Config() Config {
	return Config{
		Origin:                c.Origin,
		Token:                 c.Token,
		EnvironmentID:         c.EnvironmentID,
		SandboxAdapter:        c.SandboxAdapter,
		AllowUnsafeProcess:    c.AllowUnsafeProcess != nil && *c.AllowUnsafeProcess,
		StateDir:              c.StateDir,
		WorkDir:               c.WorkDir,
		MaxConcurrent:         c.MaxConcurrent,
		PollInterval:          time.Duration(c.PollInterval),
		HeartbeatInterval:     time.Duration(c.HeartbeatInterval),
		LeaseDurationSeconds:  c.LeaseDurationSeconds,
		RenewInterval:         time.Duration(c.RenewInterval),
		CommandTimeout:        time.Duration(c.CommandTimeout),
		ShutdownGraceInterval: time.Duration(c.ShutdownGraceInterval),
		MaxSessionDuration:    time.Duration(c.MaxSessionDuration),
	}
}

type durationJSON time.Duration

func (d *durationJSON) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		parsed, err := time.ParseDuration(text)
		if err != nil {
			return err
		}
		*d = durationJSON(parsed)
		return nil
	}
	var number int64
	if err := json.Unmarshal(data, &number); err != nil {
		return err
	}
	*d = durationJSON(time.Duration(number))
	return nil
}

func mergeConfig(base Config, override Config) Config {
	if override.ConfigPath != "" {
		base.ConfigPath = override.ConfigPath
	}
	if override.Origin != "" {
		base.Origin = override.Origin
	}
	if override.Token != "" {
		base.Token = override.Token
	}
	if override.EnvironmentID != "" {
		base.EnvironmentID = override.EnvironmentID
	}
	if override.SandboxAdapter != "" {
		base.SandboxAdapter = override.SandboxAdapter
	}
	if override.AllowUnsafeProcess {
		base.AllowUnsafeProcess = true
	}
	if override.StateDir != "" {
		base.StateDir = override.StateDir
	}
	if override.WorkDir != "" {
		base.WorkDir = override.WorkDir
	}
	if override.MaxConcurrent != 0 {
		base.MaxConcurrent = override.MaxConcurrent
	}
	if override.PollInterval != 0 {
		base.PollInterval = override.PollInterval
	}
	if override.HeartbeatInterval != 0 {
		base.HeartbeatInterval = override.HeartbeatInterval
	}
	if override.LeaseDurationSeconds != 0 {
		base.LeaseDurationSeconds = override.LeaseDurationSeconds
	}
	if override.RenewInterval != 0 {
		base.RenewInterval = override.RenewInterval
	}
	if override.CommandTimeout != 0 {
		base.CommandTimeout = override.CommandTimeout
	}
	if override.ShutdownGraceInterval != 0 {
		base.ShutdownGraceInterval = override.ShutdownGraceInterval
	}
	if override.MaxSessionDuration != 0 {
		base.MaxSessionDuration = override.MaxSessionDuration
	}
	return base
}

func envOr(getenv func(string) string, key string, fallback string) string {
	if value := getenv(key); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}

func parseEnvBool(getenv func(string) string, key string, fallback bool) (bool, error) {
	value := getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean", key)
	}
	return parsed, nil
}

func parseEnvInt(getenv func(string) string, key string, fallback int) (int, error) {
	value := getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	return parsed, nil
}

func parseEnvDuration(getenv func(string) string, key string, fallback time.Duration) (time.Duration, error) {
	value := getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a duration", key)
	}
	return parsed, nil
}
