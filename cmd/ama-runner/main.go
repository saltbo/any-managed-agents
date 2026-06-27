package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runner"
)

func main() {
	if err := runner.Run(os.Args[1:]); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
