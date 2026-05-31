package ama

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRunnerClientSendsBearerJSONRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/runners/runner_1/leases" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("authorization") != "Bearer token" {
			t.Fatalf("missing bearer token")
		}
		var body ClaimRunnerLeaseRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.LeaseDurationSeconds != 60 {
			t.Fatalf("unexpected body %#v", body)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"lease_1","workItemId":"work_1","runnerId":"runner_1","status":"active","expiresAt":"2026-05-28T00:00:00.000Z","workItem":{"id":"work_1","type":"tool.execute","status":"leased","payload":{}}}`))
	}))
	defer server.Close()

	client := Client{Origin: server.URL, AccessToken: "token", HTTPClient: server.Client()}
	lease, err := client.CreateRunnerLease(context.Background(), "runner_1", ClaimRunnerLeaseRequest{LeaseDurationSeconds: 60})
	if err != nil {
		t.Fatalf("expected lease, got %v", err)
	}
	if lease.ID != "lease_1" {
		t.Fatalf("unexpected lease %#v", lease)
	}
}

func TestRunnerClientReturnsNilLeaseOnNoContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	client := Client{Origin: server.URL, HTTPClient: server.Client()}
	lease, err := client.CreateRunnerLease(context.Background(), "runner_1", ClaimRunnerLeaseRequest{})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if lease != nil {
		t.Fatalf("expected nil lease, got %#v", lease)
	}
}

func TestRunnerClientSurfacesAPIErrorEnvelope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"auth","message":"bad token"}}`))
	}))
	defer server.Close()
	client := Client{Origin: server.URL, HTTPClient: server.Client()}
	_, err := client.CheckHealth(context.Background())
	if err == nil {
		t.Fatal("expected API error")
	}
}
