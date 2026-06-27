package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type SavedRunnerConfig struct {
	Origin        string `json:"apiServer"`
	AccessToken   string `json:"accessToken"`
	Token         string `json:"token,omitempty"`
	ProjectID     string `json:"projectId,omitempty"`
	EnvironmentID string `json:"environmentId,omitempty"`
	RunnerID      string `json:"runnerId,omitempty"`
	RefreshToken  string `json:"refreshToken,omitempty"`
	TokenType     string `json:"tokenType"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
	Scope         string `json:"scope,omitempty"`
}

func SaveRunnerConfig(path string, config SavedRunnerConfig) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("runner config path is required")
	}
	if strings.TrimSpace(config.AccessToken) == "" {
		return fmt.Errorf("runner access token is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func SaveRunnerID(path string, runnerID string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if strings.TrimSpace(runnerID) == "" {
		return fmt.Errorf("runner id is required")
	}
	config, err := LoadSavedRunnerConfig(path)
	if err != nil {
		return err
	}
	if config == nil {
		return nil
	}
	config.RunnerID = runnerID
	return SaveRunnerConfig(path, *config)
}

func LoadSavedRunnerConfig(path string) (*SavedRunnerConfig, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var config SavedRunnerConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	if config.AccessToken == "" {
		config.AccessToken = config.Token
	}
	if config.ExpiresAt != "" {
		expiresAt, err := time.Parse(time.RFC3339, config.ExpiresAt)
		if err != nil {
			return nil, err
		}
		if !expiresAt.After(time.Now()) && strings.TrimSpace(config.RefreshToken) == "" {
			return nil, fmt.Errorf("saved AMA runner token is expired; run ama-runner login again")
		}
	}
	return &config, nil
}
