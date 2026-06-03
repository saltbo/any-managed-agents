package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"

type DeviceAuthClient struct {
	HTTPClient *http.Client
}

type DeviceLoginOptions struct {
	Origin       string
	Issuer       string
	ClientID     string
	Scopes       string
	ConfigPath   string
	Output       io.Writer
	PollInterval time.Duration
}

type DeviceLoginResult struct {
	Origin     string
	ConfigPath string
}

type oidcMetadata struct {
	Issuer                      string `json:"issuer"`
	DeviceAuthorizationEndpoint string `json:"device_authorization_endpoint"`
	TokenEndpoint               string `json:"token_endpoint"`
}

type deviceAuthorizationResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

type SavedRunnerConfig struct {
	Origin       string `json:"origin"`
	AccessToken  string `json:"accessToken"`
	Token        string `json:"token,omitempty"`
	RefreshToken string `json:"refreshToken,omitempty"`
	TokenType    string `json:"tokenType"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

func LoginWithDeviceAuthorization(
	ctx context.Context,
	client DeviceAuthClient,
	options DeviceLoginOptions,
) (DeviceLoginResult, error) {
	if strings.TrimSpace(options.Issuer) == "" || strings.TrimSpace(options.ClientID) == "" {
		return DeviceLoginResult{}, fmt.Errorf("AMA control plane did not publish runner OIDC metadata")
	}
	metadata, err := client.Discover(ctx, options.Issuer)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	device, err := client.StartDeviceAuthorization(ctx, metadata.DeviceAuthorizationEndpoint, options.ClientID, options.Scopes)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	output := options.Output
	if output == nil {
		output = io.Discard
	}
	printDeviceInstructions(output, device)
	token, err := client.PollDeviceToken(ctx, metadata.TokenEndpoint, options.ClientID, device, options.PollInterval)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	if err := SaveRunnerConfig(options.ConfigPath, SavedRunnerConfig{
		Origin:       strings.TrimRight(options.Origin, "/"),
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenType:    token.TokenType,
		ExpiresAt:    expiresAt(token.ExpiresIn),
		Scope:        token.Scope,
	}); err != nil {
		return DeviceLoginResult{}, err
	}
	return DeviceLoginResult{Origin: strings.TrimRight(options.Origin, "/"), ConfigPath: options.ConfigPath}, nil
}

func (c DeviceAuthClient) Discover(ctx context.Context, issuer string) (oidcMetadata, error) {
	endpoint := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"
	var metadata oidcMetadata
	if err := c.getJSON(ctx, endpoint, &metadata); err != nil {
		return oidcMetadata{}, err
	}
	if metadata.DeviceAuthorizationEndpoint == "" || metadata.TokenEndpoint == "" {
		return oidcMetadata{}, fmt.Errorf("OIDC issuer metadata does not include device and token endpoints")
	}
	return metadata, nil
}

func (c DeviceAuthClient) StartDeviceAuthorization(
	ctx context.Context,
	endpoint string,
	clientID string,
	scopes string,
) (deviceAuthorizationResponse, error) {
	values := url.Values{}
	values.Set("client_id", clientID)
	if strings.TrimSpace(scopes) != "" {
		values.Set("scope", scopes)
	}
	var response deviceAuthorizationResponse
	if err := c.postForm(ctx, endpoint, values, &response); err != nil {
		return deviceAuthorizationResponse{}, err
	}
	if response.DeviceCode == "" || response.UserCode == "" || response.VerificationURI == "" || response.ExpiresIn <= 0 {
		return deviceAuthorizationResponse{}, fmt.Errorf("OIDC device authorization response is incomplete")
	}
	return response, nil
}

func (c DeviceAuthClient) PollDeviceToken(
	ctx context.Context,
	endpoint string,
	clientID string,
	device deviceAuthorizationResponse,
	fallbackInterval time.Duration,
) (tokenResponse, error) {
	interval := time.Duration(device.Interval) * time.Second
	if interval <= 0 {
		interval = fallbackInterval
	}
	if interval <= 0 {
		interval = 5 * time.Second
	}
	expires := time.Now().Add(time.Duration(device.ExpiresIn) * time.Second)
	for {
		if time.Now().After(expires) {
			return tokenResponse{}, fmt.Errorf("OIDC device authorization expired")
		}
		select {
		case <-ctx.Done():
			return tokenResponse{}, ctx.Err()
		case <-time.After(interval):
		}

		values := url.Values{}
		values.Set("grant_type", deviceGrantType)
		values.Set("device_code", device.DeviceCode)
		values.Set("client_id", clientID)
		var token tokenResponse
		err := c.postForm(ctx, endpoint, values, &token)
		if err == nil && token.Error == "" {
			if token.AccessToken == "" {
				return tokenResponse{}, fmt.Errorf("OIDC token response did not include an access token")
			}
			if token.TokenType == "" {
				token.TokenType = "Bearer"
			}
			return token, nil
		}
		var pollErr deviceTokenError
		if err != nil && !errors.As(err, &pollErr) {
			return tokenResponse{}, err
		}
		if token.Error == "" {
			token.Error = pollErr.Code
			token.Description = pollErr.Description
		}
		switch token.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval += 5 * time.Second
			continue
		case "expired_token":
			return tokenResponse{}, fmt.Errorf("OIDC device authorization expired")
		case "access_denied":
			return tokenResponse{}, fmt.Errorf("OIDC device authorization was denied")
		default:
			return tokenResponse{}, fmt.Errorf("OIDC token polling failed: %s", errorDescription(token))
		}
	}
}

func (c DeviceAuthClient) getJSON(ctx context.Context, endpoint string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	return c.do(request, out)
}

func (c DeviceAuthClient) postForm(ctx context.Context, endpoint string, values url.Values, out any) error {
	if err := c.postFormOnly(ctx, endpoint, values, out); !isUnsupportedMediaType(err) {
		return err
	}
	return c.postJSON(ctx, endpoint, formValuesJSON(values), out)
}

func (c DeviceAuthClient) postFormOnly(ctx context.Context, endpoint string, values url.Values, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/x-www-form-urlencoded")
	return c.do(request, out)
}

func (c DeviceAuthClient) postJSON(ctx context.Context, endpoint string, values map[string]string, out any) error {
	data, err := json.Marshal(values)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/json")
	return c.do(request, out)
}

func (c DeviceAuthClient) do(request *http.Request, out any) error {
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		var tokenErr tokenResponse
		if json.Unmarshal(body, &tokenErr) == nil && tokenErr.Error != "" {
			return deviceTokenError{Code: tokenErr.Error, Description: tokenErr.Description}
		}
		return oidcStatusError{Path: request.URL.Path, Status: response.StatusCode}
	}
	if err := json.Unmarshal(body, out); err != nil {
		return err
	}
	return nil
}

type oidcStatusError struct {
	Path   string
	Status int
}

func (e oidcStatusError) Error() string {
	return fmt.Sprintf("OIDC %s failed with status %d", e.Path, e.Status)
}

func isUnsupportedMediaType(err error) bool {
	var statusErr oidcStatusError
	return errors.As(err, &statusErr) && statusErr.Status == http.StatusUnsupportedMediaType
}

func formValuesJSON(values url.Values) map[string]string {
	result := map[string]string{}
	for key := range values {
		result[key] = values.Get(key)
	}
	return result
}

type deviceTokenError struct {
	Code        string
	Description string
}

func (e deviceTokenError) Error() string {
	return errorDescription(tokenResponse{Error: e.Code, Description: e.Description})
}

func printDeviceInstructions(output io.Writer, device deviceAuthorizationResponse) {
	if device.VerificationURIComplete != "" {
		fmt.Fprintf(output, "Open: %s\n", device.VerificationURIComplete)
	}
	fmt.Fprintf(output, "Verification URL: %s\n", device.VerificationURI)
	fmt.Fprintf(output, "Code: %s\n", device.UserCode)
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
		if !expiresAt.After(time.Now()) {
			return nil, fmt.Errorf("saved AMA runner token is expired; run ama-runner login again")
		}
	}
	return &config, nil
}

func expiresAt(seconds int) string {
	if seconds <= 0 {
		return ""
	}
	return time.Now().Add(time.Duration(seconds) * time.Second).UTC().Format(time.RFC3339)
}

func errorDescription(token tokenResponse) string {
	if token.Description != "" {
		return token.Description
	}
	if token.Error != "" {
		return token.Error
	}
	return "provider_error"
}
