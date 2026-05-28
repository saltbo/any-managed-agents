package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type fakeControlPlane struct {
	mu           sync.Mutex
	heartbeats   []ama.RunnerHeartbeatRequest
	updates      []ama.UpdateRunnerLeaseRequest
	events       []ama.UploadRunnerLeaseEventsRequest
	lease        *ama.RunnerWorkLease
	healthErr    error
	createErr    error
	heartbeatErr error
	claimErr     error
	eventErr     error
	updateErr    error
}

func (f *fakeControlPlane) CheckHealth(context.Context) (*ama.Health, error) {
	if f.healthErr != nil {
		return nil, f.healthErr
	}
	return &ama.Health{Status: "ok", Name: "Any Managed Agents", Runtime: "cloudflare-workers"}, nil
}

func (f *fakeControlPlane) CreateRunner(context.Context, ama.CreateRunnerRequest) (*ama.Runner, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	return &ama.Runner{ID: "runner_registered"}, nil
}

func (f *fakeControlPlane) CreateRunnerHeartbeat(_ context.Context, runnerID string, body ama.RunnerHeartbeatRequest) (*ama.Runner, error) {
	if f.heartbeatErr != nil {
		return nil, f.heartbeatErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.heartbeats = append(f.heartbeats, body)
	return &ama.Runner{ID: runnerID, Status: body.Status}, nil
}

func (f *fakeControlPlane) CreateRunnerLease(context.Context, string, ama.ClaimRunnerLeaseRequest) (*ama.RunnerWorkLease, error) {
	if f.claimErr != nil {
		return nil, f.claimErr
	}
	return f.lease, nil
}

func (f *fakeControlPlane) UpdateRunnerLease(_ context.Context, _ string, _ string, body ama.UpdateRunnerLeaseRequest) (*ama.RunnerWorkLease, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updates = append(f.updates, body)
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	return f.lease, nil
}

func (f *fakeControlPlane) CreateRunnerLeaseEvents(_ context.Context, _ string, _ string, body ama.UploadRunnerLeaseEventsRequest) error {
	if f.eventErr != nil {
		return f.eventErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, body)
	return nil
}

type fakeAdapter struct {
	waitForCancel bool
	result        ToolResult
	err           error
	cancelled     bool
}

func (a *fakeAdapter) Execute(ctx context.Context, _ ToolRequest) (ToolResult, error) {
	if !a.waitForCancel {
		return a.result, a.err
	}
	<-ctx.Done()
	a.cancelled = true
	return ToolResult{}, ctx.Err()
}

func TestRunOnceSendsHeartbeatAndCompletesApprovedToolWork(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease()}
	adapter := &fakeAdapter{result: ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run once success, got %v", err)
	}
	if len(client.heartbeats) != 1 {
		t.Fatalf("expected heartbeat before claim, got %d", len(client.heartbeats))
	}
	if len(client.updates) != 1 || client.updates[0].Status != "completed" {
		t.Fatalf("expected completed update, got %#v", client.updates)
	}
	if len(client.events) != 2 {
		t.Fatalf("expected started and completed events, got %#v", client.events)
	}
}

func TestRunOnceCompletesSessionStartWorkWithoutRunningLocalRuntime(t *testing.T) {
	client := &fakeControlPlane{lease: sessionStartLease()}
	adapter := &fakeAdapter{err: errors.New("adapter should not run")}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected session.start completion, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].Status != "completed" {
		t.Fatalf("expected completed session.start update, got %#v", client.updates)
	}
	if client.updates[0].Result["handled"] != "session.start" {
		t.Fatalf("unexpected session.start result %#v", client.updates[0].Result)
	}
	if len(client.events) != 1 || client.events[0].Events[0].Type != "runner.session.started" {
		t.Fatalf("expected session event, got %#v", client.events)
	}
}

func TestSessionStartReturnsEventUploadErrors(t *testing.T) {
	client := &fakeControlPlane{lease: sessionStartLease(), eventErr: errors.New("event failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "event failed") {
		t.Fatalf("expected event upload error, got %v", err)
	}
}

func TestStartRegistersRunnerAndSendsOfflineHeartbeatOnShutdown(t *testing.T) {
	client := &fakeControlPlane{}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	daemon.Config.RunnerID = ""
	daemon.Config.RunnerName = "registered"
	daemon.Config.PollInterval = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		count := len(client.heartbeats)
		client.mu.Unlock()
		if count > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for startup heartbeat")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	<-done
	if daemon.RunnerID != "runner_registered" {
		t.Fatalf("expected registered runner id, got %q", daemon.RunnerID)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if got := client.heartbeats[len(client.heartbeats)-1].Status; got != "offline" {
		t.Fatalf("expected offline shutdown heartbeat, got %q", got)
	}
}

func TestStartFailsFastOnControlPlaneSetupErrors(t *testing.T) {
	tests := []struct {
		name   string
		client *fakeControlPlane
		want   string
	}{
		{"health", &fakeControlPlane{healthErr: errors.New("bad health")}, "bad health"},
		{"create", &fakeControlPlane{createErr: errors.New("create failed")}, "create failed"},
		{"heartbeat", &fakeControlPlane{heartbeatErr: errors.New("heartbeat failed")}, "heartbeat failed"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			daemon := testDaemon(tc.client, &fakeAdapter{})
			daemon.Config.RunnerID = ""
			daemon.Config.RunnerName = "runner"
			err := daemon.Start(context.Background())
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
		})
	}
}

func TestRunOnceReturnsWhenNoLeaseIsAvailable(t *testing.T) {
	client := &fakeControlPlane{}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected no-work run to succeed, got %v", err)
	}
	if len(client.updates) != 0 {
		t.Fatalf("expected no lease updates, got %#v", client.updates)
	}
}

func TestRunOnceReturnsClaimErrors(t *testing.T) {
	client := &fakeControlPlane{claimErr: errors.New("claim failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "claim failed") {
		t.Fatalf("expected claim error, got %v", err)
	}
}

func TestRunOnceMarksExecutorFailureAsFailedLease(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease()}
	adapter := &fakeAdapter{
		result: ToolResult{Output: map[string]any{"stdout": "", "stderr": "no", "exitCode": 2}},
		err:    errors.New("command failed"),
	}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected failed lease update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].Status != "failed" {
		t.Fatalf("expected failed update, got %#v", client.updates)
	}
}

func TestRunOnceReturnsEventUploadErrors(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease(), eventErr: errors.New("event failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "event failed") {
		t.Fatalf("expected event error, got %v", err)
	}
}

func TestRunOnceCompletesSessionStartWithoutLocalPiRuntime(t *testing.T) {
	lease := approvedLease()
	lease.WorkItem.Type = "session.start"
	lease.WorkItem.Payload = ama.JSON{
		"protocol":     "ama-runner-work",
		"type":         "session.start",
		"sessionId":    "session_1",
		"runtimeOwner": "ama-cloud",
	}
	client := &fakeControlPlane{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{err: errors.New("adapter must not run")})
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected session.start completion, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].Status != "completed" {
		t.Fatalf("expected completed session.start update, got %#v", client.updates)
	}
	if client.updates[0].Result["handled"] != "session.start" {
		t.Fatalf("unexpected session.start result %#v", client.updates[0].Result)
	}
}

func TestRunOnceFailsFastOnUnapprovedWorkAfterMarkingLeaseFailed(t *testing.T) {
	lease := approvedLease()
	lease.WorkItem.Payload["approved"] = false
	client := &fakeControlPlane{lease: lease}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected unapproved work error, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].Status != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestLeaseRenewalFailureCancelsLocalWorkWithoutCompletionRetry(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease(), updateErr: errors.New("lease lost")}
	adapter := &fakeAdapter{waitForCancel: true}
	daemon := testDaemon(client, adapter)
	daemon.Config.RenewInterval = time.Millisecond
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "runner lease renewal failed") {
		t.Fatalf("expected renew failure, got %v", err)
	}
	if !adapter.cancelled {
		t.Fatal("expected renew failure to cancel adapter context")
	}
	if len(client.updates) != 1 || client.updates[0].Status != "active" {
		t.Fatalf("expected only renew update, got %#v", client.updates)
	}
}

func TestContextCancellationMarksLeaseCancelled(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease()}
	adapter := &fakeAdapter{waitForCancel: true}
	daemon := testDaemon(client, adapter)
	daemon.Config.RenewInterval = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(ctx)
	}()
	time.Sleep(5 * time.Millisecond)
	cancel()
	err := <-done
	if err != nil {
		t.Fatalf("expected cancelled lease update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].Status != "cancelled" {
		t.Fatalf("expected cancelled update, got %#v", client.updates)
	}
}

func TestParseWorkPayloadAcceptsNestedToolCallAndRejectsUnsupportedTool(t *testing.T) {
	payload, err := parseWorkPayload(ama.JSON{
		"protocol": "ama-runner-work",
		"toolCall": map[string]any{
			"id":       "call_1",
			"name":     "sandbox.read",
			"input":    map[string]any{"path": "README.md"},
			"approved": true,
		},
	})
	if err != nil {
		t.Fatalf("expected nested tool call payload, got %v", err)
	}
	if payload.ToolName != "sandbox.read" || payload.Input["path"] != "README.md" {
		t.Fatalf("unexpected payload %#v", payload)
	}
	_, err = parseWorkPayload(ama.JSON{
		"protocol":   "ama-runner-work",
		"approved":   true,
		"toolCallId": "call_2",
		"toolName":   "mcp.github.repo.read",
		"input":      map[string]any{},
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported sandbox tool") {
		t.Fatalf("expected unsupported tool error, got %v", err)
	}
}

func TestParseWorkPayloadRejectsProtocolAndMissingFields(t *testing.T) {
	tests := []ama.JSON{
		{"protocol": "other"},
		{"protocol": "ama-runner-work", "type": "session.start"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "runtimeOwner": "local"},
		{"protocol": "ama-runner-work", "approved": true, "toolName": "sandbox.exec", "input": map[string]any{}},
	}
	for _, payload := range tests {
		if _, err := parseWorkPayload(payload); err == nil {
			t.Fatalf("expected payload error for %#v", payload)
		}
	}
}

func testDaemon(client *fakeControlPlane, adapter SandboxAdapter) RunnerDaemon {
	return RunnerDaemon{
		Config: Config{
			RunnerID:              "runner_1",
			Capabilities:          []string{"sandbox.exec"},
			SandboxAdapter:        processUnsafeAdapter,
			WorkDir:               ".",
			MaxConcurrent:         1,
			PollInterval:          time.Second,
			HeartbeatInterval:     time.Second,
			LeaseDurationSeconds:  60,
			RenewInterval:         time.Hour,
			CommandTimeout:        time.Second,
			ShutdownGraceInterval: time.Millisecond,
		},
		Client:  client,
		Adapter: adapter,
	}
}

func approvedLease() *ama.RunnerWorkLease {
	return &ama.RunnerWorkLease{
		ID:       "lease_1",
		RunnerID: "runner_1",
		Status:   "active",
		WorkItem: ama.RunnerWorkItem{
			ID:     "work_1",
			Type:   "tool.execute",
			Status: "leased",
			Payload: ama.JSON{
				"protocol":   "ama-runner-work",
				"type":       "tool.execute",
				"approved":   true,
				"toolCallId": "call_1",
				"toolName":   "sandbox.exec",
				"input":      map[string]any{"command": "printf ok"},
			},
		},
	}
}

func sessionStartLease() *ama.RunnerWorkLease {
	return &ama.RunnerWorkLease{
		ID:       "lease_1",
		RunnerID: "runner_1",
		Status:   "active",
		WorkItem: ama.RunnerWorkItem{
			ID:     "work_1",
			Type:   "session.start",
			Status: "leased",
			Payload: ama.JSON{
				"protocol":     "ama-runner-work",
				"type":         "session.start",
				"sessionId":    "session_1",
				"runtimeOwner": "ama-cloud",
			},
		},
	}
}
