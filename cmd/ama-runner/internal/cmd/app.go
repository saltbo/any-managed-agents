package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/auth"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/daemon"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
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
	client, err := ama.NewRunner(ama.ClientConfig{
		BaseURL:             config.Origin,
		AccessTokenProvider: tokens.AccessToken,
		ProjectID:           config.ProjectID,
		HTTPClient:          authHTTPClient,
	})
	if err != nil {
		return err
	}
	process := daemon.Daemon{
		Config:   config,
		Client:   client,
		Channels: client.Runners,
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
