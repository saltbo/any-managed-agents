package cmd

import (
	"context"

	runnercli "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/cli"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	"github.com/spf13/cobra"
)

func runDaemon(ctx context.Context, command *cobra.Command, build version.Info) error {
	return runnercli.RunDaemon(ctx, command, build)
}
