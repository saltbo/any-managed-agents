package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/auth"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/daemon"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

const tokenRefreshSkew = 2 * time.Minute

type TokenSource struct {
	Config     runnerconfig.Config
	HTTPClient *http.Client

	mu     sync.Mutex
	saved  *runnerconfig.SavedRunnerConfig
	client auth.DeviceAuthClient
}

func NewTokenSource(config runnerconfig.Config, httpClient *http.Client) (*TokenSource, error) {
	source := &TokenSource{
		Config:     config,
		HTTPClient: httpClient,
		client:     auth.DeviceAuthClient{HTTPClient: httpClient},
	}
	if !config.TokenExplicit {
		saved, err := runnerconfig.LoadSavedRunnerConfig(config.ConfigPath)
		if err != nil {
			return nil, err
		}
		source.saved = saved
	}
	return source, nil
}

func (s *TokenSource) AccessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		if strings.TrimSpace(s.Config.Token) == "" {
			return "", fmt.Errorf("AMA token is required")
		}
		return s.Config.Token, nil
	}
	if !s.needsRefresh(*s.saved) {
		if strings.TrimSpace(s.saved.AccessToken) == "" {
			return "", fmt.Errorf("saved AMA runner token is missing an access token")
		}
		return s.saved.AccessToken, nil
	}
	return s.refreshLocked(ctx)
}

func (s *TokenSource) ForceRefresh(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		return s.Config.Token, nil
	}
	return s.refreshLocked(ctx)
}

func (s *TokenSource) CanRefresh() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saved != nil && strings.TrimSpace(s.saved.RefreshToken) != ""
}

func (s *TokenSource) refreshLocked(ctx context.Context) (string, error) {
	if s.saved == nil {
		return s.Config.Token, nil
	}
	if strings.TrimSpace(s.saved.RefreshToken) == "" {
		return "", fmt.Errorf("saved AMA runner token is expired; run ama-runner login again")
	}
	healthClient, err := ama.New(ama.ClientConfig{
		BaseURL:    s.Config.Origin,
		HTTPClient: s.HTTPClient,
	})
	if err != nil {
		return "", err
	}
	health, err := healthClient.System.Health(ctx)
	if err != nil {
		return "", err
	}
	if err := daemon.EnsureCompatibleHealth(health); err != nil {
		return "", err
	}
	metadata, err := s.client.Discover(ctx, stringValue(health.OidcIssuer))
	if err != nil {
		return "", err
	}
	token, err := s.client.RefreshToken(ctx, metadata.TokenEndpoint, stringValue(health.RunnerClientId), s.saved.RefreshToken)
	if err != nil {
		return "", err
	}
	next := *s.saved
	next.Origin = strings.TrimRight(s.Config.Origin, "/")
	next.AccessToken = token.AccessToken
	next.Token = ""
	if strings.TrimSpace(token.RefreshToken) != "" {
		next.RefreshToken = token.RefreshToken
	}
	next.TokenType = token.TokenType
	next.ExpiresAt = auth.ExpiresAt(token.ExpiresIn)
	if strings.TrimSpace(token.Scope) != "" {
		next.Scope = token.Scope
	}
	if err := runnerconfig.SaveRunnerConfig(s.Config.ConfigPath, next); err != nil {
		return "", err
	}
	s.saved = &next
	return next.AccessToken, nil
}

func (s *TokenSource) needsRefresh(config runnerconfig.SavedRunnerConfig) bool {
	if strings.TrimSpace(config.AccessToken) == "" {
		return true
	}
	if strings.TrimSpace(config.ExpiresAt) == "" {
		return false
	}
	expiresAt, err := time.Parse(time.RFC3339, config.ExpiresAt)
	if err != nil {
		return true
	}
	return !expiresAt.After(time.Now().Add(tokenRefreshSkew))
}

type authTransport struct {
	Base   http.RoundTripper
	Tokens *TokenSource
}

func (t authTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}
	authorized, err := t.authorizedRequest(request, false)
	if err != nil {
		return nil, err
	}
	response, err := base.RoundTrip(authorized)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusUnauthorized || t.Tokens == nil || !t.Tokens.CanRefresh() {
		return response, nil
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	retry, err := t.authorizedRequest(request, true)
	if err != nil {
		return nil, err
	}
	return base.RoundTrip(retry)
}

func (t authTransport) authorizedRequest(request *http.Request, forceRefresh bool) (*http.Request, error) {
	if t.Tokens == nil {
		return request, nil
	}
	var (
		token string
		err   error
	)
	if forceRefresh {
		token, err = t.Tokens.ForceRefresh(request.Context())
	} else {
		token, err = t.Tokens.AccessToken(request.Context())
	}
	if err != nil {
		return nil, err
	}
	next := request.Clone(request.Context())
	if request.Body != nil && request.GetBody != nil {
		body, err := request.GetBody()
		if err != nil {
			return nil, err
		}
		next.Body = body
	}
	if strings.TrimSpace(token) != "" {
		next.Header.Set("authorization", "Bearer "+token)
	}
	return next, nil
}
