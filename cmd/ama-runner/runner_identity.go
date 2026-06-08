package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const runnerStateFileName = "runner-state.json"

type runnerState struct {
	MachineID string               `json:"machineId"`
	Bindings  []runnerStateBinding `json:"bindings"`
}

type runnerStateBinding struct {
	Key         string `json:"key"`
	Origin      string `json:"apiServer"`
	Project     string `json:"projectId,omitempty"`
	Environment string `json:"environmentId,omitempty"`
	MachineID   string `json:"machineId"`
	Hostname    string `json:"hostname"`
	RunnerID    string `json:"runnerId"`
}

func runnerDisplayName() string {
	hostname, err := os.Hostname()
	if err == nil && strings.TrimSpace(hostname) != "" {
		return hostname
	}
	return "ama-runner"
}

func ensureMachineID(config Config) (string, error) {
	state, err := loadRunnerState(runnerStatePath(config))
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(state.MachineID) != "" {
		return state.MachineID, nil
	}
	machineID, err := newMachineID()
	if err != nil {
		return "", err
	}
	state.MachineID = machineID
	if err := saveRunnerState(runnerStatePath(config), state); err != nil {
		return "", err
	}
	return machineID, nil
}

func newMachineID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return "machine_" + hex.EncodeToString(bytes[:]), nil
}

func runnerIdentityKey(config Config, machineID string) string {
	parts := []string{
		strings.TrimRight(config.Origin, "/"),
		config.ProjectID,
		config.EnvironmentID,
		machineID,
	}
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(hash[:])
}

func runnerStatePath(config Config) string {
	return filepath.Join(config.StateDir, runnerStateFileName)
}

func loadStoredRunnerID(config Config) (string, error) {
	machineID, err := ensureMachineID(config)
	if err != nil {
		return "", err
	}
	state, err := loadRunnerState(runnerStatePath(config))
	if err != nil {
		return "", err
	}
	key := runnerIdentityKey(config, machineID)
	for _, binding := range state.Bindings {
		if binding.Key == key {
			return binding.RunnerID, nil
		}
	}
	return "", nil
}

func storeRunnerID(config Config, runnerID string) error {
	if strings.TrimSpace(runnerID) == "" {
		return fmt.Errorf("runner id is required")
	}
	machineID, err := ensureMachineID(config)
	if err != nil {
		return err
	}
	path := runnerStatePath(config)
	state, err := loadRunnerState(path)
	if err != nil {
		return err
	}
	key := runnerIdentityKey(config, machineID)
	state.MachineID = machineID
	binding := runnerStateBinding{
		Key:         key,
		Origin:      strings.TrimRight(config.Origin, "/"),
		Project:     config.ProjectID,
		Environment: config.EnvironmentID,
		MachineID:   machineID,
		Hostname:    runnerDisplayName(),
		RunnerID:    runnerID,
	}
	replaced := false
	for index := range state.Bindings {
		if state.Bindings[index].Key == key {
			state.Bindings[index] = binding
			replaced = true
			break
		}
	}
	if !replaced {
		state.Bindings = append(state.Bindings, binding)
	}
	sort.Slice(state.Bindings, func(left, right int) bool {
		return state.Bindings[left].Key < state.Bindings[right].Key
	})
	return saveRunnerState(path, state)
}

func loadRunnerState(path string) (runnerState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return runnerState{}, nil
		}
		return runnerState{}, err
	}
	var state runnerState
	if err := json.Unmarshal(data, &state); err != nil {
		return runnerState{}, err
	}
	return state, nil
}

func saveRunnerState(path string, state runnerState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func runnerCapabilities() []string {
	return []string{
		"sandbox.exec",
		"ama",
		"codex",
		"claude-code",
		"copilot",
		"runtime-provider-model:ama:workers-ai:@cf/moonshotai/kimi-k2.6",
		"runtime-provider-model:codex:*:gpt-5.3-codex",
		"runtime-provider-model:claude-code:*:claude-sonnet-4-6",
		"runtime-provider-model:copilot:*:copilot-cli",
	}
}
