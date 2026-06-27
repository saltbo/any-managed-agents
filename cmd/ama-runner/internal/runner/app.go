package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/auth"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/controlplane"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Application struct {
	Args   []string
	Getenv func(string) string
	Stdout io.Writer
}

func Run(args []string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return Application{Args: args, Getenv: os.Getenv, Stdout: os.Stdout}.Run(ctx)
}

func (a Application) Run(ctx context.Context) error {
	args := a.Args
	getenv := a.getenv()
	if len(args) > 0 && (args[0] == "version" || args[0] == "--version" || args[0] == "-v") {
		return a.runVersion(args[1:])
	}
	if len(args) > 0 && args[0] == "login" {
		return a.runLogin(ctx, args[1:])
	}
	config, err := runnerconfig.LoadConfig(args, getenv)
	if err != nil {
		return err
	}
	baseHTTPClient := &http.Client{Timeout: 30 * time.Second}
	tokens, err := NewRunnerTokenSource(config, baseHTTPClient)
	if err != nil {
		return err
	}
	authHTTPClient := &http.Client{
		Timeout: 30 * time.Second,
		Transport: runnerAuthTransport{
			Base:   http.DefaultTransport,
			Tokens: tokens,
		},
	}
	client := &controlplane.Client{
		Origin:     config.Origin,
		ProjectID:  config.ProjectID,
		HTTPClient: authHTTPClient,
	}
	daemon := RunnerDaemon{
		Config:   config,
		Client:   client,
		Channels: v1RunnerSessionChannelOpener{origin: config.Origin, projectID: config.ProjectID, tokens: tokens},
		Adapter:  sandbox.ProcessAdapter{CommandTimeout: config.CommandTimeout, ShutdownGraceInterval: config.ShutdownGraceInterval},
	}
	return daemon.Start(ctx)
}

func (a Application) getenv() func(string) string {
	if a.Getenv != nil {
		return a.Getenv
	}
	return os.Getenv
}

func (a Application) stdout() io.Writer {
	if a.Stdout != nil {
		return a.Stdout
	}
	return io.Discard
}

func (a Application) runLogin(ctx context.Context, args []string) error {
	stdout := a.stdout()
	command, err := runnerconfig.LoadLoginCommand(args, a.getenv())
	if err != nil {
		return err
	}
	httpClient := &http.Client{Timeout: 30 * time.Second}
	client := &controlplane.Client{
		Origin:     command.Origin,
		HTTPClient: httpClient,
	}
	health, err := client.CheckHealth(ctx)
	if err != nil {
		return err
	}
	authClient := auth.DeviceAuthClient{HTTPClient: httpClient}
	result, err := auth.LoginWithDeviceAuthorization(ctx, authClient, auth.DeviceLoginOptions{
		Origin:       command.Origin,
		Issuer:       health.OIDCIssuer,
		ClientID:     health.RunnerClientID,
		Scopes:       health.RunnerScopes,
		ConfigPath:   command.ConfigPath,
		Output:       stdout,
		PollInterval: time.Second,
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "ama-runner authenticated for %s; token saved to %s\n", result.Origin, result.ConfigPath)
	return nil
}

var (
	runnerVersion   = "dev"
	runnerCommit    = "unknown"
	runnerBuildDate = "unknown"
)

type runnerVersionInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"buildDate"`
}

func currentRunnerVersion() runnerVersionInfo {
	return runnerVersionInfo{
		Name:      "ama-runner",
		Version:   runnerVersion,
		Commit:    runnerCommit,
		BuildDate: runnerBuildDate,
	}
}

func (a Application) runVersion(args []string) error {
	info := currentRunnerVersion()
	stdout := a.stdout()
	if len(args) > 0 && args[0] == "--json" {
		encoder := json.NewEncoder(stdout)
		return encoder.Encode(info)
	}
	_, err := fmt.Fprintf(stdout, "%s %s (%s, built %s)\n", info.Name, info.Version, info.Commit, info.BuildDate)
	return err
}

type v1RunnerSessionChannelOpener struct {
	origin    string
	projectID string
	tokens    *RunnerTokenSource
}

// OpenRunnerChannel dials the per-runner relay channel
// (GET /api/v1/runners/{runnerId}/channel). One channel per runner carries every
// session it hosts, multiplexed by the per-frame sessionId, and outlives any lease.
func (o v1RunnerSessionChannelOpener) OpenRunnerChannel(
	ctx context.Context,
	runnerID string,
) (RunnerSessionChannel, error) {
	endpoint, err := v1RunnerChannelURL(o.origin, runnerID)
	if err != nil {
		return nil, err
	}
	return o.dial(ctx, endpoint)
}

func (o v1RunnerSessionChannelOpener) dial(ctx context.Context, endpoint string) (RunnerSessionChannel, error) {
	headers := http.Header{}
	if o.tokens != nil {
		token, err := o.tokens.AccessToken(ctx)
		if err != nil {
			return nil, err
		}
		if token != "" {
			headers.Set("authorization", "Bearer "+token)
		}
	}
	if o.projectID != "" {
		headers.Set("x-ama-project-id", o.projectID)
	}
	conn, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		return nil, err
	}
	return &ama.RunnerSessionChannel{Conn: conn}, nil
}

// v1WebSocketBaseURL turns the AMA origin into its ws/wss base (scheme flipped,
// path/query/fragment stripped) - the shared root for every v1 channel URL.
func v1WebSocketBaseURL(origin string) (string, error) {
	if strings.TrimSpace(origin) == "" {
		return "", fmt.Errorf("AMA origin is required")
	}
	parsed, err := url.Parse(strings.TrimRight(origin, "/"))
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	default:
		return "", fmt.Errorf("AMA origin must use http or https")
	}
	parsed.Path = "/"
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

// v1RunnerChannelURL builds the per-runner relay channel URL (CLI runtimes). One
// channel per runner multiplexes every CLI session it hosts (the sessionId rides
// per-frame), so it outlives any single lease and serves a completed session's
// history while the runner is online.
func v1RunnerChannelURL(origin string, runnerID string) (string, error) {
	base, err := v1WebSocketBaseURL(origin)
	if err != nil {
		return "", err
	}
	return base + "/api/v1/runners/" + url.PathEscape(runnerID) + "/channel", nil
}
