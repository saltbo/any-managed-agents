package hostruntime

import (
	"strings"
	"testing"
)

func TestDetectAvailableRuntimesChecksCLIBinariesOnPath(t *testing.T) {
	tests := []struct {
		name     string
		binaries []string
		want     []string
	}{
		{"all installed", []string{"claude", "codex", "copilot"}, []string{"claude-code", "codex", "copilot"}},
		{"claude only", []string{"claude"}, []string{"claude-code"}},
		{"codex only", []string{"codex"}, []string{"codex"}},
		{"none installed", nil, []string{}},
		{"unrelated binaries ignored", []string{"git", "node"}, []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := (Service{}).DetectAvailable(lookPathFinding(tc.binaries...))
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Fatalf("expected runtimes %v, got %v", tc.want, got)
			}
		})
	}
}

func lookPathFinding(binaries ...string) func(string) (string, error) {
	found := map[string]bool{}
	for _, binary := range binaries {
		found[binary] = true
	}
	return func(binary string) (string, error) {
		if found[binary] {
			return "/usr/bin/" + binary, nil
		}
		return "", errNotFound{}
	}
}

type errNotFound struct{}

func (errNotFound) Error() string { return "not found" }
