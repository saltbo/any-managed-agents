package main

import (
	"encoding/json"
	"fmt"
	"io"
)

var (
	runnerVersion   = "dev"
	runnerCommit    = "unknown"
	runnerBuildDate = "unknown"
)

type runnerVersionInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"buildDate"`
}

func currentRunnerVersion() runnerVersionInfo {
	return runnerVersionInfo{
		Name:      "ama-runner",
		Version:   runnerVersion,
		Commit:    runnerCommit,
		BuildDate: runnerBuildDate,
	}
}

func runVersion(args []string, stdout io.Writer) error {
	info := currentRunnerVersion()
	if len(args) > 0 && args[0] == "--json" {
		encoder := json.NewEncoder(stdout)
		return encoder.Encode(info)
	}
	_, err := fmt.Fprintf(stdout, "%s %s (%s, built %s)\n", info.Name, info.Version, info.Commit, info.BuildDate)
	return err
}
