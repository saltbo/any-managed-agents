package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	runnercmd "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/cmd"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
)

var (
	runnerVersion   = "dev"
	runnerCommit    = "unknown"
	runnerBuildDate = "unknown"
)

func main() {
	build := version.Info{
		Version:   runnerVersion,
		Commit:    runnerCommit,
		BuildDate: runnerBuildDate,
	}
	if err := runnercmd.Run(os.Args[1:], build); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
