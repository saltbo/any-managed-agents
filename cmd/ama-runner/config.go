package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const processUnsafeAdapter = "process-unsafe"

type Config struct {
	ConfigPath            string        `json:"-"`
	Origin                string        `json:"apiServer"`
	Token                 string        `json:"token"`
	ProjectID             string        `json:"projectId"`
	EnvironmentID         string        `json:"environmentId"`
	SandboxAdapter        string        `json:"sandboxAdapter"`
	AllowUnsafeProcess    bool          `json:"allowUnsafeProcess"`
	StateDir              string        `json:"stateDir"`
	WorkDir               string        `json:"workDir"`
	MaxConcurrent         int           `json:"maxConcurrent"`
	PollInterval          time.Duration `json:"pollInterval"`
	HeartbeatInterval     time.Duration `json:"heartbeatInterval"`
	LeaseDurationSeconds  int           `json:"leaseDurationSeconds"`
	RenewInterval         time.Duration `json:"renewInterval"`
	CommandTimeout        time.Duration `json:"commandTimeout"`
	ShutdownGraceInterval time.Duration `json:"shutdownGraceInterval"`
}

func LoadConfig(args []string, getenv func(string) string) (Config, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	envAllowUnsafeProcess, err := parseEnvBool(getenv, "AMA_RUNNER_ALLOW_UNSAFE_PROCESS", false)
	if err != nil {
		return Config{}, err
	}
	envMaxConcurrent, err := parseEnvInt(getenv, "AMA_RUNNER_MAX_CONCURRENT", 1)
	if err != nil {
		return Config{}, err
	}
	envPollInterval, err := parseEnvDuration(getenv, "AMA_RUNNER_POLL_INTERVAL", 5*time.Second)
	if err != nil {
		return Config{}, err
	}
	envHeartbeatInterval, err := parseEnvDuration(getenv, "AMA_RUNNER_HEARTBEAT_INTERVAL", 20*time.Second)
	if err != nil {
		return Config{}, err
	}
	envLeaseDurationSeconds, err := parseEnvInt(getenv, "AMA_RUNNER_LEASE_SECONDS", 60)
	if err != nil {
		return Config{}, err
	}
	envRenewInterval, err := parseEnvDuration(getenv, "AMA_RUNNER_RENEW_INTERVAL", 20*time.Second)
	if err != nil {
		return Config{}, err
	}
	envCommandTimeout, err := parseEnvDuration(getenv, "AMA_RUNNER_COMMAND_TIMEOUT", 10*time.Minute)
	if err != nil {
		return Config{}, err
	}
	envShutdownGraceInterval, err := parseEnvDuration(getenv, "AMA_RUNNER_SHUTDOWN_GRACE", 5*time.Second)
	if err != nil {
		return Config{}, err
	}
	defaultConfigFile := defaultConfigPath(getenv)
	config := Config{
		ConfigPath:            defaultConfigFile,
		Origin:                getenv("AMA_API_SERVER"),
		Token:                 getenv("AMA_TOKEN"),
		ProjectID:             getenv("AMA_PROJECT_ID"),
		EnvironmentID:         getenv("AMA_ENVIRONMENT_ID"),
		SandboxAdapter:        envOr(getenv, "AMA_RUNNER_SANDBOX_ADAPTER", processUnsafeAdapter),
		AllowUnsafeProcess:    envAllowUnsafeProcess,
		StateDir:              envOr(getenv, "AMA_RUNNER_STATE_DIR", defaultStateDir(getenv)),
		WorkDir:               envOr(getenv, "AMA_RUNNER_WORKDIR", ".ama-runner-work"),
		MaxConcurrent:         envMaxConcurrent,
		PollInterval:          envPollInterval,
		HeartbeatInterval:     envHeartbeatInterval,
		LeaseDurationSeconds:  envLeaseDurationSeconds,
		RenewInterval:         envRenewInterval,
		CommandTimeout:        envCommandTimeout,
		ShutdownGraceInterval: envShutdownGraceInterval,
	}

	flags := flag.NewFlagSet("ama-runner", flag.ContinueOnError)
	configPath := flags.String("config", config.ConfigPath, "JSON config file")
	apiServer := flags.String("api-server", config.Origin, "AMA API server URL")
	token := flags.String("token", config.Token, "AMA bearer token")
	projectID := flags.String("project-id", config.ProjectID, "AMA project id")
	environmentID := flags.String("environment-id", config.EnvironmentID, "optional bound environment id")
	sandboxAdapter := flags.String("sandbox-adapter", config.SandboxAdapter, "sandbox adapter: process-unsafe")
	allowUnsafeProcess := flags.Bool("allow-unsafe-process", config.AllowUnsafeProcess, "acknowledge unsafe process adapter")
	stateDir := flags.String("state-dir", config.StateDir, "runner local state directory")
	workDir := flags.String("workdir", config.WorkDir, "local work directory")
	maxConcurrent := flags.Int("max-concurrent", config.MaxConcurrent, "max concurrent leases")
	pollInterval := flags.Duration("poll-interval", config.PollInterval, "lease poll interval")
	heartbeatInterval := flags.Duration("heartbeat-interval", config.HeartbeatInterval, "runner heartbeat interval")
	leaseSeconds := flags.Int("lease-seconds", config.LeaseDurationSeconds, "lease duration in seconds")
	renewInterval := flags.Duration("renew-interval", config.RenewInterval, "lease renew interval")
	commandTimeout := flags.Duration("command-timeout", config.CommandTimeout, "per-command timeout")
	shutdownGrace := flags.Duration("shutdown-grace", config.ShutdownGraceInterval, "process shutdown grace interval")
	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}

	if visitedFlag(args, "config") && *configPath != "" {
		fileConfig, fileAllowUnsafeProcessSet, err := loadConfigFile(*configPath)
		if err != nil {
			return Config{}, err
		}
		fileConfig.ConfigPath = *configPath
		config = mergeConfig(config, fileConfig)
		if fileAllowUnsafeProcessSet {
			config.AllowUnsafeProcess = fileConfig.AllowUnsafeProcess
		}
	}

	visited := map[string]bool{}
	flags.Visit(func(flag *flag.Flag) {
		visited[flag.Name] = true
	})
	if visited["api-server"] {
		config.Origin = *apiServer
	}
	if visited["config"] {
		config.ConfigPath = *configPath
	}
	if visited["token"] {
		config.Token = *token
	}
	if visited["project-id"] {
		config.ProjectID = *projectID
	}
	if visited["environment-id"] {
		config.EnvironmentID = *environmentID
	}
	if visited["sandbox-adapter"] {
		config.SandboxAdapter = *sandboxAdapter
	}
	if visited["allow-unsafe-process"] {
		config.AllowUnsafeProcess = *allowUnsafeProcess
	}
	if visited["state-dir"] {
		config.StateDir = *stateDir
	}
	if visited["workdir"] {
		config.WorkDir = *workDir
	}
	if visited["max-concurrent"] {
		config.MaxConcurrent = *maxConcurrent
	}
	if visited["poll-interval"] {
		config.PollInterval = *pollInterval
	}
	if visited["heartbeat-interval"] {
		config.HeartbeatInterval = *heartbeatInterval
	}
	if visited["lease-seconds"] {
		config.LeaseDurationSeconds = *leaseSeconds
	}
	if visited["renew-interval"] {
		config.RenewInterval = *renewInterval
	}
	if visited["command-timeout"] {
		config.CommandTimeout = *commandTimeout
	}
	if visited["shutdown-grace"] {
		config.ShutdownGraceInterval = *shutdownGrace
	}

	if !visited["token"] && (strings.TrimSpace(config.Token) == "" || strings.TrimSpace(config.Origin) == "") {
		saved, err := LoadSavedRunnerConfig(config.ConfigPath)
		if err != nil {
			return Config{}, err
		}
		if saved != nil {
			if strings.TrimSpace(config.Origin) == "" {
				config.Origin = saved.Origin
			}
			if strings.TrimSpace(config.Token) == "" && config.Origin == saved.Origin {
				config.Token = saved.AccessToken
			}
			if strings.TrimSpace(config.ProjectID) == "" && config.Origin == saved.Origin {
				config.ProjectID = saved.ProjectID
			}
			if strings.TrimSpace(config.EnvironmentID) == "" && config.Origin == saved.Origin {
				config.EnvironmentID = saved.EnvironmentID
			}
		}
	}

	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

type LoginCommand struct {
	Origin     string
	ConfigPath string
}

func LoadLoginCommand(args []string, getenv func(string) string) (LoginCommand, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	command := LoginCommand{
		Origin:     getenv("AMA_API_SERVER"),
		ConfigPath: defaultConfigPath(getenv),
	}
	flags := flag.NewFlagSet("ama-runner login", flag.ContinueOnError)
	apiServer := flags.String("api-server", command.Origin, "AMA API server URL")
	configPath := flags.String("config", command.ConfigPath, "runner config file")
	if err := flags.Parse(args); err != nil {
		return LoginCommand{}, err
	}
	command.Origin = *apiServer
	command.ConfigPath = *configPath
	if strings.TrimSpace(command.Origin) == "" {
		return LoginCommand{}, fmt.Errorf("AMA API server URL is required")
	}
	parsed, err := url.Parse(command.Origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return LoginCommand{}, fmt.Errorf("AMA API server URL must be an absolute URL")
	}
	if strings.TrimSpace(command.ConfigPath) == "" {
		return LoginCommand{}, fmt.Errorf("runner config path is required")
	}
	return command, nil
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.Origin) == "" {
		return fmt.Errorf("AMA API server URL is required")
	}
	parsed, err := url.Parse(c.Origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("AMA API server URL must be an absolute URL")
	}
	if strings.TrimSpace(c.Token) == "" {
		return fmt.Errorf("AMA token is required")
	}
	if c.SandboxAdapter != processUnsafeAdapter {
		return fmt.Errorf("unsupported sandbox adapter %q", c.SandboxAdapter)
	}
	if !c.AllowUnsafeProcess {
		return fmt.Errorf("process-unsafe adapter requires AMA_RUNNER_ALLOW_UNSAFE_PROCESS=true or --allow-unsafe-process")
	}
	if strings.TrimSpace(c.WorkDir) == "" {
		return fmt.Errorf("workdir is required")
	}
	if strings.TrimSpace(c.StateDir) == "" {
		return fmt.Errorf("runner state directory is required")
	}
	if c.MaxConcurrent != 1 {
		return fmt.Errorf("first ama-runner implementation requires max-concurrent=1")
	}
	if c.LeaseDurationSeconds < 15 || c.LeaseDurationSeconds > 900 {
		return fmt.Errorf("lease duration must be between 15 and 900 seconds")
	}
	leaseDuration := time.Duration(c.LeaseDurationSeconds) * time.Second
	if c.HeartbeatInterval <= 0 || c.HeartbeatInterval >= leaseDuration {
		return fmt.Errorf("heartbeat interval must be greater than zero and less than lease duration")
	}
	if c.RenewInterval <= 0 || c.RenewInterval >= leaseDuration {
		return fmt.Errorf("renew interval must be greater than zero and less than lease duration")
	}
	if c.PollInterval <= 0 || c.CommandTimeout <= 0 || c.ShutdownGraceInterval <= 0 {
		return fmt.Errorf("poll, command timeout, and shutdown grace intervals must be greater than zero")
	}
	return nil
}

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
