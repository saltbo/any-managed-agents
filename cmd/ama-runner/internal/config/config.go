package config

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

const ProcessUnsafeAdapter = "process-unsafe"
const processUnsafeAdapter = ProcessUnsafeAdapter

type Config struct {
	ConfigPath            string        `json:"-"`
	TokenExplicit         bool          `json:"-"`
	Origin                string        `json:"apiServer"`
	Token                 string        `json:"token"`
	ProjectID             string        `json:"projectId"`
	EnvironmentID         string        `json:"environmentId"`
	SandboxAdapter        string        `json:"sandboxAdapter"`
	AllowUnsafeProcess    bool          `json:"allowUnsafeProcess"`
	StateDir              string        `json:"stateDir"`
	WorkDir               string        `json:"workDir"`
	MaxConcurrent         int           `json:"maxConcurrent"`
	HeartbeatInterval     time.Duration `json:"heartbeatInterval"`
	LeaseDurationSeconds  int           `json:"leaseDurationSeconds"`
	RenewInterval         time.Duration `json:"renewInterval"`
	CommandTimeout        time.Duration `json:"commandTimeout"`
	ShutdownGraceInterval time.Duration `json:"shutdownGraceInterval"`
	// MaxSessionDuration caps a single runtime session; 0 disables the cap.
	MaxSessionDuration time.Duration `json:"maxSessionDuration"`
}

func LoadConfig(args []string, getenv func(string) string) (Config, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	explicitEnvToken := strings.TrimSpace(getenv("AMA_TOKEN")) != ""
	envAllowUnsafeProcess, err := parseEnvBool(getenv, "AMA_RUNNER_ALLOW_UNSAFE_PROCESS", false)
	if err != nil {
		return Config{}, err
	}
	envMaxConcurrent, err := parseEnvInt(getenv, "AMA_RUNNER_MAX_CONCURRENT", 5)
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
	envMaxSessionDuration, err := parseEnvDuration(getenv, "AMA_RUNNER_MAX_SESSION_DURATION", 2*time.Hour)
	if err != nil {
		return Config{}, err
	}
	defaultConfigFile := defaultConfigPath(getenv)
	config := Config{
		ConfigPath:            defaultConfigFile,
		TokenExplicit:         explicitEnvToken,
		Origin:                getenv("AMA_API_SERVER"),
		Token:                 getenv("AMA_TOKEN"),
		ProjectID:             getenv("AMA_PROJECT_ID"),
		EnvironmentID:         getenv("AMA_ENVIRONMENT_ID"),
		SandboxAdapter:        envOr(getenv, "AMA_RUNNER_SANDBOX_ADAPTER", processUnsafeAdapter),
		AllowUnsafeProcess:    envAllowUnsafeProcess,
		StateDir:              envOr(getenv, "AMA_RUNNER_STATE_DIR", defaultStateDir(getenv)),
		WorkDir:               envOr(getenv, "AMA_RUNNER_WORKDIR", defaultWorkDir(getenv)),
		MaxConcurrent:         envMaxConcurrent,
		HeartbeatInterval:     envHeartbeatInterval,
		LeaseDurationSeconds:  envLeaseDurationSeconds,
		RenewInterval:         envRenewInterval,
		CommandTimeout:        envCommandTimeout,
		ShutdownGraceInterval: envShutdownGraceInterval,
		MaxSessionDuration:    envMaxSessionDuration,
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
	heartbeatInterval := flags.Duration("heartbeat-interval", config.HeartbeatInterval, "runner heartbeat interval")
	leaseSeconds := flags.Int("lease-seconds", config.LeaseDurationSeconds, "lease duration in seconds")
	renewInterval := flags.Duration("renew-interval", config.RenewInterval, "lease renew interval")
	commandTimeout := flags.Duration("command-timeout", config.CommandTimeout, "per-command timeout")
	shutdownGrace := flags.Duration("shutdown-grace", config.ShutdownGraceInterval, "process shutdown grace interval")
	maxSessionDuration := flags.Duration("max-session-duration", config.MaxSessionDuration, "max duration for a single runtime session (0 disables)")
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
		config.TokenExplicit = true
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
	if visited["max-session-duration"] {
		config.MaxSessionDuration = *maxSessionDuration
	}

	saved, err := LoadSavedRunnerConfig(config.ConfigPath)
	if err != nil {
		return Config{}, err
	}
	if saved != nil {
		if strings.TrimSpace(config.Origin) == "" {
			config.Origin = saved.Origin
		}
		if !config.TokenExplicit && strings.TrimSpace(config.Token) == "" && config.Origin == saved.Origin {
			config.Token = saved.AccessToken
		}
		if strings.TrimSpace(config.ProjectID) == "" && config.Origin == saved.Origin {
			config.ProjectID = saved.ProjectID
		}
		if strings.TrimSpace(config.EnvironmentID) == "" && config.Origin == saved.Origin {
			config.EnvironmentID = saved.EnvironmentID
		}
	}

	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
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
	if c.MaxConcurrent < 1 {
		return fmt.Errorf("max concurrent leases must be greater than zero")
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
	if c.CommandTimeout <= 0 || c.ShutdownGraceInterval <= 0 {
		return fmt.Errorf("command timeout and shutdown grace intervals must be greater than zero")
	}
	if c.MaxSessionDuration < 0 {
		return fmt.Errorf("max session duration must be zero (disabled) or greater")
	}
	return nil
}
