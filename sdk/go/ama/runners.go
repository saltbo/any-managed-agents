package ama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/coder/websocket"
)

type JSON = map[string]any

type Runner struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Capabilities    []string `json:"capabilities"`
	EnvironmentID   *string  `json:"environmentId"`
	Status          string   `json:"status"`
	CurrentLoad     int      `json:"currentLoad"`
	MaxConcurrent   int      `json:"maxConcurrent"`
	LastHeartbeatAt *string  `json:"lastHeartbeatAt"`
}

type CreateRunnerRequest struct {
	Name          string   `json:"name"`
	Capabilities  []string `json:"capabilities,omitempty"`
	EnvironmentID string   `json:"environmentId,omitempty"`
	MaxConcurrent int      `json:"maxConcurrent,omitempty"`
	Metadata      JSON     `json:"metadata,omitempty"`
}

type RunnerHeartbeatRequest struct {
	Status       string   `json:"status,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	CurrentLoad  *int     `json:"currentLoad,omitempty"`
	Metadata     JSON     `json:"metadata,omitempty"`
}

type ClaimRunnerLeaseRequest struct {
	LeaseDurationSeconds int `json:"leaseDurationSeconds,omitempty"`
}

type UpdateRunnerLeaseRequest struct {
	Status               string `json:"status"`
	LeaseDurationSeconds int    `json:"leaseDurationSeconds,omitempty"`
	Result               JSON   `json:"result,omitempty"`
	Error                JSON   `json:"error,omitempty"`
}

type RunnerLeaseEvent struct {
	Type     string `json:"type"`
	Payload  JSON   `json:"payload"`
	Metadata JSON   `json:"metadata,omitempty"`
}

type UploadRunnerLeaseEventsRequest struct {
	Events []RunnerLeaseEvent `json:"events"`
}

type RunnerWorkItem struct {
	ID             string `json:"id"`
	SessionID      string `json:"sessionId"`
	EnvironmentID  string `json:"environmentId"`
	RunnerID       string `json:"runnerId"`
	LeaseID        string `json:"leaseId"`
	Type           string `json:"type"`
	Status         string `json:"status"`
	Payload        JSON   `json:"payload"`
	LeaseExpiresAt string `json:"leaseExpiresAt"`
	Attempts       int    `json:"attempts"`
	MaxAttempts    int    `json:"maxAttempts"`
}

type RunnerWorkLease struct {
	ID         string         `json:"id"`
	WorkItemID string         `json:"workItemId"`
	RunnerID   string         `json:"runnerId"`
	Status     string         `json:"status"`
	ExpiresAt  string         `json:"expiresAt"`
	WorkItem   RunnerWorkItem `json:"workItem"`
}

type RunnerSessionChannel struct {
	Conn *websocket.Conn
}

type Health struct {
	Status         string `json:"status"`
	Name           string `json:"name"`
	Runtime        string `json:"runtime"`
	OIDCIssuer     string `json:"oidcIssuer"`
	RunnerClientID string `json:"runnerClientId"`
	RunnerScopes   string `json:"runnerScopes"`
}

type ErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) CheckHealth(ctx context.Context) (*Health, error) {
	var health Health
	if err := c.do(ctx, http.MethodGet, "/api/health", nil, &health); err != nil {
		return nil, err
	}
	if health.Status != "ok" || health.Name != "Any Managed Agents" {
		return nil, fmt.Errorf("incompatible AMA control plane: %s/%s", health.Name, health.Status)
	}
	return &health, nil
}

func (c *Client) CreateRunner(ctx context.Context, body CreateRunnerRequest) (*Runner, error) {
	var runner Runner
	if err := c.do(ctx, http.MethodPost, "/api/runners", body, &runner); err != nil {
		return nil, err
	}
	return &runner, nil
}

func (c *Client) CreateRunnerHeartbeat(ctx context.Context, runnerID string, body RunnerHeartbeatRequest) (*Runner, error) {
	var runner Runner
	if err := c.do(ctx, http.MethodPost, "/api/runners/"+url.PathEscape(runnerID)+"/heartbeats", body, &runner); err != nil {
		return nil, err
	}
	return &runner, nil
}

func (c *Client) CreateRunnerLease(ctx context.Context, runnerID string, body ClaimRunnerLeaseRequest) (*RunnerWorkLease, error) {
	var lease RunnerWorkLease
	status, err := c.doStatus(ctx, http.MethodPost, "/api/runners/"+url.PathEscape(runnerID)+"/leases", body, &lease)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNoContent {
		return nil, nil
	}
	return &lease, nil
}

func (c *Client) UpdateRunnerLease(ctx context.Context, runnerID string, leaseID string, body UpdateRunnerLeaseRequest) (*RunnerWorkLease, error) {
	var lease RunnerWorkLease
	if err := c.do(ctx, http.MethodPatch, "/api/runners/"+url.PathEscape(runnerID)+"/leases/"+url.PathEscape(leaseID), body, &lease); err != nil {
		return nil, err
	}
	return &lease, nil
}

func (c *Client) CreateRunnerLeaseEvents(ctx context.Context, runnerID string, leaseID string, body UploadRunnerLeaseEventsRequest) error {
	var response struct {
		Accepted int `json:"accepted"`
	}
	return c.do(ctx, http.MethodPost, "/api/runners/"+url.PathEscape(runnerID)+"/leases/"+url.PathEscape(leaseID)+"/events", body, &response)
}

func (c *Client) RunnerSessionChannelURL(runnerID string, leaseID string) (string, error) {
	if strings.TrimSpace(c.Origin) == "" {
		return "", fmt.Errorf("AMA origin is required")
	}
	origin, err := url.Parse(strings.TrimRight(c.Origin, "/"))
	if err != nil {
		return "", err
	}
	switch origin.Scheme {
	case "https":
		origin.Scheme = "wss"
	case "http":
		origin.Scheme = "ws"
	default:
		return "", fmt.Errorf("AMA origin must use http or https")
	}
	origin.Path = "/"
	origin.RawPath = ""
	origin.RawQuery = ""
	origin.Fragment = ""
	return strings.TrimRight(origin.String(), "/") + "/api/runners/" + url.PathEscape(runnerID) + "/leases/" + url.PathEscape(leaseID) + "/channel", nil
}

func (c *Client) OpenRunnerSessionChannel(ctx context.Context, runnerID string, leaseID string) (*RunnerSessionChannel, error) {
	endpoint, err := c.RunnerSessionChannelURL(runnerID, leaseID)
	if err != nil {
		return nil, err
	}
	headers := http.Header{}
	if c.AccessToken != "" {
		headers.Set("authorization", "Bearer "+c.AccessToken)
	}
	conn, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		return nil, err
	}
	return &RunnerSessionChannel{Conn: conn}, nil
}

func (ch *RunnerSessionChannel) ReadJSON(ctx context.Context, out any) error {
	_, data, err := ch.Conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (ch *RunnerSessionChannel) WriteJSON(ctx context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ch.Conn.Write(ctx, websocket.MessageText, data)
}

func (ch *RunnerSessionChannel) Close(statusCode int, reason string) error {
	return ch.Conn.Close(websocket.StatusCode(statusCode), reason)
}

func (c *Client) do(ctx context.Context, method string, path string, body any, out any) error {
	_, err := c.doStatus(ctx, method, path, body, out)
	return err
}

func (c *Client) doStatus(ctx context.Context, method string, path string, body any, out any) (int, error) {
	if strings.TrimSpace(c.Origin) == "" {
		return 0, fmt.Errorf("AMA origin is required")
	}
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		reader = bytes.NewReader(payload)
	}
	endpoint := strings.TrimRight(c.Origin, "/") + path
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return 0, err
	}
	request.Header.Set("accept", "application/json")
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	if c.AccessToken != "" {
		request.Header.Set("authorization", "Bearer "+c.AccessToken)
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return response.StatusCode, nil
	}
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return response.StatusCode, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		var apiError ErrorResponse
		if json.Unmarshal(responseBody, &apiError) == nil && apiError.Error.Message != "" {
			return response.StatusCode, fmt.Errorf("AMA %s %s failed: %s", method, path, apiError.Error.Message)
		}
		return response.StatusCode, fmt.Errorf("AMA %s %s failed with status %d", method, path, response.StatusCode)
	}
	if out == nil {
		return response.StatusCode, nil
	}
	if err := json.Unmarshal(responseBody, out); err != nil {
		return response.StatusCode, err
	}
	return response.StatusCode, nil
}
