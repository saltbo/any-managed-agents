package cli

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
)

func RunVersion(info version.Info, stdout io.Writer, jsonOutput bool) error {
	if jsonOutput {
		encoder := json.NewEncoder(stdout)
		return encoder.Encode(info)
	}
	_, err := fmt.Fprintf(stdout, "%s %s (%s, built %s)\n", info.Name, info.Version, info.Commit, info.BuildDate)
	return err
}
