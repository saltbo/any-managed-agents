package config

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"
)

type LoginCommand struct {
	Origin     string
	ConfigPath string
}

func LoadLoginCommand(args []string, getenv func(string) string) (LoginCommand, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	command := LoginCommand{
		Origin:     getenv("AMA_API_SERVER"),
		ConfigPath: defaultConfigPath(getenv),
	}
	flags := flag.NewFlagSet("ama-runner login", flag.ContinueOnError)
	apiServer := flags.String("api-server", command.Origin, "AMA API server URL")
	configPath := flags.String("config", command.ConfigPath, "runner config file")
	if err := flags.Parse(args); err != nil {
		return LoginCommand{}, err
	}
	command.Origin = *apiServer
	command.ConfigPath = *configPath
	if strings.TrimSpace(command.Origin) == "" {
		return LoginCommand{}, fmt.Errorf("AMA API server URL is required")
	}
	parsed, err := url.Parse(command.Origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return LoginCommand{}, fmt.Errorf("AMA API server URL must be an absolute URL")
	}
	if strings.TrimSpace(command.ConfigPath) == "" {
		return LoginCommand{}, fmt.Errorf("runner config path is required")
	}
	return command, nil
}
