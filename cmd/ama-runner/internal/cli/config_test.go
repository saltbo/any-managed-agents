package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestRunConfigCommandsUseSelectedConfigPath(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	t.Setenv("AMA_RUNNER_CONFIG", configPath)
	command := configTestCommand(t)
	var output bytes.Buffer

	if err := RunConfigSet(command, "apiServer", "https://ama.example.test", &output); err != nil {
		t.Fatalf("expected set, got %v", err)
	}
	if !strings.Contains(output.String(), "apiServer=https://ama.example.test") {
		t.Fatalf("unexpected set output: %s", output.String())
	}

	output.Reset()
	if err := RunConfigGet(command, "apiServer", &output); err != nil {
		t.Fatalf("expected get, got %v", err)
	}
	if strings.TrimSpace(output.String()) != "https://ama.example.test" {
		t.Fatalf("unexpected get output: %s", output.String())
	}

	output.Reset()
	if err := RunConfigList(command, &output); err != nil {
		t.Fatalf("expected list, got %v", err)
	}
	if !strings.Contains(output.String(), "apiServer=https://ama.example.test") {
		t.Fatalf("unexpected list output: %s", output.String())
	}
}

func TestRunConfigCommandsRespectConfigFlag(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	command := configTestCommand(t, "--config", configPath)
	var output bytes.Buffer

	if err := RunConfigSet(command, "maxConcurrent", "7", &output); err != nil {
		t.Fatalf("expected set, got %v", err)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"maxConcurrent": 7`) {
		t.Fatalf("expected flag config path to be written, got %s", string(data))
	}
}

func TestRunConfigCommandsReturnErrors(t *testing.T) {
	command := configTestCommand(t, "--config", filepath.Join(t.TempDir(), "runner.json"))
	var output bytes.Buffer
	if err := RunConfigGet(command, "missing", &output); err == nil || !strings.Contains(err.Error(), "not set") {
		t.Fatalf("expected missing key error, got %v", err)
	}
	if err := RunConfigSet(command, "unknown", "value", &output); err == nil || !strings.Contains(err.Error(), "unsupported config key") {
		t.Fatalf("expected unsupported key error, got %v", err)
	}
}

func configTestCommand(t *testing.T, args ...string) *cobra.Command {
	t.Helper()
	command := &cobra.Command{}
	RegisterGlobalFlags(command)
	if err := command.ParseFlags(args); err != nil {
		t.Fatal(err)
	}
	return command
}
