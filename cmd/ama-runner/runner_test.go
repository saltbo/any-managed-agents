package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

const defaultRuntimeProviderModelCapability = "runtime-provider-model:ama:workers-ai:@cf/moonshotai/kimi-k2.6"

// fakeWork pairs a v1 lease with the work item the runner fetches after
// claiming it; the lease no longer embeds the work item.
type fakeWork struct {
	lease    *Lease
	workItem *WorkItem
}

type fakeControlPlane struct {
	mu           sync.Mutex
	creates      []ama.CreateRunnerRequest
	heartbeats   []PutRunnerHeartbeatRequest
	updates      []UpdateLeaseRequest
	events       [][]SessionEvent
	lease        *fakeWork
	runnerID     string
	claims       int
	healthErr    error
	createErr    error
	heartbeatErr error
	claimErr     error
	eventErr     error
	updateErr    error
	channel      *fakeRunnerSessionChannel
	channelErr   error
	opens        int
}

func (f *fakeControlPlane) CheckHealth(context.Context) (*ama.Health, error) {
	if f.healthErr != nil {
		return nil, f.healthErr
	}
	return &ama.Health{Status: "ok", Name: "Any Managed Agents", Runtime: "cloudflare-workers"}, nil
}

func (f *fakeControlPlane) CreateRunner(_ context.Context, body ama.CreateRunnerRequest) (*ama.Runner, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creates = append(f.creates, body)
	runnerID := f.runnerID
	if runnerID == "" {
		runnerID = "runner_1"
	}
	return &ama.Runner{ID: runnerID}, nil
}

func (f *fakeControlPlane) PutRunnerHeartbeat(_ context.Context, _ string, body PutRunnerHeartbeatRequest) error {
	if f.heartbeatErr != nil {
		return f.heartbeatErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.heartbeats = append(f.heartbeats, body)
	return nil
}

func (f *fakeControlPlane) ListAvailableWorkItems(context.Context) ([]WorkItem, error) {
	f.mu.Lock()
	f.claims += 1
	f.mu.Unlock()
	if f.claimErr != nil {
		return nil, f.claimErr
	}
	if f.lease == nil {
		return nil, nil
	}
	return []WorkItem{*f.lease.workItem}, nil
}

func (f *fakeControlPlane) CreateLease(context.Context, CreateLeaseRequest) (*Lease, error) {
	if f.lease == nil {
		return nil, fmt.Errorf("no work item to lease")
	}
	return f.lease.lease, nil
}

func (f *fakeControlPlane) ReadWorkItem(context.Context, string) (*WorkItem, error) {
	if f.lease == nil {
		return nil, fmt.Errorf("work item not found")
	}
	return f.lease.workItem, nil
}

func (f *fakeControlPlane) UpdateLease(_ context.Context, _ string, body UpdateLeaseRequest) (*Lease, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updates = append(f.updates, body)
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	if f.lease == nil {
		return nil, nil
	}
	return f.lease.lease, nil
}

func (f *fakeControlPlane) CreateSessionEvents(_ context.Context, _ string, events []SessionEvent) error {
	if f.eventErr != nil {
		return f.eventErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, events)
	return nil
}

func (f *fakeControlPlane) OpenRunnerSessionChannel(context.Context, string) (RunnerSessionChannel, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opens += 1
	if f.channelErr != nil {
		return nil, f.channelErr
	}
	if f.channel == nil {
		f.channel = newFakeRunnerSessionChannel()
	}
	return f.channel, nil
}

type fakeAdapter struct {
	waitForCancel bool
	result        ToolResult
	err           error
	cancelled     atomic.Bool
}

type fakeRuntimeAdapter struct {
	request       RuntimeRequest
	events        []RuntimeEventRecord
	result        ama.JSON
	err           error
	inspect       func(RuntimeRequest) error
	waitForCancel bool
}

type RuntimeEventRecord struct {
	Type    string
	Payload ama.JSON
}

type fakeRunnerSessionChannel struct {
	mu          sync.Mutex
	reads       chan any
	writes      []ama.JSON
	closed      bool
	eventErrors map[string]string
	autoAck     bool
}

func newFakeRunnerSessionChannel(reads ...any) *fakeRunnerSessionChannel {
	channel := &fakeRunnerSessionChannel{reads: make(chan any, 16), autoAck: true}
	for _, read := range reads {
		channel.reads <- read
	}
	return channel
}

func (ch *fakeRunnerSessionChannel) ReadJSON(ctx context.Context, out any) error {
	select {
	case value := <-ch.reads:
		if err, ok := value.(error); ok {
			return err
		}
		data, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return json.Unmarshal(data, out)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (ch *fakeRunnerSessionChannel) WriteJSON(_ context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded ama.JSON
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	ch.mu.Lock()
	ch.writes = append(ch.writes, decoded)
	ch.mu.Unlock()
	if decoded["type"] == "runner.event" {
		if eventID, ok := decoded["eventId"].(string); ok && eventID != "" {
			event, _ := decoded["event"].(map[string]any)
			if event == nil {
				event, _ = decoded["event"].(ama.JSON)
			}
			eventType, _ := event["type"].(string)
			if message := ch.eventErrors[eventType]; message != "" {
				ch.reads <- ama.JSON{"type": "session.channel.error", "eventId": eventID, "message": message}
			} else if ch.autoAck {
				ch.reads <- ama.JSON{"type": "runner.event.accepted", "eventId": eventID}
			}
		}
	}
	return nil
}

func (ch *fakeRunnerSessionChannel) Close(int, string) error {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.closed = true
	return nil
}

func (ch *fakeRunnerSessionChannel) push(value any) {
	ch.reads <- value
}

func (ch *fakeRunnerSessionChannel) lastWriteEventID() string {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) == 0 {
		return ""
	}
	eventID, _ := ch.writes[len(ch.writes)-1]["eventId"].(string)
	return eventID
}

func (ch *fakeRunnerSessionChannel) writeCount() int {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return len(ch.writes)
}

func (ch *fakeRunnerSessionChannel) writtenEvents() []string {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	events := make([]string, 0, len(ch.writes))
	for _, write := range ch.writes {
		event, _ := write["event"].(map[string]any)
		if event == nil {
			event, _ = write["event"].(ama.JSON)
		}
		if event != nil {
			events = append(events, event["type"].(string))
		}
	}
	return events
}

func (ch *fakeRunnerSessionChannel) writtenMessages() []ama.JSON {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	messages := make([]ama.JSON, len(ch.writes))
	copy(messages, ch.writes)
	return messages
}

func (a *fakeAdapter) Execute(ctx context.Context, _ ToolRequest) (ToolResult, error) {
	if !a.waitForCancel {
		return a.result, a.err
	}
	<-ctx.Done()
	a.cancelled.Store(true)
	return ToolResult{}, ctx.Err()
}

func (a *fakeRuntimeAdapter) Run(ctx context.Context, request RuntimeRequest, write RuntimeEventWriter) (ama.JSON, error) {
	a.request = request
	if a.inspect != nil {
		if err := a.inspect(request); err != nil {
			return nil, err
		}
	}
	if a.waitForCancel {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	events := a.events
	if len(events) == 0 {
		events = []RuntimeEventRecord{{
			Type: "message_end",
			Payload: ama.JSON{
				"message": ama.JSON{"role": "assistant", "content": "runtime ok"},
			},
		}}
	}
	for _, event := range events {
		if err := write(event.Type, event.Payload); err != nil {
			return nil, err
		}
	}
	return a.result, a.err
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
	if len(client.creates) != 0 {
		t.Fatalf("expected existing runner id to skip registration, got %d registrations", len(client.creates))
	}
	if daemon.RunnerID != "runner_1" {
		t.Fatalf("expected configured runner id, got %q", daemon.RunnerID)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed update, got %#v", client.updates)
	}
	if len(client.events) != 2 {
		t.Fatalf("expected started and completed events, got %#v", client.events)
	}
}

func TestRunOnceRegistersRunnerWhenIDIsMissing(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease(), runnerID: "runner_registered"}
	adapter := &fakeAdapter{result: ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
	daemon := testDaemon(client, adapter)
	daemon.RunnerID = ""
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run once success, got %v", err)
	}
	if daemon.RunnerID != "runner_registered" {
		t.Fatalf("expected registered runner id, got %q", daemon.RunnerID)
	}
	if len(client.creates) != 1 {
		t.Fatalf("expected runner registration, got %#v", client.creates)
	}
	if got := client.creates[0].Metadata["runnerVersion"]; got != runnerVersion {
		t.Fatalf("expected runner version metadata %q, got %#v", runnerVersion, got)
	}
	if got := client.creates[0].Metadata["runnerCommit"]; got != runnerCommit {
		t.Fatalf("expected runner commit metadata %q, got %#v", runnerCommit, got)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed update, got %#v", client.updates)
	}
}

func TestRunnerIdentityStateUsesStateDirAndMachineID(t *testing.T) {
	stateDir := t.TempDir()
	workDir := t.TempDir()
	config := Config{
		Origin:        "https://ama.example.test",
		ProjectID:     "project_1",
		EnvironmentID: "env_1",
		StateDir:      stateDir,
		WorkDir:       workDir,
	}
	machineID, err := ensureMachineID(config)
	if err != nil {
		t.Fatalf("expected machine id, got %v", err)
	}
	if !strings.HasPrefix(machineID, "machine_") {
		t.Fatalf("unexpected machine id %q", machineID)
	}
	if err := storeRunnerID(config, "runner_1"); err != nil {
		t.Fatalf("expected runner id store success, got %v", err)
	}
	loadedRunnerID, err := loadStoredRunnerID(config)
	if err != nil {
		t.Fatalf("expected runner id load success, got %v", err)
	}
	if loadedRunnerID != "runner_1" {
		t.Fatalf("expected stored runner id, got %q", loadedRunnerID)
	}
	reloadedMachineID, err := ensureMachineID(config)
	if err != nil {
		t.Fatalf("expected machine id reload success, got %v", err)
	}
	if reloadedMachineID != machineID {
		t.Fatalf("expected stable machine id %q, got %q", machineID, reloadedMachineID)
	}
	if _, err := os.Stat(filepath.Join(workDir, runnerStateFileName)); !os.IsNotExist(err) {
		t.Fatalf("runner state should not be written to workdir, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, runnerStateFileName)); err != nil {
		t.Fatalf("expected runner state in state dir, got %v", err)
	}
}

func TestRunOnceOpensSessionChannelAndExecutesRuntimeCommand(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
		ama.JSON{
			"type":      "session.command",
			"sessionId": "session_1",
			"runnerId":  "runner_1",
			"leaseId":   "lease_1",
			"command": ama.JSON{
				"id":   "runnercmd_1",
				"type": "runtime.rpc",
				"path": "/rpc",
				"body": ama.JSON{
					"toolCalls": []ama.JSON{
						{"id": "call_1", "name": "sandbox.exec", "input": ama.JSON{"command": "printf ok"}},
					},
				},
			},
		},
		io.EOF,
	)
	client := &fakeControlPlane{lease: sessionStartLease(), channel: channel}
	adapter := &fakeAdapter{result: ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected session channel run success, got %v", err)
	}
	if client.opens != 1 {
		t.Fatalf("expected session channel open, got %d", client.opens)
	}
	if len(client.updates) != 0 {
		t.Fatalf("expected session ownership to stay active without completion patch, got %#v", client.updates)
	}
	got := channel.writtenEvents()
	want := []string{"runner.session.started", "tool_execution_start", "tool_execution_end"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected channel events %v, got %v", want, got)
	}
	channel.mu.Lock()
	completed := channel.writes[2]
	channel.mu.Unlock()
	event, _ := completed["event"].(map[string]any)
	payload, _ := event["payload"].(map[string]any)
	if _, ok := payload["durationMs"]; !ok {
		t.Fatalf("expected completed event to include top-level durationMs, got %#v", payload)
	}
	if !channel.closed {
		t.Fatal("expected session channel to close")
	}
}

func TestRunOnceFailsSessionChannelCommandOwnershipMismatch(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
		ama.JSON{
			"type":      "session.command",
			"sessionId": "session_other",
			"runnerId":  "runner_1",
			"leaseId":   "lease_1",
			"command": ama.JSON{
				"id":   "runnercmd_1",
				"type": "runtime.rpc",
				"path": "/rpc",
			},
		},
	)
	client := &fakeControlPlane{lease: sessionStartLease(), channel: channel}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "ownership mismatch") {
		t.Fatalf("expected ownership mismatch error, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	if !channel.closed {
		t.Fatal("expected mismatched session channel to close")
	}
}

func TestRunOnceCancelsSessionChannelWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	client := &fakeControlPlane{lease: sessionStartLease(), channel: channel}
	daemon := testDaemon(client, &fakeAdapter{})
	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(ctx)
	}()
	waitForRunnerWriteCount(t, channel, 1, done)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected cancellation update to succeed, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cancelled session channel")
	}
	if len(client.updates) != 1 || client.updates[0].State != "interrupted" {
		t.Fatalf("expected interrupted lease update, got %#v", client.updates)
	}
}

func TestRunOnceDispatchesCodexRuntimeThroughAdapterAndCompletesSessionLease(t *testing.T) {
	workDir := t.TempDir()
	prompt := "build the feature"
	lease := codexSessionStartLease(prompt)
	lease.workItem.Payload["agentSnapshot"] = ama.JSON{
		"instructions":   "Follow the AK worker protocol.",
		"skills":         []any{},
		"subagents":      []any{ama.JSON{"username": "reviewer", "role": "reviewer"}},
		"handoffPolicy":  ama.JSON{"enabled": true, "targets": []any{ama.JSON{"role": "reviewer"}}},
		"allowedTools":   []any{"sandbox.exec"},
		"mcpConnectors":  []any{},
		"capabilityTags": []any{"implementation"},
	}
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	client := &fakeControlPlane{lease: lease, channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0, "providerThreadId": "codex_thread_1"},
		inspect: func(request RuntimeRequest) error {
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "agent.json")); err != nil {
				return fmt.Errorf("expected agent snapshot manifest in workspace: %w", err)
			}
			systemPrompt, err := os.ReadFile(filepath.Join(request.WorkDir, ".ama", "system-prompt.md"))
			if err != nil || !strings.Contains(string(systemPrompt), "Follow the AK worker protocol.") || !strings.Contains(string(systemPrompt), "Available subagents: @reviewer (reviewer)") {
				return fmt.Errorf("expected agent system prompt manifest, got %q err=%v", string(systemPrompt), err)
			}
			return nil
		},
		events: []RuntimeEventRecord{
			{Type: "runtime.metadata", Payload: ama.JSON{"data": ama.JSON{"stage": "sdk_bridge_started", "status": "running"}}},
			{Type: "message_end", Payload: ama.JSON{"message": ama.JSON{"role": "assistant", "content": []any{ama.JSON{"type": "text", "text": "prompt:build the feature"}}}}},
			{Type: "tool_execution_start", Payload: ama.JSON{"toolCallId": "tool_1", "toolName": "sandbox.exec", "input": ama.JSON{"command": "printf ok"}}},
			{Type: "tool_execution_end", Payload: ama.JSON{"toolCallId": "tool_1", "toolName": "sandbox.exec", "output": ama.JSON{"stdout": "ok", "stderr": "", "exitCode": 0}, "durationMs": 3}},
			{Type: "usage", Payload: ama.JSON{"provider": "provider_codex", "model": "gpt-5.3-codex", "inputTokens": 4, "outputTokens": 5, "totalTokens": 9}},
			{Type: "runtime.output", Payload: ama.JSON{"stream": "bridge", "content": "diagnostic line"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected codex run success, got %v", err)
	}
	if runtimeAdapter.request.Runtime != "codex" ||
		runtimeAdapter.request.InitialPrompt != prompt ||
		runtimeAdapter.request.Provider != "provider_codex" ||
		runtimeAdapter.request.Model != "gpt-5.3-codex" {
		t.Fatalf("expected runtime request metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.WorkDir == workDir || !strings.HasSuffix(runtimeAdapter.request.WorkDir, filepath.Join("sessions", "session_1")) {
		t.Fatalf("expected isolated session workspace, got %q from root %q", runtimeAdapter.request.WorkDir, workDir)
	}
	if runtimeAdapter.request.RuntimeConfig["model"] != "gpt-5.3-codex" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if runtimeAdapter.request.AgentSnapshot["instructions"] != "Follow the AK worker protocol." {
		t.Fatalf("expected agent snapshot to reach adapter, got %#v", runtimeAdapter.request.AgentSnapshot)
	}
	if _, err := os.Stat(filepath.Join(runtimeAdapter.request.WorkDir, ".ama", "agent.json")); err != nil {
		t.Fatalf("expected completed session workspace to remain inspectable, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	if client.updates[0].Result["providerThreadId"] != "codex_thread_1" {
		t.Fatalf("expected adapter result to complete lease, got %#v", client.updates[0].Result)
	}
	if len(client.events) != 0 {
		t.Fatalf("expected codex session to write runtime events on channel without HTTP uploads, got %#v", client.events)
	}
	gotTypes := channel.writtenEvents()
	for _, want := range []string{
		"runner.session.started",
		"runtime.metadata",
		"message_end",
		"tool_execution_start",
		"tool_execution_end",
		"usage",
		"runtime.output",
	} {
		if !containsString(gotTypes, want) {
			t.Fatalf("expected channel/uploaded events to include %q, got %v", want, gotTypes)
		}
	}
	for _, message := range channel.writtenMessages() {
		if message["type"] != "runner.event" {
			t.Fatalf("expected codex event to use runner session channel envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
	if strings.Contains(serializedEvents, "AMA_TOKEN") {
		t.Fatalf("expected safe codex environment, got %s", serializedEvents)
	}
	if !strings.Contains(serializedEvents, "prompt:build the feature") ||
		!strings.Contains(serializedEvents, "provider_codex") ||
		!strings.Contains(serializedEvents, "gpt-5.3-codex") ||
		!strings.Contains(serializedEvents, "diagnostic line") {
		t.Fatalf("expected prompt/provider/model/stderr events, got %s", serializedEvents)
	}
}

func TestRunOnceFailsCodexLeaseOnRuntimeAdapterFailure(t *testing.T) {
	workDir := t.TempDir()
	lease := codexSessionStartLease("fail")
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	client := &fakeControlPlane{lease: lease, channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 7, "stderr": "bad failure"},
		err:    errors.New("codex SDK bridge failed"),
		events: []RuntimeEventRecord{
			{Type: "runtime.output", Payload: ama.JSON{"stream": "stderr", "content": "bad failure"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "codex SDK bridge failed") {
		t.Fatalf("expected codex bridge error after failed lease update, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	if len(client.events) != 0 {
		t.Fatalf("expected failed codex session to write runtime events on channel without HTTP uploads, got %#v", client.events)
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "codex SDK bridge failed") || !strings.Contains(serializedEvents, "bad failure") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
}

func TestRunOnceFailsCodexLeaseWhenSessionStartedChannelEventIsRejected(t *testing.T) {
	workDir := t.TempDir()
	lease := codexSessionStartLease("start")
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	channel.eventErrors = map[string]string{"runner.session.started": "start rejected"}
	client := &fakeControlPlane{lease: lease, channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "start rejected") {
		t.Fatalf("expected session started channel rejection, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	if len(channel.writtenEvents()) != 1 || channel.writtenEvents()[0] != "runner.session.started" {
		t.Fatalf("expected only acknowledged session started write before failure, got %v", channel.writtenEvents())
	}
	if runtimeAdapter.request.SessionID != "" {
		t.Fatalf("expected runtime adapter not to run after start rejection, got %#v", runtimeAdapter.request)
	}
}

func TestCodexSessionWorkspaceRejectsTraversalBeforeCreatingDirectory(t *testing.T) {
	workDir := t.TempDir()
	_, err := runtimeWorkspace(workDir, "../outside-session")
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected session id validation error, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(workDir, "..", "outside-session")); !os.IsNotExist(statErr) {
		t.Fatalf("expected no directory outside workspace, stat error %v", statErr)
	}
	_, err = runtimeWorkspace(workDir, "..")
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected parent segment validation error, got %v", err)
	}
}

func TestAcknowledgedChannelEventFailsOnUnscopedChannelError(t *testing.T) {
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.error", "message": "previous event rejected"})
	daemon := testDaemon(&fakeControlPlane{}, &fakeAdapter{})
	err := daemon.writeAcknowledgedChannelEvent(context.Background(), channel, "runtime.metadata", ama.JSON{"status": "started"})
	if err == nil || !strings.Contains(err.Error(), "previous event rejected") {
		t.Fatalf("expected unscoped channel error, got %v", err)
	}
}

func TestSessionStartFailsLeaseWhenChannelOpenFails(t *testing.T) {
	client := &fakeControlPlane{lease: sessionStartLease(), channelErr: errors.New("channel failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "channel failed") {
		t.Fatalf("expected channel error, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed session.start lease, got %#v", client.updates)
	}
}

func TestRunOnceLaunchesClaudeCodeRuntimeAndCompletesLease(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	client := &fakeControlPlane{lease: claudeCodeSessionStartLease(), channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected claude runtime success, got %v", err)
	}
	if runtimeAdapter.request.InitialPrompt != "Run Claude Code" {
		t.Fatalf("expected prompt to reach runtime adapter, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.Provider != "anthropic" || runtimeAdapter.request.Model != "claude-sonnet-4-6" {
		t.Fatalf("expected provider/model metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.RuntimeConfig["permissionMode"] != "acceptEdits" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	got := channel.writtenEvents()
	want := []string{"runner.session.started", "message_end"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected channel events %v, got %v", want, got)
	}
}

func TestRunOnceCompletesExternalRuntimeWhenSuccessfulResultHasCompletionWarning(t *testing.T) {
	for name, result := range map[string]ama.JSON{
		"top-level-exit-code":     {"exitCode": 0},
		"nested-output-exit-code": {"output": ama.JSON{"exitCode": 0}},
	} {
		t.Run(name, func(t *testing.T) {
			channel := newFakeRunnerSessionChannel(
				ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
			)
			client := &fakeControlPlane{lease: claudeCodeSessionStartLease(), channel: channel}
			runtimeAdapter := &fakeRuntimeAdapter{
				result: result,
				err:    errors.New("failed to get reader: failed to read frame header: EOF"),
			}
			daemon := testDaemon(client, &fakeAdapter{})
			daemon.RuntimeAdapter = runtimeAdapter

			if err := daemon.RunOnce(context.Background()); err != nil {
				t.Fatalf("expected successful runtime result to complete despite warning, got %v", err)
			}
			if len(client.updates) != 1 || client.updates[0].State != "completed" {
				t.Fatalf("expected completed lease update, got %#v", client.updates)
			}
			serializedResult := mustJSON(t, client.updates[0].Result)
			if !strings.Contains(serializedResult, "completionWarning") {
				t.Fatalf("expected completion warning in result, got %s", serializedResult)
			}
		})
	}
}

func TestRunOnceWaitsForRuntimeEventAcknowledgementBeforeCompletingLease(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	channel.autoAck = false
	client := &fakeControlPlane{lease: claudeCodeSessionStartLease(), channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter

	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(context.Background())
	}()

	startEventID := waitForRunnerWriteID(t, channel, 1, done)
	channel.push(ama.JSON{"type": "runner.event.accepted", "eventId": startEventID})
	runtimeEventID := waitForRunnerWriteID(t, channel, 2, done)

	client.mu.Lock()
	updateCount := len(client.updates)
	client.mu.Unlock()
	if updateCount != 0 {
		t.Fatalf("expected lease completion to wait for event acknowledgement, got updates %#v", client.updates)
	}

	channel.push(ama.JSON{"type": "runner.event.accepted", "eventId": runtimeEventID})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected run success after acknowledgement, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for run completion after acknowledgement")
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed lease update after acknowledgement, got %#v", client.updates)
	}
}

func TestRunOnceFailsLeaseWhenRuntimeEventAcknowledgementRejects(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	channel.autoAck = false
	client := &fakeControlPlane{lease: claudeCodeSessionStartLease(), channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter

	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(context.Background())
	}()

	startEventID := waitForRunnerWriteID(t, channel, 1, done)
	channel.push(ama.JSON{"type": "runner.event.accepted", "eventId": startEventID})
	runtimeEventID := waitForRunnerWriteID(t, channel, 2, done)
	channel.push(ama.JSON{"type": "session.channel.error", "eventId": runtimeEventID, "message": "append failed"})
	errorEventID := waitForRunnerWriteID(t, channel, 3, done)
	channel.push(ama.JSON{"type": "runner.event.accepted", "eventId": errorEventID})

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "runner session channel rejected event") {
			t.Fatalf("expected rejected runtime event error, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for run failure after rejected event")
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update after rejected event, got %#v", client.updates)
	}
	got := channel.writtenEvents()
	want := []string{"runner.session.started", "message_end", "runtime.error"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected channel events %v, got %v", want, got)
	}
}

func waitForRunnerWriteID(t *testing.T, channel *fakeRunnerSessionChannel, count int, done <-chan error) string {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		if channel.writeCount() >= count {
			if eventID := channel.lastWriteEventID(); eventID != "" {
				return eventID
			}
		}
		select {
		case err := <-done:
			t.Fatalf("run finished before write %d: %v", count, err)
		case <-deadline:
			t.Fatalf("timed out waiting for write %d", count)
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func waitForRunnerWriteCount(t *testing.T, channel *fakeRunnerSessionChannel, count int, done <-chan error) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		if channel.writeCount() >= count {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("run finished before write %d: %v", count, err)
		case <-deadline:
			t.Fatalf("timed out waiting for write %d", count)
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func TestStartRegistersRunnerAndSendsOfflineHeartbeatOnShutdown(t *testing.T) {
	client := &fakeControlPlane{runnerID: "runner_registered"}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	daemon.RunnerID = ""
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
	if got := client.heartbeats[len(client.heartbeats)-1].State; got != "offline" {
		t.Fatalf("expected offline shutdown heartbeat, got %q", got)
	}
	if got := client.heartbeats[0].Metadata["runnerVersion"]; got != runnerVersion {
		t.Fatalf("expected runner version heartbeat metadata %q, got %#v", runnerVersion, got)
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
			daemon.RunnerID = ""
			err := daemon.Start(context.Background())
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
		})
	}
}

func TestStartContinuesAfterLeasePollingErrors(t *testing.T) {
	client := &fakeControlPlane{claimErr: errors.New("claim failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.PollInterval = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		claims := client.claims
		client.mu.Unlock()
		if claims >= 2 {
			cancel()
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for runner to continue after claim errors")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after continued polling, got %v", err)
	}
}

func TestStartClaimsUpToMaxConcurrentLeases(t *testing.T) {
	client := &fakeControlPlane{lease: approvedLease()}
	adapter := &fakeAdapter{waitForCancel: true}
	daemon := testDaemon(client, adapter)
	daemon.Config.MaxConcurrent = 3
	daemon.Config.PollInterval = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		claims := client.claims
		client.mu.Unlock()
		if claims >= 3 {
			cancel()
			break
		}
		select {
		case err := <-done:
			t.Fatalf("runner exited before claiming concurrent leases: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for concurrent lease claims")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after concurrent leases, got %v", err)
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
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
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

func TestRunOnceSessionStartCancelsLeaseWhenContextCancels(t *testing.T) {
	lease := approvedLease()
	lease.workItem.Type = "session.start"
	lease.workItem.Payload = sessionStartLease().workItem.Payload
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	client := &fakeControlPlane{lease: lease, channel: channel}
	daemon := testDaemon(client, &fakeAdapter{})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(ctx)
	}()
	time.Sleep(5 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("expected cancellation update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "interrupted" {
		t.Fatalf("expected interrupted update, got %#v", client.updates)
	}
	if !channel.closed {
		t.Fatal("expected channel to close on context cancellation")
	}
}

func TestRunOnceFailsFastOnUnapprovedWorkAfterMarkingLeaseFailed(t *testing.T) {
	lease := approvedLease()
	lease.workItem.Payload["approved"] = false
	client := &fakeControlPlane{lease: lease}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected unapproved work error, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestRunOnceFailsLeaseWhenRequiredCapabilityDoesNotMatch(t *testing.T) {
	lease := sessionStartLease()
	lease.workItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:codex:provider:gpt-5.3-codex"
	client := &fakeControlPlane{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected failed lease update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	message, _ := client.updates[0].Error["message"].(string)
	if !strings.Contains(message, "required capability") {
		t.Fatalf("expected capability error, got %#v", client.updates[0].Error)
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
	if !adapter.cancelled.Load() {
		t.Fatal("expected renew failure to cancel adapter context")
	}
	if len(client.updates) != 1 || client.updates[0].State != "active" {
		t.Fatalf("expected only renew update, got %#v", client.updates)
	}
}

func TestSessionChannelRenewalFailureClosesChannelWithoutCompletion(t *testing.T) {
	channel := newFakeRunnerSessionChannel(ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"})
	client := &fakeControlPlane{lease: sessionStartLease(), channel: channel, updateErr: errors.New("lease lost")}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.RenewInterval = time.Millisecond
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "runner lease renewal failed") {
		t.Fatalf("expected renew failure, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "active" {
		t.Fatalf("expected only renew update, got %#v", client.updates)
	}
	if !channel.closed {
		t.Fatal("expected renewal failure to close channel")
	}
}

func TestAMASessionChecksLeaseRenewalAfterHandlingCommand(t *testing.T) {
	renewErr := errors.New("renewal stopped after command")
	channel := newFakeRunnerSessionChannel(
		ama.JSON{
			"type":      "session.command",
			"sessionId": "session_1",
			"runnerId":  "runner_1",
			"leaseId":   "lease_1",
			"command": ama.JSON{
				"id":   "runnercmd_1",
				"type": "runtime.rpc",
				"path": "/rpc",
				"body": ama.JSON{
					"toolCalls": []ama.JSON{
						{"id": "call_1", "name": "sandbox.exec", "input": ama.JSON{"command": "printf ok"}},
					},
				},
			},
		},
		io.EOF,
	)
	lease := sessionStartLease()
	daemon := testDaemon(&fakeControlPlane{}, &fakeAdapter{result: ToolResult{Output: ama.JSON{"stdout": "ok"}}})
	daemon.RunnerID = "runner_1"

	err := daemon.runAMASession(sessionRuntimeExecution{
		RequestContext: context.Background(),
		LeaseContext:   context.Background(),
		Channel:        channel,
		Lease:          lease.lease,
		Payload: WorkPayload{
			SessionID: "session_1",
		},
		CheckRenewal: func() error {
			return renewErr
		},
	})
	if !errors.Is(err, renewErr) {
		t.Fatalf("expected renewal check error after handled command, got %v", err)
	}
	if got := channel.writtenEvents(); strings.Join(got, ",") != "tool_execution_start,tool_execution_end" {
		t.Fatalf("expected command events before renewal error, got %v", got)
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
	if len(client.updates) != 1 || client.updates[0].State != "cancelled" {
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
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "cloud"},
		{"protocol": "ama-runner-work", "approved": true, "toolName": "sandbox.exec", "input": map[string]any{}},
	}
	for _, payload := range tests {
		if _, err := parseWorkPayload(payload); err == nil {
			t.Fatalf("expected payload error for %#v", payload)
		}
	}
}

func testDaemon(client *fakeControlPlane, adapter SandboxAdapter) RunnerDaemon {
	workDir, err := os.MkdirTemp("", "ama-runner-test-*")
	if err != nil {
		panic(err)
	}
	return RunnerDaemon{
		Config: Config{
			SandboxAdapter:        processUnsafeAdapter,
			StateDir:              workDir,
			WorkDir:               workDir,
			MaxConcurrent:         1,
			PollInterval:          time.Second,
			HeartbeatInterval:     time.Second,
			LeaseDurationSeconds:  60,
			RenewInterval:         time.Hour,
			CommandTimeout:        time.Second,
			ShutdownGraceInterval: time.Millisecond,
		},
		Client:   client,
		Channels: client,
		Adapter:  adapter,
		LookPath: lookPathFinding("claude", "codex", "copilot"),
		// Runtime probing spawns the embedded bridge; tests stay hermetic by
		// failing enumeration so capabilities use the pinned fallback models.
		DetectRuntime: func(context.Context, string) runtimeProbe { return runtimeProbe{} },
		RunnerID:      "runner_1",
	}
}

// lookPathFinding fakes exec.LookPath so capability detection in tests does
// not depend on which CLIs are installed on the host running the tests.
func lookPathFinding(binaries ...string) func(string) (string, error) {
	return func(binary string) (string, error) {
		for _, candidate := range binaries {
			if candidate == binary {
				return "/usr/local/bin/" + binary, nil
			}
		}
		return "", fmt.Errorf("%s not found on PATH", binary)
	}
}

func approvedLease() *fakeWork {
	return &fakeWork{
		lease: &Lease{
			ID:         "lease_1",
			WorkItemID: "work_1",
			RunnerID:   "runner_1",
			State:      "active",
		},
		workItem: &WorkItem{
			ID:        "work_1",
			SessionID: "session_1",
			Type:      "tool.execute",
			State:     "leased",
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

func sessionStartLease() *fakeWork {
	return &fakeWork{
		lease: &Lease{
			ID:         "lease_1",
			WorkItemID: "work_1",
			RunnerID:   "runner_1",
			State:      "active",
		},
		workItem: &WorkItem{
			ID:        "work_1",
			SessionID: "session_1",
			Type:      "session.start",
			State:     "leased",
			Payload: ama.JSON{
				"protocol":                 "ama-runner-work",
				"type":                     "session.start",
				"sessionId":                "session_1",
				"hostingMode":              "self_hosted",
				"runtime":                  "ama",
				"runtimeConfig":            map[string]any{},
				"provider":                 "workers-ai",
				"model":                    "@cf/moonshotai/kimi-k2.6",
				"runtimeDriver":            "ama-self-hosted",
				"requiredRunnerCapability": defaultRuntimeProviderModelCapability,
			},
		},
	}
}

func codexSessionStartLease(prompt string) *fakeWork {
	work := sessionStartLease()
	work.workItem.Payload["runtime"] = "codex"
	work.workItem.Payload["runtimeConfig"] = map[string]any{"model": "gpt-5.3-codex", "sandboxMode": "workspace-write"}
	work.workItem.Payload["provider"] = "provider_codex"
	work.workItem.Payload["model"] = "gpt-5.3-codex"
	work.workItem.Payload["runtimeDriver"] = "codex-self-hosted"
	work.workItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:codex:*:gpt-5.3-codex"
	work.workItem.Payload["initialPrompt"] = prompt
	return work
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func claudeCodeSessionStartLease() *fakeWork {
	work := externalRuntimeSessionStartLease("claude-code", "anthropic", "claude-sonnet-4-6", map[string]any{"permissionMode": "acceptEdits"})
	work.workItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:claude-code:*:claude-sonnet-4-6"
	work.workItem.Payload["initialPrompt"] = "Run Claude Code"
	return work
}

func externalRuntimeSessionStartLease(runtimeName string, provider string, model string, runtimeConfig any) *fakeWork {
	work := sessionStartLease()
	work.workItem.Payload["runtime"] = runtimeName
	if config, ok := runtimeConfig.(map[string]any); ok {
		work.workItem.Payload["runtimeConfig"] = config
	} else {
		work.workItem.Payload["runtimeConfig"] = map[string]any{"mode": runtimeConfig}
	}
	work.workItem.Payload["provider"] = provider
	work.workItem.Payload["model"] = model
	work.workItem.Payload["runtimeDriver"] = runtimeName + "-self-hosted"
	work.workItem.Payload["initialPrompt"] = "Run external runtime"
	work.workItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:" + runtimeName + ":" + provider + ":" + model
	return work
}

func TestHeartbeatRefreshesRuntimeCapabilitiesFromPath(t *testing.T) {
	client := &fakeControlPlane{}
	daemon := testDaemon(client, &fakeAdapter{})
	var available atomic.Value
	available.Store([]string{"codex"})
	daemon.LookPath = func(binary string) (string, error) {
		return lookPathFinding(available.Load().([]string)...)(binary)
	}
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	first := client.heartbeats[0].Capabilities
	if !containsString(first, "codex") || !containsString(first, "runtime-provider-model:codex:*:gpt-5.3-codex") {
		t.Fatalf("expected codex capabilities, got %v", first)
	}
	if containsString(first, "claude-code") || containsString(first, "copilot") {
		t.Fatalf("expected missing CLIs to be excluded, got %v", first)
	}

	available.Store([]string{"codex", "claude"})
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	second := client.heartbeats[1].Capabilities
	if !containsString(second, "claude-code") || !containsString(second, "runtime-provider-model:claude-code:*:claude-sonnet-4-6") {
		t.Fatalf("expected claude-code capabilities after installing the CLI, got %v", second)
	}
}

func TestHeartbeatAdvertisesEnumeratedHostModelsAndCachesPerProcess(t *testing.T) {
	client := &fakeControlPlane{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.LookPath = lookPathFinding("codex")
	detectCalls := map[string]int{}
	daemon.DetectRuntime = func(_ context.Context, runtimeName string) runtimeProbe {
		detectCalls[runtimeName]++
		if runtimeName == "codex" {
			return runtimeProbe{
				Models:  []string{"gpt-5.3-codex", "gpt-5.3-codex-mini"},
				Status:  "ready",
				Version: "0.42.0",
				Detail:  "host CLI enumerated 2 models",
			}
		}
		return runtimeProbe{}
	}
	for range 2 {
		if err := daemon.heartbeat(context.Background()); err != nil {
			t.Fatalf("expected heartbeat success, got %v", err)
		}
	}
	for _, heartbeat := range client.heartbeats {
		capabilities := heartbeat.Capabilities
		if !containsString(capabilities, "codex") ||
			!containsString(capabilities, "runtime-provider-model:codex:*:gpt-5.3-codex") ||
			!containsString(capabilities, "runtime-provider-model:codex:*:gpt-5.3-codex-mini") {
			t.Fatalf("expected enumerated codex model capabilities, got %v", capabilities)
		}
	}
	if detectCalls["codex"] != 1 {
		t.Fatalf("expected model enumeration to be cached per process, got %d calls", detectCalls["codex"])
	}
}

func TestHeartbeatReportsRuntimeInventoryWithStatusAndDiagnostics(t *testing.T) {
	client := &fakeControlPlane{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.LookPath = lookPathFinding("codex", "claude")
	daemon.DetectRuntime = func(_ context.Context, runtimeName string) runtimeProbe {
		if runtimeName == "codex" {
			return runtimeProbe{Models: []string{"gpt-5.3-codex"}, Status: "ready", Version: "0.42.0", Detail: "host CLI enumerated 1 models"}
		}
		return runtimeProbe{Status: "unauthenticated", Detail: "host CLI exposed no models; authenticate the runtime CLI"}
	}
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	inventory := client.heartbeats[0].RuntimeInventory
	byRuntime := map[string]v1RuntimeInventory{}
	for _, entry := range inventory {
		byRuntime[entry.Runtime] = entry
	}
	if got := byRuntime["ama"]; got.State != "ready" || got.Version != runnerVersion {
		t.Fatalf("expected embedded ama runtime to be ready with runner version, got %#v", got)
	}
	if got := byRuntime["codex"]; got.State != "ready" || got.Version != "0.42.0" || got.Detail == "" {
		t.Fatalf("expected ready codex inventory with version and detail, got %#v", got)
	}
	if got := byRuntime["claude-code"]; got.State != "unauthenticated" || got.Detail == "" {
		t.Fatalf("expected unauthenticated claude-code inventory, got %#v", got)
	}
	if got := byRuntime["copilot"]; got.State != "missing" || got.Detail == "" {
		t.Fatalf("expected missing copilot inventory, got %#v", got)
	}
	if data := mustJSON(t, inventory); strings.Contains(data, "raw-secret") {
		t.Fatalf("expected inventory to carry only safe metadata, got %s", data)
	}
}

func TestHeartbeatAdvertisesNoExternalRuntimesWhenNoCLIsAreInstalled(t *testing.T) {
	client := &fakeControlPlane{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.LookPath = lookPathFinding()
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	got := client.heartbeats[0].Capabilities
	want := []string{"sandbox.exec", "ama", defaultRuntimeProviderModelCapability}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected only base capabilities %v, got %v", want, got)
	}
}

func TestRunOnceFailsLeaseWhenRuntimeCLIIsMissing(t *testing.T) {
	lease := codexSessionStartLease("build")
	client := &fakeControlPlane{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.LookPath = lookPathFinding("claude", "copilot")
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected failed lease update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	message, _ := client.updates[0].Error["message"].(string)
	if !strings.Contains(message, "required capability") {
		t.Fatalf("expected capability error for missing codex CLI, got %#v", client.updates[0].Error)
	}
}

func TestRunOnceFailsLeaseWhenSessionExceedsMaxDuration(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	client := &fakeControlPlane{lease: codexSessionStartLease("runaway"), channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{waitForCancel: true}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.MaxSessionDuration = 20 * time.Millisecond

	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "exceeded max duration") {
		t.Fatalf("expected session timeout error, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed (not interrupted) lease update, got %#v", client.updates)
	}
	message, _ := client.updates[0].Error["message"].(string)
	if !strings.Contains(message, "session exceeded max duration") {
		t.Fatalf("expected explicit timeout message, got %#v", client.updates[0].Error)
	}
	serializedEvents := mustJSON(t, channel.writtenMessages())
	if !strings.Contains(serializedEvents, "session_timeout") {
		t.Fatalf("expected session_timeout runtime.error event, got %s", serializedEvents)
	}
}

func TestRunOnceDisablesSessionDeadlineWhenMaxDurationIsZero(t *testing.T) {
	channel := newFakeRunnerSessionChannel(
		ama.JSON{"type": "session.channel.accepted", "sessionId": "session_1"},
	)
	client := &fakeControlPlane{lease: codexSessionStartLease("build"), channel: channel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.MaxSessionDuration = 0
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run success with disabled session deadline, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
}

func TestLeasePollDelayBacksOffAndCaps(t *testing.T) {
	base := 2 * time.Second
	if got := leasePollDelay(base, 0); got != base {
		t.Fatalf("no failures should keep the base delay, got %v", got)
	}
	if got := leasePollDelay(base, 1); got != 4*time.Second {
		t.Fatalf("one failure should double the delay, got %v", got)
	}
	if got := leasePollDelay(base, 3); got != 16*time.Second {
		t.Fatalf("three failures should give 16s, got %v", got)
	}
	if got := leasePollDelay(base, 50); got != leaseClaimBackoffCap {
		t.Fatalf("many failures should cap at %v, got %v", leaseClaimBackoffCap, got)
	}
	if got := leasePollDelay(time.Hour, 2); got != leaseClaimBackoffCap {
		t.Fatalf("overflowing delay should cap at %v, got %v", leaseClaimBackoffCap, got)
	}
}
