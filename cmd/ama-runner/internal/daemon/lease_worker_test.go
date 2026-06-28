package daemon

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"strconv"
	"strings"
	"testing"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

func TestIsSupportedSessionRuntimeAcceptsNonEmptyRuntime(t *testing.T) {
	for _, runtime := range []string{"ama", "claude-code", "codex", "copilot", "future-runtime"} {
		if !isSupportedSessionRuntime(runtime) {
			t.Fatalf("expected %q to be a supported session runtime", runtime)
		}
	}
}

func TestIsSupportedSessionRuntimeRejectsEmptyRuntime(t *testing.T) {
	if isSupportedSessionRuntime("") {
		t.Fatal("expected empty runtime to be rejected")
	}
}

func TestLeaseWorkerSessionStartDoesNotBranchOnExternalRuntimeNames(t *testing.T) {
	packages, err := parser.ParseDir(token.NewFileSet(), ".", func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	var runSessionStart *ast.FuncDecl
	for _, pkg := range packages {
		for _, source := range pkg.Files {
			for _, decl := range source.Decls {
				function, ok := decl.(*ast.FuncDecl)
				if ok && function.Name.Name == "runSessionStart" {
					runSessionStart = function
					break
				}
			}
		}
	}
	if runSessionStart == nil {
		t.Fatal("runSessionStart function not found")
	}

	runtimeNames := map[string]bool{
		"codex":       true,
		"claude-code": true,
		"copilot":     true,
	}
	ast.Inspect(runSessionStart.Body, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatalf("expected string literal to unquote: %v", err)
		}
		if runtimeNames[value] {
			t.Fatalf("runSessionStart contains runtime-specific literal %q", value)
		}
		return true
	})
}

func TestLeaseWorkerFailsSessionStartWhenRelayIsNil(t *testing.T) {
	lease := sessionStartLease()
	client := &fakeAMAServer{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	payload, err := protocol.ParseWorkPayload(lease.workItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := daemon.leaseWorker().runSessionStart(context.Background(), lease.lease, payload); err == nil {
		t.Fatal("expected session start error when relay is nil")
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestIsCompletedLeaseRenewalRaceMatchesMessage(t *testing.T) {
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
	if isCompletedLeaseRenewalRace(fmt.Errorf("ama.Lease is no longer active")) {
		t.Fatal("lowercase 'lease' form must not match")
	}
}

func TestCloneResult(t *testing.T) {
	source := map[string]any{"exitCode": 0}
	cloned := cloneResult(source)
	cloned["exitCode"] = 1
	if source["exitCode"] != 0 {
		t.Fatalf("expected clone mutation not to affect source, got %#v", source)
	}
}

func TestSuccessfulRuntimeResult(t *testing.T) {
	for _, result := range []map[string]any{
		{"exitCode": 0},
		{"output": map[string]any{"exitCode": int64(0)}},
		{"output": map[string]any{"exitCode": float64(0)}},
	} {
		if !successfulRuntimeResult(result) {
			t.Fatalf("expected successful result for %#v", result)
		}
	}
	for _, result := range []map[string]any{
		nil,
		{"exitCode": 1},
		{"output": map[string]any{"exitCode": 1}},
		{"output": map[string]any{"exitCode": "0"}},
	} {
		if successfulRuntimeResult(result) {
			t.Fatalf("expected unsuccessful result for %#v", result)
		}
	}
}
