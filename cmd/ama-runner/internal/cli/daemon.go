package cli

import (
	"context"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/daemon"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	"github.com/spf13/cobra"
)

func RunDaemon(ctx context.Context, command *cobra.Command, build version.Info) error {
	config, err := LoadRunConfig(command)
	if err != nil {
		return err
	}
	process, err := daemon.New(config, build)
	if err != nil {
		return err
	}
	return process.Start(ctx)
}
