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
	if len(args) > 0 && args[0] == "login" {
		return runLogin(ctx, args[1:], getenv, os.Stdout)
	}
	config, err := LoadConfig(args, getenv)
	if err != nil {
		return err
	}
	client := &ama.Client{
		Origin:      config.Origin,
		AccessToken: config.Token,
		HTTPClient:  &http.Client{Timeout: 30 * time.Second},
	}
	daemon := RunnerDaemon{
		Config:   config,
		Client:   client,
		Channels: sdkRunnerSessionChannelOpener{client: client},
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
}

func (o sdkRunnerSessionChannelOpener) OpenRunnerSessionChannel(
	ctx context.Context,
	runnerID string,
	leaseID string,
) (RunnerSessionChannel, error) {
	return o.client.OpenRunnerSessionChannel(ctx, runnerID, leaseID)
}
