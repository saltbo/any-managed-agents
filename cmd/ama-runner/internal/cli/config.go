package cli

import (
	"fmt"
	"io"
	"os"
	"strings"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/spf13/cobra"
)

func RunConfigGet(command *cobra.Command, key string, stdout io.Writer) error {
	values, err := loadLocalConfig(command)
	if err != nil {
		return err
	}
	value, ok := values[key]
	if !ok {
		return fmt.Errorf("config key %q is not set", key)
	}
	fmt.Fprintln(stdout, value)
	return nil
}

func RunConfigList(command *cobra.Command, stdout io.Writer) error {
	values, err := loadLocalConfig(command)
	if err != nil {
		return err
	}
	for _, key := range runnerconfig.LocalConfigKeys() {
		if value, ok := values[key]; ok {
			fmt.Fprintf(stdout, "%s=%v\n", key, value)
		}
	}
	return nil
}

func RunConfigSet(command *cobra.Command, key string, value string, stdout io.Writer) error {
	path, err := localConfigPath(command)
	if err != nil {
		return err
	}
	if err := runnerconfig.SaveLocalConfigValue(path, key, value); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "%s=%s\n", key, value)
	return nil
}

func loadLocalConfig(command *cobra.Command) (map[string]any, error) {
	path, err := localConfigPath(command)
	if err != nil {
		return nil, err
	}
	return runnerconfig.LoadLocalConfig(path)
}

func localConfigPath(command *cobra.Command) (string, error) {
	flag := command.Flag("config")
	if flag != nil && flag.Changed {
		return flag.Value.String(), nil
	}
	if value := strings.TrimSpace(os.Getenv("AMA_RUNNER_CONFIG")); value != "" {
		return value, nil
	}
	return runnerconfig.DefaultConfigPath(), nil
}
