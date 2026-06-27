package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/controlplane"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/hostruntime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runtimeworkspace "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const amaSandboxCapability = "ama-sandbox"

// fakeWork pairs a v1 lease with the work item the runner fetches after
// claiming it; the lease no longer embeds the work item.
type fakeWork struct {
	lease    *controlplane.Lease
	workItem *controlplane.WorkItem
}

type fakeControlPlane struct {
	mu           sync.Mutex
	creates      []ama.CreateRunnerRequest
	heartbeats   []controlplane.PutRunnerHeartbeatRequest
	updates      []controlplane.UpdateLeaseRequest
	events       [][]controlplane.SessionEvent
	lease        *fakeWork
	runnerID     string
	claims       int
	healthErr    error
	createErr    error
	heartbeatErr error
	claimErr     error
	eventErr     error
	updateErr    error
	hubChannel   *fakeRunnerSessionChannel
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

func (f *fakeControlPlane) PutRunnerHeartbeat(_ context.Context, _ string, body controlplane.PutRunnerHeartbeatRequest) error {
	if f.heartbeatErr != nil {
		return f.heartbeatErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.heartbeats = append(f.heartbeats, body)
	return nil
}

func (f *fakeControlPlane) ListAvailableWorkItems(context.Context) ([]controlplane.WorkItem, error) {
	f.mu.Lock()
	f.claims += 1
	f.mu.Unlock()
	if f.claimErr != nil {
		return nil, f.claimErr
	}
	if f.lease == nil {
		return nil, nil
	}
	return []controlplane.WorkItem{*f.lease.workItem}, nil
}

func (f *fakeControlPlane) CreateLease(context.Context, controlplane.CreateLeaseRequest) (*controlplane.Lease, error) {
	if f.lease == nil {
		return nil, fmt.Errorf("no work item to lease")
	}
	return f.lease.lease, nil
}

func (f *fakeControlPlane) ReadWorkItem(context.Context, string) (*controlplane.WorkItem, error) {
	if f.lease == nil {
		return nil, fmt.Errorf("work item not found")
	}
	return f.lease.workItem, nil
}

func (f *fakeControlPlane) UpdateLease(_ context.Context, _ string, body controlplane.UpdateLeaseRequest) (*controlplane.Lease, error) {
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

func (f *fakeControlPlane) CreateSessionEvents(_ context.Context, _ string, events []controlplane.SessionEvent) error {
	if f.eventErr != nil {
		return f.eventErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, events)
	return nil
}

func (f *fakeControlPlane) OpenRunnerChannel(context.Context, string) (RunnerSessionChannel, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opens += 1
	if f.channelErr != nil {
		return nil, f.channelErr
	}
	if f.hubChannel == nil {
		f.hubChannel = newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	}
	return f.hubChannel, nil
}

type fakeAdapter struct {
	waitForCancel bool
	result        sandbox.ToolResult
	err           error
	cancelled     atomic.Bool
}

type fakeRuntimeAdapter struct {
	request       hostruntime.Request
	events        []RuntimeEventRecord
	result        ama.JSON
	err           error
	inspect       func(hostruntime.Request) error
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

func (a *fakeAdapter) Execute(ctx context.Context, _ sandbox.ToolRequest) (sandbox.ToolResult, error) {
	if !a.waitForCancel {
		return a.result, a.err
	}
	<-ctx.Done()
	a.cancelled.Store(true)
	return sandbox.ToolResult{}, ctx.Err()
}

func (a *fakeRuntimeAdapter) Run(ctx context.Context, request hostruntime.Request, write hostruntime.EventWriter) (ama.JSON, error) {
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
	adapter := &fakeAdapter{result: sandbox.ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
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
	adapter := &fakeAdapter{result: sandbox.ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
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
	config := runnerconfig.Config{
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

// AMA no longer hosts its full loop inside the runner. For AMA sessions, the
// cloud loop sends sandbox tool requests over the runner channel; external
// runtimes still run through the bridge subprocess. The old runner-local AMA
// full-loop path is intentionally absent from the full-flow tests.

func TestRunOnceCancelsSessionChannelWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	// All runtimes now relay over the per-runner hub channel. Seed it so the hub
	// connects immediately and the relay path is live when the session starts.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: codexSessionStartLease("run until cancelled"), hubChannel: hubChannel}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.LookPath = lookPathFinding("codex")
	// External runtimes run via the bridge runtime adapter; block it until the run context is
	// cancelled so this exercises the channel cancellation path.
	runtimeAdapter := &fakeRuntimeAdapter{waitForCancel: true}
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(ctx)
	}()
	waitForRuntimeRequest(t, runtimeAdapter, done)
	cancel()
	select {
	case err := <-done:
		// The bridge runtime adapter surfaces the cancellation as ctx.Err();
		// the lease is still finalized as interrupted for server-side resume.
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation to succeed or report context cancellation, got %v", err)
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
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel,
	// not a per-lease channel. Seed the hub channel with runner.channel.accepted
	// so the hub connects without delay.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: lease, hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0, "providerThreadId": "codex_thread_1"},
		inspect: func(request hostruntime.Request) error {
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "agent.json")); !os.IsNotExist(err) {
				return fmt.Errorf("expected no agent snapshot manifest in workspace, got err=%v", err)
			}
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "system-prompt.md")); !os.IsNotExist(err) {
				return fmt.Errorf("expected no system prompt file in workspace, got err=%v", err)
			}
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "resources.json")); !os.IsNotExist(err) {
				return fmt.Errorf("expected no resource manifest in workspace, got err=%v", err)
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
	// Run in a goroutine: the hub connects asynchronously, so wait for relay
	// events to appear on hubChannel before asserting.
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least runner.session.started to be relayed over the hub channel.
	waitForRunnerWriteCount(t, hubChannel, 1, done)
	if err := <-done; err != nil {
		t.Fatalf("expected codex run success, got %v", err)
	}
	if runtimeAdapter.request.Runtime != "codex" ||
		runtimeAdapter.request.InitialPrompt != prompt ||
		runtimeAdapter.request.Provider != "provider_codex" ||
		runtimeAdapter.request.Model != "gpt-5.3-codex" {
		t.Fatalf("expected runtime request metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.WorkDir == workDir || !strings.HasSuffix(runtimeAdapter.request.WorkDir, filepath.Join("sessions", "session_1", "workspace")) {
		t.Fatalf("expected isolated session workspace, got %q from root %q", runtimeAdapter.request.WorkDir, workDir)
	}
	if runtimeAdapter.request.RuntimeConfig["model"] != "gpt-5.3-codex" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if runtimeAdapter.request.AgentSnapshot["instructions"] != "Follow the AK worker protocol." {
		t.Fatalf("expected agent snapshot to reach adapter, got %#v", runtimeAdapter.request.AgentSnapshot)
	}
	if _, err := os.Stat(runtimeAdapter.request.WorkDir); err != nil {
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
	gotTypes := hubChannel.writtenEvents()
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
	for _, message := range hubChannel.writtenMessages() {
		if message["type"] != "runner.event" {
			t.Fatalf("expected codex event to use runner session channel envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if strings.Contains(serializedEvents, "AMA_TOKEN") {
		t.Fatalf("expected safe codex environment, got %s", serializedEvents)
	}
	if !strings.Contains(serializedEvents, "prompt:build the feature") ||
		!strings.Contains(serializedEvents, `"role":"user"`) ||
		!strings.Contains(serializedEvents, `"text":"build the feature"`) ||
		!strings.Contains(serializedEvents, "provider_codex") ||
		!strings.Contains(serializedEvents, "gpt-5.3-codex") ||
		!strings.Contains(serializedEvents, "diagnostic line") {
		t.Fatalf("expected prompt/provider/model/stderr events, got %s", serializedEvents)
	}
}

func TestRunOnceCompletesSessionLeaseWithWritableMemoryStoreSnapshot(t *testing.T) {
	workDir := t.TempDir()
	lease := codexSessionStartLease("update the heartbeat")
	lease.workItem.Payload["resourceRefs"] = []any{ama.JSON{
		"type":      "memory_store",
		"storeId":   "memstore_1",
		"name":      "Maintainer memory",
		"access":    "read_write",
		"mountPath": "/workspace/.ama/memory-stores/memstore_1",
		"memories": []any{ama.JSON{
			"path":    "ak-maintainer-heartbeat.md",
			"content": "initial heartbeat\n",
		}},
	}}
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: lease, hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0},
		inspect: func(request hostruntime.Request) error {
			memoryPath := filepath.Join(request.WorkDir, ".ama", "memory-stores", "memstore_1", "ak-maintainer-heartbeat.md")
			data, err := os.ReadFile(memoryPath)
			if err != nil {
				return err
			}
			if string(data) != "initial heartbeat\n" {
				return fmt.Errorf("expected initial memory content, got %q", string(data))
			}
			return os.WriteFile(memoryPath, []byte("updated heartbeat\n"), 0o644)
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	waitForRunnerWriteCount(t, hubChannel, 1, done)
	if err := <-done; err != nil {
		t.Fatalf("expected codex run success, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	stores, ok := client.updates[0].Result["memoryStores"].([]runtimeworkspace.MemoryStoreSnapshot)
	if !ok || len(stores) != 1 {
		t.Fatalf("expected memoryStores result, got %#v", client.updates[0].Result)
	}
	if stores[0].StoreID != "memstore_1" || len(stores[0].Memories) != 1 {
		t.Fatalf("expected one memstore snapshot, got %#v", stores)
	}
	if got := stores[0].Memories[0]; got.Path != "ak-maintainer-heartbeat.md" || got.Content != "updated heartbeat\n" {
		t.Fatalf("expected updated memory content, got %#v", got)
	}
}

func TestRunOnceFailsCodexLeaseOnRuntimeAdapterFailure(t *testing.T) {
	workDir := t.TempDir()
	lease := codexSessionStartLease("fail")
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: lease, hubChannel: hubChannel}
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
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least runner.session.started + runtime.error to be relayed.
	waitForRunnerWriteCount(t, hubChannel, 2, done)
	if err := <-done; err == nil || !strings.Contains(err.Error(), "codex SDK bridge failed") {
		t.Fatalf("expected codex bridge error after failed lease update, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	if len(client.events) != 0 {
		t.Fatalf("expected failed codex session to write runtime events on channel without HTTP uploads, got %#v", client.events)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "codex SDK bridge failed") || !strings.Contains(serializedEvents, "bad failure") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
}

func TestCodexSessionWorkspaceRejectsTraversalBeforeCreatingDirectory(t *testing.T) {
	workDir := t.TempDir()
	_, err := hostruntime.Workspace(workDir, "../outside-session")
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected session id validation error, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(workDir, "..", "outside-session")); !os.IsNotExist(statErr) {
		t.Fatalf("expected no directory outside workspace, stat error %v", statErr)
	}
	_, err = hostruntime.Workspace(workDir, "..")
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected parent segment validation error, got %v", err)
	}
}

func TestRunOnceLaunchesClaudeCodeRuntimeAndCompletesLease(t *testing.T) {
	// Claude-code is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: claudeCodeSessionStartLease(), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least runner.session.started + message_end to be relayed.
	waitForRunnerWriteCount(t, hubChannel, 2, done)
	if err := <-done; err != nil {
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
	got := hubChannel.writtenEvents()
	want := []string{"runner.session.started", "message_end", "message_end"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected channel events %v, got %v", want, got)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, `"role":"user"`) || !strings.Contains(serializedEvents, `"text":"Run Claude Code"`) {
		t.Fatalf("expected initial prompt to be recorded as a user event, got %s", serializedEvents)
	}
}

func TestRunOnceCompletesExternalRuntimeWhenSuccessfulResultHasCompletionWarning(t *testing.T) {
	for name, result := range map[string]ama.JSON{
		"top-level-exit-code":     {"exitCode": 0},
		"nested-output-exit-code": {"output": ama.JSON{"exitCode": 0}},
	} {
		t.Run(name, func(t *testing.T) {
			// All runtimes relay over the per-runner hub channel. Seed it so the hub
			// connects immediately.
			hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
			client := &fakeControlPlane{lease: claudeCodeSessionStartLease(), hubChannel: hubChannel}
			runtimeAdapter := &fakeRuntimeAdapter{
				result: result,
				err:    errors.New("failed to get reader: failed to read frame header: EOF"),
			}
			daemon := testDaemon(client, &fakeAdapter{})
			daemon.RuntimeAdapter = runtimeAdapter

			done := make(chan error, 1)
			go func() { done <- daemon.RunOnce(context.Background()) }()
			// Wait for runner.session.started + message_end before asserting completion.
			waitForRunnerWriteCount(t, hubChannel, 2, done)
			if err := <-done; err != nil {
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

func waitForRuntimeRequest(t *testing.T, adapter *fakeRuntimeAdapter, done <-chan error) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		if adapter.request.SessionID != "" {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("run finished before runtime request: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for runtime request")
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
		result: sandbox.ToolResult{Output: map[string]any{"stdout": "", "stderr": "no", "exitCode": 2}},
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
	payload, err := protocol.ParseWorkPayload(ama.JSON{
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
	_, err = protocol.ParseWorkPayload(ama.JSON{
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
		if _, err := protocol.ParseWorkPayload(payload); err == nil {
			t.Fatalf("expected payload error for %#v", payload)
		}
	}
}

func testDaemon(client *fakeControlPlane, adapter sandbox.SandboxAdapter) RunnerDaemon {
	workDir, err := os.MkdirTemp("", "ama-runner-test-*")
	if err != nil {
		panic(err)
	}
	return RunnerDaemon{
		Config: runnerconfig.Config{
			SandboxAdapter:        runnerconfig.ProcessUnsafeAdapter,
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
		DetectRuntime: func(context.Context, string) hostruntime.Probe { return hostruntime.Probe{} },
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
		lease: &controlplane.Lease{
			ID:         "lease_1",
			WorkItemID: "work_1",
			RunnerID:   "runner_1",
			State:      "active",
		},
		workItem: &controlplane.WorkItem{
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
		lease: &controlplane.Lease{
			ID:         "lease_1",
			WorkItemID: "work_1",
			RunnerID:   "runner_1",
			State:      "active",
		},
		workItem: &controlplane.WorkItem{
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
				"requiredRunnerCapability": amaSandboxCapability,
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
	daemon.DetectRuntime = func(_ context.Context, runtimeName string) hostruntime.Probe {
		detectCalls[runtimeName]++
		if runtimeName == "codex" {
			return hostruntime.Probe{
				Models:  []string{"gpt-5.3-codex", "gpt-5.3-codex-mini"},
				Status:  "ready",
				Version: "0.42.0",
				Detail:  "host CLI enumerated 2 models",
			}
		}
		return hostruntime.Probe{}
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
	daemon.DetectRuntime = func(_ context.Context, runtimeName string) hostruntime.Probe {
		if runtimeName == "codex" {
			return hostruntime.Probe{Models: []string{"gpt-5.3-codex"}, Status: "ready", Version: "0.42.0", Detail: "host CLI enumerated 1 models"}
		}
		return hostruntime.Probe{Status: "unauthenticated", Detail: "host CLI exposed no models; authenticate the runtime CLI"}
	}
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	inventory := client.heartbeats[0].RuntimeInventory
	byRuntime := map[string]controlplane.RuntimeInventory{}
	for _, entry := range inventory {
		byRuntime[entry.Runtime] = entry
	}
	if _, ok := byRuntime["ama"]; ok {
		t.Fatalf("expected ama to be absent from runtime inventory because it is cloud-loop, got %#v", byRuntime["ama"])
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

func TestHeartbeatMarksClaudeCodeLimitedWhenUsageProbeUnavailable(t *testing.T) {
	client := &fakeControlPlane{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.LookPath = lookPathFinding("claude")
	daemon.DetectRuntime = func(_ context.Context, runtimeName string) hostruntime.Probe {
		if runtimeName != "claude-code" {
			return hostruntime.Probe{}
		}
		return hostruntime.Probe{
			Models:  []string{"claude-sonnet-4-6"},
			Status:  "ready",
			Version: "2.1.185",
			Detail:  "host CLI enumerated 1 models",
		}
	}
	daemon.setRuntimeUsageSnapshot(&hostruntime.UsageSnapshot{
		Limited: map[string]string{"claude-code": hostruntime.ClaudeCodeUsageUnavailableDetail},
	})

	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}

	inventory := client.heartbeats[0].RuntimeInventory
	byRuntime := map[string]controlplane.RuntimeInventory{}
	for _, entry := range inventory {
		byRuntime[entry.Runtime] = entry
	}
	if got := byRuntime["claude-code"]; got.State != "limited" || got.Detail != hostruntime.ClaudeCodeUsageUnavailableDetail {
		t.Fatalf("expected usage-unavailable claude-code to be limited, got %#v", got)
	}
	if !containsString(client.heartbeats[0].Capabilities, "runtime-provider-model:claude-code:*:claude-sonnet-4-6") {
		t.Fatalf("expected model capability to remain advertised for diagnostics and recovery, got %v", client.heartbeats[0].Capabilities)
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
	want := []string{"sandbox.exec", amaSandboxCapability}
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
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: codexSessionStartLease("runaway"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{waitForCancel: true}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.MaxSessionDuration = 20 * time.Millisecond

	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least runner.session.started + runtime.error to be relayed.
	waitForRunnerWriteCount(t, hubChannel, 2, done)
	err := <-done
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
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "session_timeout") {
		t.Fatalf("expected session_timeout runtime.error event, got %s", serializedEvents)
	}
}

func TestRunOnceDisablesSessionDeadlineWhenMaxDurationIsZero(t *testing.T) {
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: codexSessionStartLease("build"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.MaxSessionDuration = 0
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	waitForRunnerWriteCount(t, hubChannel, 1, done)
	if err := <-done; err != nil {
		t.Fatalf("expected run success with disabled session deadline, got %v", err)
	}
	if len(client.updates) != 1 || client.updates[0].State != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
}

func TestIsCompletedLeaseRenewalRaceMatchesMessage(t *testing.T) {
	// isCompletedLeaseRenewalRace must detect the specific error the control plane
	// sends when the lease has already been completed (race between completion and renew).
	if !isCompletedLeaseRenewalRace(fmt.Errorf("runner lease renewal failed: Runner lease is no longer active")) {
		t.Fatal("expected race detection for 'Runner lease is no longer active'")
	}
	if !isCompletedLeaseRenewalRace(fmt.Errorf("runner renewal: Runner lease is no longer active in state completed")) {
		t.Fatal("expected race detection for message containing 'Runner lease is no longer active'")
	}
}

func TestIsCompletedLeaseRenewalRaceRejectsOtherErrors(t *testing.T) {
	if isCompletedLeaseRenewalRace(nil) {
		t.Fatal("nil must not be a race error")
	}
	if isCompletedLeaseRenewalRace(fmt.Errorf("runner lease renewal failed: connection refused")) {
		t.Fatal("unrelated renewal error must not be treated as a race")
	}
	if isCompletedLeaseRenewalRace(fmt.Errorf("controlplane.Lease is no longer active")) {
		t.Fatal("lowercase 'lease' form must not match")
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

func TestIsSupportedSessionRuntimeAcceptsKnownRuntimes(t *testing.T) {
	for _, runtime := range []string{"ama", "claude-code", "codex", "copilot"} {
		if !isSupportedSessionRuntime(runtime) {
			t.Fatalf("expected %q to be a supported session runtime", runtime)
		}
	}
}

func TestIsSupportedSessionRuntimeRejectsUnknownRuntime(t *testing.T) {
	for _, runtime := range []string{"unknown-runtime", "", "gpt", "gemini"} {
		if isSupportedSessionRuntime(runtime) {
			t.Fatalf("expected %q to be rejected as an unsupported session runtime", runtime)
		}
	}
}

func TestCompleteSessionStartDoesNotBranchOnRuntimeNames(t *testing.T) {
	packages, err := parser.ParseDir(token.NewFileSet(), ".", func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	var completeSessionStart *ast.FuncDecl
	for _, pkg := range packages {
		for _, source := range pkg.Files {
			for _, decl := range source.Decls {
				function, ok := decl.(*ast.FuncDecl)
				if ok && function.Name.Name == "completeSessionStart" {
					completeSessionStart = function
					break
				}
			}
		}
	}
	if completeSessionStart == nil {
		t.Fatal("completeSessionStart function not found")
	}

	runtimeNames := map[string]bool{
		"codex":       true,
		"claude-code": true,
		"copilot":     true,
	}
	ast.Inspect(completeSessionStart.Body, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatalf("expected string literal to unquote: %v", err)
		}
		if runtimeNames[value] {
			t.Fatalf("completeSessionStart contains runtime-specific literal %q", value)
		}
		return true
	})
}

func TestRunnerCapabilitiesFallBackToPinnedModelWhenEnumerationFails(t *testing.T) {
	got := runnerCapabilities([]string{"claude-code", "codex", "copilot"}, nil)
	want := []string{
		"sandbox.exec",
		"ama-sandbox",
		"claude-code",
		"runtime-provider-model:claude-code:*:claude-sonnet-4-6",
		"codex",
		"runtime-provider-model:codex:*:gpt-5.3-codex",
		"copilot",
		"runtime-provider-model:copilot:*:copilot-cli",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected capabilities %v, got %v", want, got)
	}
}

func TestRunnerCapabilitiesDeclareOneCapabilityPerEnumeratedModel(t *testing.T) {
	got := runnerCapabilities([]string{"codex", "claude-code"}, map[string][]string{
		"codex":       {"gpt-5.3-codex", "gpt-5.3-codex-mini"},
		"claude-code": {"claude-opus-4-5"},
	})
	want := []string{
		"sandbox.exec",
		"ama-sandbox",
		"codex",
		"runtime-provider-model:codex:*:gpt-5.3-codex",
		"runtime-provider-model:codex:*:gpt-5.3-codex-mini",
		"claude-code",
		"runtime-provider-model:claude-code:*:claude-opus-4-5",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected capabilities %v, got %v", want, got)
	}
}

func TestRunnerCapabilitiesExcludeUndetectedRuntimes(t *testing.T) {
	got := runnerCapabilities([]string{"codex"}, map[string][]string{
		"codex":       {"gpt-5.3-codex"},
		"claude-code": {"claude-opus-4-5"},
	})
	for _, unexpected := range []string{"claude-code", "copilot", "runtime-provider-model:claude-code:*:claude-opus-4-5"} {
		if containsString(got, unexpected) {
			t.Fatalf("expected %q to be excluded, got %v", unexpected, got)
		}
	}
	if !containsString(got, "codex") || !containsString(got, "runtime-provider-model:codex:*:gpt-5.3-codex") {
		t.Fatalf("expected codex capabilities, got %v", got)
	}
}

func TestWorkspacePathSafetyBranches(t *testing.T) {
	workDir := t.TempDir()
	root, relative, err := sandbox.WorkspaceRootAndRelativePath(workDir, "/workspace/nested/file.txt")
	if err != nil || root == "" || relative != filepath.Join("nested", "file.txt") {
		t.Fatalf("unexpected workspace path result root=%q relative=%q err=%v", root, relative, err)
	}
	for _, path := range []string{filepath.Join(workDir, "absolute"), "..", "../outside"} {
		if _, _, err := sandbox.WorkspaceRootAndRelativePath(workDir, path); err == nil {
			t.Fatalf("expected workspace path error for %q", path)
		}
	}
	if err := os.WriteFile(filepath.Join(workDir, "file-parent"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := sandbox.EnsureWorkspaceParent(workDir, filepath.Join("file-parent", "child")); err == nil {
		t.Fatal("expected file parent error")
	}
	if runtime.GOOS != "windows" {
		outside := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(workDir, "link-parent")); err != nil {
			t.Fatal(err)
		}
		if _, err := sandbox.EnsureWorkspaceParent(workDir, filepath.Join("link-parent", "child")); err == nil {
			t.Fatal("expected symlink parent error")
		}
		if err := os.Symlink(filepath.Join(outside, "target"), filepath.Join(workDir, "link-file")); err != nil {
			t.Fatal(err)
		}
		if _, err := sandbox.ResolveWritePath(workDir, "link-file"); err == nil {
			t.Fatal("expected symlink write path error")
		}
		if err := os.Symlink(outside, filepath.Join(workDir, "read-link")); err != nil {
			t.Fatal(err)
		}
		if _, err := sandbox.ResolveReadPath(workDir, "read-link"); err == nil {
			t.Fatal("expected symlink read path escape error")
		}
		if err := os.Symlink(outside, filepath.Join(workDir, ".home")); err != nil {
			t.Fatal(err)
		}
		if _, err := sandbox.PrepareProcessEnvironmentDir(workDir, ".home"); err == nil {
			t.Fatal("expected process env symlink error")
		}
	}
	if err := sandbox.EnsureUnderWorkspace(workDir, filepath.Dir(workDir)); err == nil {
		t.Fatal("expected outside workspace error")
	}
}

func TestCompleteSessionStartFailsLeaseWhenRelayHubIsNil(t *testing.T) {
	// completeSessionStart must fail the lease when the relay hub has not been
	// started (d.relayHub == nil). This guards the invariant that the hub is
	// always running before session work is dispatched.
	lease := sessionStartLease()
	client := &fakeControlPlane{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	// relayHub is nil by default in testDaemon (it is started lazily by Start).
	payload, err := protocol.ParseWorkPayload(lease.workItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := daemon.completeSessionStart(context.Background(), lease.lease, payload); err == nil {
		t.Fatal("expected session start error when relay hub is nil")
	}
	if len(client.updates) != 1 || client.updates[0].State != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestRuntimeHelperBranches(t *testing.T) {
	if got := initialPrompt(protocol.WorkPayload{}); got != "" {
		t.Fatalf("expected empty initial prompt, got %q", got)
	}
	if _, err := hostruntime.Workspace(filepath.Join(t.TempDir(), "missing-parent", "child"), "session_1"); err != nil {
		t.Fatalf("expected workspace creation success, got %v", err)
	}
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := hostruntime.Workspace(fileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace root file error")
	}
}

func TestParseWorkPayloadValidationBranches(t *testing.T) {
	for _, payload := range []ama.JSON{
		{"protocol": "other"},
		{"protocol": "ama-runner-work", "type": "session.start", "hostingMode": "self_hosted", "runtime": "ama", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model", "requiredRunnerCapability": "cap"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "cloud", "runtime": "ama", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model", "requiredRunnerCapability": "cap"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "self_hosted", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model", "requiredRunnerCapability": "cap"},
		{"protocol": "ama-runner-work", "type": "session.start", "sessionId": "session_1", "hostingMode": "self_hosted", "runtime": "ama", "runtimeConfig": map[string]any{}, "provider": "workers-ai", "model": "model"},
		{"protocol": "ama-runner-work", "type": "tool.execute", "approved": true, "toolCallId": "call_1", "toolName": "unknown", "input": map[string]any{"command": "x"}},
	} {
		if _, err := protocol.ParseWorkPayload(payload); err == nil {
			t.Fatalf("expected payload validation error for %#v", payload)
		}
	}
	payload, err := protocol.ParseWorkPayload(ama.JSON{
		"protocol": "ama-runner-work",
		"type":     "tool.execute",
		"toolCall": map[string]any{
			"id":        "call_1",
			"name":      "sandbox.exec",
			"arguments": map[string]any{"command": "printf ok"},
			"approved":  true,
		},
	})
	if err != nil || payload.ToolCallID != "call_1" || payload.Input["command"] != "printf ok" {
		t.Fatalf("expected nested tool call parse success, got %#v %v", payload, err)
	}
}

func TestRemainingValidationBranches(t *testing.T) {
	var exitErr *exec.ExitError
	if sandbox.AsExitError(os.ErrPermission, &exitErr) || exitErr != nil {
		t.Fatal("expected non-exit error not to match exec.ExitError")
	}
	if _, err := hostruntime.Workspace(t.TempDir(), "."); err == nil {
		t.Fatal("expected invalid session id error")
	}
}

func TestRunOnceDispatchesCopilotRuntimeThroughAdapter(t *testing.T) {
	workDir := t.TempDir()
	// Copilot is a CLI relay runtime: events flow over the per-runner hub channel,
	// not a per-lease channel. Seed the hub channel so the hub connects immediately.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: copilotSessionStartLease("copilot prompt"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0, "providerThreadId": "copilot_thread_1"},
		events: []RuntimeEventRecord{
			{Type: "runtime.metadata", Payload: ama.JSON{"data": ama.JSON{"stage": "sdk_bridge_started", "status": "running"}}},
			{Type: "message_end", Payload: ama.JSON{"message": ama.JSON{"role": "assistant", "content": []any{ama.JSON{"type": "text", "text": "copilot prompt ok"}}}}},
			{Type: "tool_execution_start", Payload: ama.JSON{"toolCallId": "copilot_tool_1", "toolName": "sandbox.exec", "input": ama.JSON{"command": "printf ok"}}},
			{Type: "tool_execution_end", Payload: ama.JSON{"toolCallId": "copilot_tool_1", "toolName": "sandbox.exec", "output": ama.JSON{"stdout": "ok", "stderr": "", "exitCode": 0}, "durationMs": 3}},
			{Type: "usage", Payload: ama.JSON{"provider": "provider_copilot", "model": "copilot-cli", "inputTokens": 4, "outputTokens": 5, "totalTokens": 9}},
			{Type: "runtime.output", Payload: ama.JSON{"stream": "bridge", "content": "copilot diagnostic"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least one event to be relayed over the hub channel.
	waitForRunnerWriteCount(t, hubChannel, 1, done)
	if err := <-done; err != nil {
		t.Fatalf("expected copilot run success, got %v", err)
	}
	if runtimeAdapter.request.Runtime != "copilot" ||
		runtimeAdapter.request.InitialPrompt != "copilot prompt" ||
		runtimeAdapter.request.Provider != "provider_copilot" ||
		runtimeAdapter.request.Model != "copilot-cli" {
		t.Fatalf("expected copilot runtime request metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.RuntimeConfig["approvalMode"] != "auto" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].State != "completed" {
		t.Fatalf("expected completed copilot lease update, got %#v", client.updates)
	}
	if client.updates[len(client.updates)-1].Result["providerThreadId"] != "copilot_thread_1" {
		t.Fatalf("expected adapter result to complete lease, got %#v", client.updates[len(client.updates)-1].Result)
	}
	gotTypes := hubChannel.writtenEvents()
	for _, want := range []string{
		"runtime.metadata",
		"message_end",
		"tool_execution_start",
		"tool_execution_end",
		"usage",
		"runtime.output",
	} {
		if !containsString(gotTypes, want) {
			t.Fatalf("expected channel event %s in %v", want, gotTypes)
		}
	}
	storedEvents, err := readSessionEventLog(sessionEventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("expected stored session events, got %v", err)
	}
	serializedStoredEvents := mustJSON(t, storedEvents)
	if !strings.Contains(serializedStoredEvents, "runner.session.started") ||
		!strings.Contains(serializedStoredEvents, `"role":"user"`) ||
		!strings.Contains(serializedStoredEvents, `"text":"copilot prompt"`) {
		t.Fatalf("expected initial prompt to be durable in runner log, got %s", serializedStoredEvents)
	}
	for _, message := range hubChannel.writtenMessages() {
		if message["type"] != "runner.event" || message["eventId"] == "" {
			t.Fatalf("expected copilot event to use runner event envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	for _, want := range []string{
		"copilot prompt ok",
		"provider_copilot",
		"copilot-cli",
		"copilot diagnostic",
	} {
		if !strings.Contains(serializedEvents, want) {
			t.Fatalf("expected %q in copilot events, got %s", want, serializedEvents)
		}
	}
	if strings.Contains(serializedEvents, "AMA_TOKEN") || strings.Contains(serializedEvents, "secret://providers") {
		t.Fatalf("expected safe copilot events, got %s", serializedEvents)
	}
}

func TestRunOnceFailsCopilotLeaseOnRuntimeAdapterFailure(t *testing.T) {
	// Copilot is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeRunnerSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeControlPlane{lease: copilotSessionStartLease("fail"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 7, "stderr": "bad failure"},
		err:    errors.New("copilot SDK bridge failed"),
		events: []RuntimeEventRecord{
			{Type: "runtime.output", Payload: ama.JSON{"stream": "stderr", "content": "bad failure"}},
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least runner.session.started + runtime.error to be relayed.
	waitForRunnerWriteCount(t, hubChannel, 2, done)
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "copilot SDK bridge failed") {
		t.Fatalf("expected copilot failure to be returned, got %v", err)
	}
	if len(client.updates) == 0 || client.updates[len(client.updates)-1].State != "failed" {
		t.Fatalf("expected failed copilot lease update, got %#v", client.updates)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "copilot SDK bridge failed") || !strings.Contains(serializedEvents, "bad failure") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
	failedUpdate := client.updates[len(client.updates)-1]
	if !strings.Contains(mustJSON(t, failedUpdate.Result), `"exitCode":7`) {
		t.Fatalf("expected failed lease result to include exit code, got %#v", failedUpdate.Result)
	}
}

func copilotSessionStartLease(prompt string) *fakeWork {
	lease := sessionStartLease()
	lease.workItem.Payload["runtime"] = "copilot"
	lease.workItem.Payload["runtimeConfig"] = map[string]any{"approvalMode": "auto"}
	lease.workItem.Payload["provider"] = "provider_copilot"
	lease.workItem.Payload["model"] = "copilot-cli"
	lease.workItem.Payload["runtimeDriver"] = "copilot-self-hosted"
	lease.workItem.Payload["requiredRunnerCapability"] = "runtime-provider-model:copilot:*:copilot-cli"
	lease.workItem.Payload["initialPrompt"] = prompt
	return lease
}
