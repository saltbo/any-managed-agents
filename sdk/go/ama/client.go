package ama

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// Regenerate the typed models and REST client (ama.gen.go) from the OpenAPI doc.
// Requires oapi-codegen on PATH:
//   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
// The config's paths (overlay, output) resolve from sdk/go, so run from there.
// `go generate` invokes this from the package dir, hence the `cd ..`.
//go:generate sh -c "cd .. && oapi-codegen -config oapi-codegen.config.yaml ../openapi.json"

type JSON = map[string]interface{}

type ClientConfig struct {
	BaseURL     string
	AccessToken string
	ProjectID   string
	Headers     map[string]string
	HTTPClient  HttpRequestDoer
}

type Client struct {
	raw       *ClientWithResponses
	System    SystemService
	Runners   RunnerService
	WorkItems WorkItemService
	Leases    LeaseService
	Sessions  SessionService
}

func New(config ClientConfig) (*Client, error) {
	if strings.TrimSpace(config.BaseURL) == "" {
		return nil, fmt.Errorf("AMA base URL is required")
	}
	opts := []ClientOption{
		WithRequestEditorFn(func(_ context.Context, request *http.Request) error {
			if config.AccessToken != "" {
				request.Header.Set("authorization", "Bearer "+config.AccessToken)
			}
			if config.ProjectID != "" {
				request.Header.Set("x-ama-project-id", config.ProjectID)
			}
			for key, value := range config.Headers {
				request.Header.Set(key, value)
			}
			return nil
		}),
	}
	if config.HTTPClient != nil {
		opts = append(opts, WithHTTPClient(config.HTTPClient))
	}
	raw, err := NewClientWithResponses(strings.TrimRight(config.BaseURL, "/"), opts...)
	if err != nil {
		return nil, err
	}
	client := &Client{raw: raw}
	client.System = SystemService{client: client}
	client.Runners = RunnerService{client: client}
	client.WorkItems = WorkItemService{client: client}
	client.Leases = LeaseService{client: client}
	client.Sessions = SessionService{client: client}
	return client, nil
}

func (c *Client) Raw() *ClientWithResponses {
	return c.raw
}

type APIError struct {
	Status       int
	ResponseText string
	Body         any
}

func (e *APIError) Error() string {
	if e.Status == 0 {
		return "AMA API request failed"
	}
	if e.ResponseText != "" {
		return fmt.Sprintf("AMA API request failed with HTTP %d: %s", e.Status, e.ResponseText)
	}
	return fmt.Sprintf("AMA API request failed with HTTP %d", e.Status)
}

func StatusCode(err error) (int, bool) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status, true
	}
	return 0, false
}

type SystemService struct {
	client *Client
}

func (s SystemService) Health(ctx context.Context) (*HealthResponse, error) {
	response, err := s.client.raw.GetHealthWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200)
}

type RunnerService struct {
	client *Client
}

func (s RunnerService) Create(ctx context.Context, body CreateRunnerRequest) (*Runner, error) {
	response, err := s.client.raw.CreateRunnerWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON409)
}

func (s RunnerService) PutHeartbeat(ctx context.Context, runnerID string, body PutRunnerHeartbeatRequest) (*RunnerHeartbeat, error) {
	response, err := s.client.raw.PutRunnerHeartbeatWithResponse(ctx, runnerID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type WorkItemService struct {
	client *Client
}

func (s WorkItemService) List(ctx context.Context, params *ListWorkItemsParams) (*WorkItemListResponse, error) {
	response, err := s.client.raw.ListWorkItemsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401)
}

func (s WorkItemService) Get(ctx context.Context, workItemID string) (*WorkItem, error) {
	response, err := s.client.raw.ReadWorkItemWithResponse(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON404, response.JSON409)
}

type LeaseService struct {
	client *Client
}

func (s LeaseService) Create(ctx context.Context, body CreateLeaseRequest) (*Lease, error) {
	response, err := s.client.raw.CreateLeaseWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s LeaseService) Update(ctx context.Context, leaseID string, body UpdateLeaseRequest) (*Lease, error) {
	response, err := s.client.raw.UpdateLeaseWithResponse(ctx, leaseID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type SessionService struct {
	client *Client
}

func (s SessionService) CreateEvents(ctx context.Context, sessionID string, events []SessionEventInput) (*SessionEventsAccepted, error) {
	response, err := s.client.raw.CreateSessionEventsWithResponse(ctx, sessionID, CreateSessionEventsRequest{Events: events})
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func unwrap[T any](status int, responseBody []byte, data *T, errors ...*ErrorResponse) (*T, error) {
	if status >= 200 && status <= 299 && data != nil {
		return data, nil
	}
	return nil, newAPIError(status, responseBody, firstError(errors...))
}

func newAPIError(status int, responseBody []byte, response *ErrorResponse) *APIError {
	if response != nil {
		return &APIError{Status: status, ResponseText: errorResponseText(response), Body: response}
	}
	return &APIError{Status: status, ResponseText: strings.TrimSpace(string(responseBody)), Body: string(responseBody)}
}

func errorResponseText(response *ErrorResponse) string {
	if response == nil {
		return ""
	}
	if response.Error.Message != "" {
		return response.Error.Message
	}
	return fmt.Sprintf("%v", response.Error)
}

func firstError(errors ...*ErrorResponse) *ErrorResponse {
	for _, err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}
