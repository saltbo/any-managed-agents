package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/coder/websocket"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func main() {
	if err := run(os.Args[1:]); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runWithContext(ctx, args, os.Getenv)
}

func runWithContext(ctx context.Context, args []string, getenv func(string) string) error {
	if len(args) > 0 && (args[0] == "version" || args[0] == "--version" || args[0] == "-v") {
		return runVersion(args[1:], os.Stdout)
	}
	if len(args) > 0 && args[0] == "login" {
		return runLogin(ctx, args[1:], getenv, os.Stdout)
	}
	config, err := LoadConfig(args, getenv)
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
	client := &ama.Client{
		Origin:     config.Origin,
		ProjectID:  config.ProjectID,
		HTTPClient: authHTTPClient,
	}
	daemon := RunnerDaemon{
		Config:   config,
		Client:   client,
		Channels: sdkRunnerSessionChannelOpener{client: client, tokens: tokens},
		Adapter:  ProcessAdapter{CommandTimeout: config.CommandTimeout, ShutdownGraceInterval: config.ShutdownGraceInterval},
	}
	return daemon.Start(ctx)
}

func runLogin(ctx context.Context, args []string, getenv func(string) string, stdout io.Writer) error {
	command, err := LoadLoginCommand(args, getenv)
	if err != nil {
		return err
	}
	client := &ama.Client{
		Origin:     command.Origin,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
	health, err := client.CheckHealth(ctx)
	if err != nil {
		return err
	}
	authClient := DeviceAuthClient{HTTPClient: client.HTTPClient}
	result, err := LoginWithDeviceAuthorization(ctx, authClient, DeviceLoginOptions{
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

type sdkRunnerSessionChannelOpener struct {
	client *ama.Client
	tokens *RunnerTokenSource
}

func (o sdkRunnerSessionChannelOpener) OpenRunnerSessionChannel(
	ctx context.Context,
	runnerID string,
	leaseID string,
) (RunnerSessionChannel, error) {
	if o.tokens == nil {
		return o.client.OpenRunnerSessionChannel(ctx, runnerID, leaseID)
	}
	endpoint, err := o.client.RunnerSessionChannelURL(runnerID, leaseID)
	if err != nil {
		return nil, err
	}
	token, err := o.tokens.AccessToken(ctx)
	if err != nil {
		return nil, err
	}
	headers := http.Header{}
	if token != "" {
		headers.Set("authorization", "Bearer "+token)
	}
	if o.client.ProjectID != "" {
		headers.Set("x-ama-project-id", o.client.ProjectID)
	}
	conn, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		return nil, err
	}
	return &ama.RunnerSessionChannel{Conn: conn}, nil
}
