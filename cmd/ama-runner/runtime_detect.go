package main

// runtimeCLIBinaries maps each external session runtime to the CLI binary the
// runtime bridge providers resolve on the host (which claude / which codex /
// the copilot CLI). A runtime is advertised only when its binary is on PATH.
type runtimeCLIBinary struct {
	Runtime string
	Binary  string
}

func runtimeCLIBinaries() []runtimeCLIBinary {
	return []runtimeCLIBinary{
		{Runtime: "claude-code", Binary: "claude"},
		{Runtime: "codex", Binary: "codex"},
		{Runtime: "copilot", Binary: "copilot"},
	}
}

func detectAvailableRuntimes(lookPath func(string) (string, error)) []string {
	available := []string{}
	for _, cli := range runtimeCLIBinaries() {
		if _, err := lookPath(cli.Binary); err == nil {
			available = append(available, cli.Runtime)
		}
	}
	return available
}
