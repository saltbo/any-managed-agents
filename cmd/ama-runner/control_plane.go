package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

// v1RuntimeInventory mirrors ama.RuntimeInventory but uses the v1 `state` field
// name (the SDK type still carries the legacy `status` tag). It reports one host
// runtime's availability and must never carry provider tokens or local
// credential values.
type v1RuntimeInventory struct {
	Runtime string `json:"runtime"`
	Version string `json:"version,omitempty"`
	State   string `json:"state"`
	Detail  string `json:"detail,omitempty"`
}

// PutRunnerHeartbeatRequest is the body for PUT /api/v1/runners/{id}/heartbeat.
// The heartbeat is an idempotent singleton replace of the runner's current
// liveness state.
type PutRunnerHeartbeatRequest struct {
	State            string               `json:"state,omitempty"`
	Capabilities     []string             `json:"capabilities,omitempty"`
	CurrentLoad      *int                 `json:"currentLoad,omitempty"`
	RuntimeUsage     []ama.RuntimeUsage   `json:"runtimeUsage,omitempty"`
	RuntimeInventory []v1RuntimeInventory `json:"runtimeInventory,omitempty"`
	Metadata         ama.JSON             `json:"metadata,omitempty"`
}

// CreateLeaseRequest is the body for POST /api/v1/leases.
type CreateLeaseRequest struct {
	WorkItemID           string `json:"workItemId"`
	RunnerID             string `json:"runnerId"`
	LeaseDurationSeconds int    `json:"leaseDurationSeconds,omitempty"`
}

// UpdateLeaseRequest is the body for PATCH /api/v1/leases/{leaseId}. A renewal
// sends state "active" with a new duration/expiry; completion sends a terminal
// state with the work outcome (result/error land on the work item server-side).
type UpdateLeaseRequest struct {
	State                string   `json:"state,omitempty"`
	LeaseDurationSeconds int      `json:"leaseDurationSeconds,omitempty"`
	ExpiresAt            string   `json:"expiresAt,omitempty"`
	ResumeToken          string   `json:"resumeToken,omitempty"`
	Result               ama.JSON `json:"result,omitempty"`
	Error                ama.JSON `json:"error,omitempty"`
}

// Lease is the v1 lease resource. It no longer embeds the work item; the runner
// fetches GET /api/v1/work-items/{workItemId} to obtain the payload.
type Lease struct {
	ID          string `json:"id"`
	WorkItemID  string `json:"workItemId"`
	RunnerID    string `json:"runnerId"`
	State       string `json:"state"`
	ExpiresAt   string `json:"expiresAt"`
	RenewedAt   string `json:"renewedAt"`
	ResumeToken string `json:"resumeToken"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// WorkItem is the v1 top-level queue resource. The active lease holder receives
// the raw payload (with resolved secret env) on GET /api/v1/work-items/{id}.
type WorkItem struct {
	ID            string   `json:"id"`
	ProjectID     string   `json:"projectId"`
	SessionID     string   `json:"sessionId"`
	EnvironmentID string   `json:"environmentId"`
	RunnerID      string   `json:"runnerId"`
	LeaseID       string   `json:"leaseId"`
	Type          string   `json:"type"`
	State         string   `json:"state"`
	Priority      int      `json:"priority"`
	Attempts      int      `json:"attempts"`
	MaxAttempts   int      `json:"maxAttempts"`
	Payload       ama.JSON `json:"payload"`
}

type workItemListResponse struct {
	Data []WorkItem `json:"data"`
}

// SessionEvent is one runner-reported session event.
type SessionEvent struct {
	Type     string   `json:"type"`
	Payload  ama.JSON `json:"payload"`
	Metadata ama.JSON `json:"metadata,omitempty"`
}

type createSessionEventsRequest struct {
	Events []SessionEvent `json:"events"`
}

// v1ControlPlane talks to the rewritten /api/v1 self-hosted runner protocol. It
// owns its HTTP transport so the runner is not coupled to the legacy hand-written
// SDK runner client.
type v1ControlPlane struct {
	Origin     string
	ProjectID  string
	HTTPClient *http.Client
}

func (c *v1ControlPlane) CheckHealth(ctx context.Context) (*ama.Health, error) {
	var health ama.Health
	if _, err := c.doStatus(ctx, http.MethodGet, "/api/v1/health", nil, &health); err != nil {
		return nil, err
	}
	if health.Status != "ok" || health.Name != "Any Managed Agents" {
		return nil, fmt.Errorf("incompatible AMA control plane: %s/%s", health.Name, health.Status)
	}
	return &health, nil
}

func (c *v1ControlPlane) CreateRunner(ctx context.Context, body ama.CreateRunnerRequest) (*ama.Runner, error) {
	var runner ama.Runner
	if _, err := c.doStatus(ctx, http.MethodPost, "/api/v1/runners", body, &runner); err != nil {
		return nil, err
	}
	return &runner, nil
}

func (c *v1ControlPlane) PutRunnerHeartbeat(ctx context.Context, runnerID string, body PutRunnerHeartbeatRequest) error {
	status, err := c.doStatus(ctx, http.MethodPut, "/api/v1/runners/"+url.PathEscape(runnerID)+"/heartbeat", body, nil)
	if err != nil {
		// 404: the control plane no longer knows this runner — its row was
		// reaped (offline timeout) or lost (control-plane data reset). The
		// stored runner id is stale; surface it so the daemon re-registers
		// instead of heartbeating a ghost forever.
		if status == http.StatusNotFound {
			return runnerGoneError{err: err}
		}
		return err
	}
	return nil
}

func (c *v1ControlPlane) ListAvailableWorkItems(ctx context.Context) ([]WorkItem, error) {
	var response workItemListResponse
	if _, err := c.doStatus(ctx, http.MethodGet, "/api/v1/work-items?state=available", nil, &response); err != nil {
		return nil, err
	}
	return response.Data, nil
}

func (c *v1ControlPlane) ReadWorkItem(ctx context.Context, workItemID string) (*WorkItem, error) {
	var workItem WorkItem
	if _, err := c.doStatus(ctx, http.MethodGet, "/api/v1/work-items/"+url.PathEscape(workItemID), nil, &workItem); err != nil {
		return nil, err
	}
	return &workItem, nil
}

// CreateLease claims a specific available work item. A 409 means the item was
// claimed by another runner (or the runner is ineligible) and is surfaced as a
// claimRaceError so the caller can move on to the next item without failing.
func (c *v1ControlPlane) CreateLease(ctx context.Context, body CreateLeaseRequest) (*Lease, error) {
	var lease Lease
	status, err := c.doStatus(ctx, http.MethodPost, "/api/v1/leases", body, &lease)
	if err != nil {
		if status == http.StatusConflict || status == http.StatusNotFound {
			return nil, claimRaceError{status: status, err: err}
		}
		return nil, err
	}
	return &lease, nil
}

func (c *v1ControlPlane) UpdateLease(ctx context.Context, leaseID string, body UpdateLeaseRequest) (*Lease, error) {
	var lease Lease
	if _, err := c.doStatus(ctx, http.MethodPatch, "/api/v1/leases/"+url.PathEscape(leaseID), body, &lease); err != nil {
		return nil, err
	}
	return &lease, nil
}

func (c *v1ControlPlane) CreateSessionEvents(ctx context.Context, sessionID string, events []SessionEvent) error {
	_, err := c.doStatus(ctx, http.MethodPost, "/api/v1/sessions/"+url.PathEscape(sessionID)+"/events", createSessionEventsRequest{Events: events}, nil)
	return err
}

// claimRaceError marks a lease claim that lost a race (409) or hit a vanished
// work item (404). These are expected during contention and are not runner
// failures.
type claimRaceError struct {
	status int
	err    error
}

func (e claimRaceError) Error() string {
	return e.err.Error()
}

func isClaimRaceError(err error) bool {
	var raceErr claimRaceError
	return errors.As(err, &raceErr)
}

// runnerGoneError marks an operation that found the runner row absent (404).
// Unlike a transient heartbeat failure, this is terminal for the current
// runner id and is recovered by re-registering, not by retrying.
type runnerGoneError struct {
	err error
}

func (e runnerGoneError) Error() string {
	return e.err.Error()
}

func isRunnerGoneError(err error) bool {
	var goneErr runnerGoneError
	return errors.As(err, &goneErr)
}

func (c *v1ControlPlane) doStatus(ctx context.Context, method string, path string, body any, out any) (int, error) {
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
	if c.ProjectID != "" {
		request.Header.Set("x-ama-project-id", c.ProjectID)
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
		var apiError ama.ErrorResponse
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

// v1LeaseChannelURL builds the v1 WebSocket channel URL. runnerId is no longer
// part of the path; the server derives it from the lease.
func v1LeaseChannelURL(origin string, leaseID string) (string, error) {
	if strings.TrimSpace(origin) == "" {
		return "", fmt.Errorf("AMA origin is required")
	}
	parsed, err := url.Parse(strings.TrimRight(origin, "/"))
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	default:
		return "", fmt.Errorf("AMA origin must use http or https")
	}
	parsed.Path = "/"
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/") + "/api/v1/leases/" + url.PathEscape(leaseID) + "/channel", nil
}
