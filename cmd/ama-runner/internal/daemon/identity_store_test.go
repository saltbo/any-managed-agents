package daemon

import (
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIdentityStoreUsesStateDirAndMachineID(t *testing.T) {
	stateDir := t.TempDir()
	workDir := t.TempDir()
	config := runnerconfig.Config{
		Origin:        "https://ama.example.test",
		ProjectID:     "project_1",
		EnvironmentID: "env_1",
		StateDir:      stateDir,
		WorkDir:       workDir,
	}
	store := IdentityStore{Config: config}

	machineID, err := store.EnsureMachineID()
	if err != nil {
		t.Fatalf("expected machine id, got %v", err)
	}
	if !strings.HasPrefix(machineID, "machine_") {
		t.Fatalf("unexpected machine id %q", machineID)
	}
	if err := store.StoreRunnerID("runner_1"); err != nil {
		t.Fatalf("expected runner id store success, got %v", err)
	}
	loadedRunnerID, err := store.LoadRunnerID()
	if err != nil {
		t.Fatalf("expected runner id load success, got %v", err)
	}
	if loadedRunnerID != "runner_1" {
		t.Fatalf("expected stored runner id, got %q", loadedRunnerID)
	}
	reloadedMachineID, err := store.EnsureMachineID()
	if err != nil {
		t.Fatalf("expected machine id reload success, got %v", err)
	}
	if reloadedMachineID != machineID {
		t.Fatalf("expected stable machine id %q, got %q", machineID, reloadedMachineID)
	}
	if _, err := os.Stat(filepath.Join(workDir, stateFileName)); !os.IsNotExist(err) {
		t.Fatalf("runner state should not be written to workdir, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, stateFileName)); err != nil {
		t.Fatalf("expected runner state in state dir, got %v", err)
	}
}
