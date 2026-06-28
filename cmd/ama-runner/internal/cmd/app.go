package cmd

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
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/daemon"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Application struct {
	Args   []string
	Build  version.Info
	Getenv func(string) string
	Stdout io.Writer
}

func Run(args []string, build ...version.Info) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	app := Application{Args: args, Getenv: os.Getenv, Stdout: os.Stdout}
	if len(build) > 0 {
		app.Build = build[0]
	}
	return app.Run(ctx)
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
	tokens, err := NewTokenSource(config, baseHTTPClient)
	if err != nil {
		return err
	}
	authHTTPClient := &http.Client{
		Timeout: 30 * time.Second,
		Transport: authTransport{
			Base:   http.DefaultTransport,
			Tokens: tokens,
		},
	}
	client, err := ama.New(ama.ClientConfig{
		BaseURL:    config.Origin,
		ProjectID:  config.ProjectID,
		HTTPClient: authHTTPClient,
	})
	if err != nil {
		return err
	}
	process := daemon.Daemon{
		Config:   config,
		Client:   client,
		Channels: v1SessionChannelOpener{origin: config.Origin, projectID: config.ProjectID, tokens: tokens},
		Adapter:  sandbox.ProcessAdapter{CommandTimeout: config.CommandTimeout, ShutdownGraceInterval: config.ShutdownGraceInterval},
		Build:    a.buildInfo(),
	}
	return process.Start(ctx)
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
	client, err := ama.New(ama.ClientConfig{
		BaseURL:    command.Origin,
		HTTPClient: httpClient,
	})
	if err != nil {
		return err
	}
	health, err := client.System.Health(ctx)
	if err != nil {
		return err
	}
	if err := daemon.EnsureCompatibleHealth(health); err != nil {
		return err
	}
	authClient := auth.DeviceAuthClient{HTTPClient: httpClient}
	result, err := auth.LoginWithDeviceAuthorization(ctx, authClient, auth.DeviceLoginOptions{
		Origin:       command.Origin,
		Issuer:       stringValue(health.OidcIssuer),
		ClientID:     stringValue(health.RunnerClientId),
		Scopes:       stringValue(health.RunnerScopes),
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

func (a Application) buildInfo() version.Info {
	return a.Build.Normalized()
}

func (a Application) runVersion(args []string) error {
	info := a.buildInfo()
	stdout := a.stdout()
	if len(args) > 0 && args[0] == "--json" {
		encoder := json.NewEncoder(stdout)
		return encoder.Encode(info)
	}
	_, err := fmt.Fprintf(stdout, "%s %s (%s, built %s)\n", info.Name, info.Version, info.Commit, info.BuildDate)
	return err
}

type v1SessionChannelOpener struct {
	origin    string
	projectID string
	tokens    *TokenSource
}

// OpenRunnerChannel dials the per-runner relay channel
// (GET /api/v1/runners/{runnerId}/channel). One channel per runner carries every
// session it hosts, multiplexed by the per-frame sessionId, and outlives any lease.
func (o v1SessionChannelOpener) OpenRunnerChannel(
	ctx context.Context,
	runnerID string,
) (runnersession.Channel, error) {
	endpoint, err := v1RunnerChannelURL(o.origin, runnerID)
	if err != nil {
		return nil, err
	}
	return o.dial(ctx, endpoint)
}

func (o v1SessionChannelOpener) dial(ctx context.Context, endpoint string) (runnersession.Channel, error) {
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
	return &websocketSessionChannel{Conn: conn}, nil
}

type websocketSessionChannel struct {
	Conn *websocket.Conn
}

func (ch *websocketSessionChannel) ReadJSON(ctx context.Context, out any) error {
	_, data, err := ch.Conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (ch *websocketSessionChannel) WriteJSON(ctx context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ch.Conn.Write(ctx, websocket.MessageText, data)
}

func (ch *websocketSessionChannel) Close(statusCode int, reason string) error {
	return ch.Conn.Close(websocket.StatusCode(statusCode), reason)
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
