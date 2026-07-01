package cmd

import (
	"io"

	runnercli "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/cli"
	"github.com/spf13/cobra"
)

func configCommand(stdout io.Writer) *cobra.Command {
	command := &cobra.Command{
		Use:           "config",
		Short:         "Manage local runner configuration",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	command.AddCommand(configGetCommand(stdout), configListCommand(stdout), configSetCommand(stdout))
	return command
}

func configGetCommand(stdout io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:           "get <key>",
		Short:         "Print a local runner config value",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			return runnercli.RunConfigGet(command, args[0], stdout)
		},
	}
}

func configListCommand(stdout io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:           "list",
		Short:         "List local runner config values",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			return runnercli.RunConfigList(command, stdout)
		},
	}
}

func configSetCommand(stdout io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:           "set <key> <value>",
		Short:         "Set a local runner config value",
		Args:          cobra.ExactArgs(2),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			return runnercli.RunConfigSet(command, args[0], args[1], stdout)
		},
	}
}
