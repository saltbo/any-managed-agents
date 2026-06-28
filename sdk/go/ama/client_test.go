package ama

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientFacadeConfiguresHeadersAndCallsGeneratedOperation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/runners" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("authorization"); got != "Bearer token_1" {
			t.Fatalf("expected authorization header, got %q", got)
		}
		if got := r.Header.Get("x-ama-project-id"); got != "project_1" {
			t.Fatalf("expected project header, got %q", got)
		}
		var body CreateRunnerRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON body, got %v", err)
		}
		if body.Name != "runner-a" {
			t.Fatalf("expected request body to be encoded, got %#v", body)
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{
			"archivedAt": null,
			"authMode": "oidc",
			"capabilities": [],
			"createdAt": "2026-01-01T00:00:00Z",
			"credentialRef": {},
			"currentLoad": 0,
			"environmentId": null,
			"id": "runner_1",
			"lastHeartbeatAt": null,
			"maxConcurrent": 1,
			"metadata": {},
			"name": "runner-a",
			"projectId": "project_1",
			"runtimeInventory": [],
			"runtimeUsage": [],
			"state": "active",
			"updatedAt": "2026-01-01T00:00:00Z"
		}`))
	}))
	defer server.Close()

	client, err := New(ClientConfig{BaseURL: server.URL, AccessToken: "token_1", ProjectID: "project_1"})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	runner, err := client.Runners.Create(context.Background(), CreateRunnerRequest{Name: "runner-a"})
	if err != nil {
		t.Fatalf("expected runner create success, got %v", err)
	}
	if runner.Id != "runner_1" {
		t.Fatalf("expected decoded runner, got %#v", runner)
	}
}

func TestClientFacadeReturnsAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"type":"conflict","message":"runner already exists"}}`))
	}))
	defer server.Close()

	client, err := New(ClientConfig{BaseURL: server.URL})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	_, err = client.Runners.Create(context.Background(), CreateRunnerRequest{Name: "runner-a"})
	if err == nil {
		t.Fatal("expected API error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T %[1]v", err)
	}
	if apiErr.Status != http.StatusConflict || apiErr.ResponseText != "runner already exists" {
		t.Fatalf("unexpected API error %#v", apiErr)
	}
	if status, ok := StatusCode(err); !ok || status != http.StatusConflict {
		t.Fatalf("expected status helper to expose 409, got %d %v", status, ok)
	}
}
