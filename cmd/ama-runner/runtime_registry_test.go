package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"testing"
)

func TestSessionRuntimeHandlerRegistryCoversSupportedRuntimes(t *testing.T) {
	tests := map[string]bool{
		"ama":         false,
		"codex":       true,
		"claude-code": true,
		"copilot":     true,
	}
	for runtimeName, wantAcknowledgedStart := range tests {
		handler, err := sessionRuntimeHandlerFor(runtimeName)
		if err != nil {
			t.Fatalf("expected handler for %s, got %v", runtimeName, err)
		}
		if handler.run == nil {
			t.Fatalf("expected handler run function for %s", runtimeName)
		}
		if handler.acknowledgeSessionStarted != wantAcknowledgedStart {
			t.Fatalf("expected %s acknowledged start %v, got %v", runtimeName, wantAcknowledgedStart, handler.acknowledgeSessionStarted)
		}
	}
	if _, err := sessionRuntimeHandlerFor("unknown-runtime"); err == nil {
		t.Fatal("expected unknown runtime to be rejected")
	}
}

func TestCompleteSessionStartDoesNotBranchOnRuntimeNames(t *testing.T) {
	source, err := parser.ParseFile(token.NewFileSet(), "runner.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var completeSessionStart *ast.FuncDecl
	for _, decl := range source.Decls {
		function, ok := decl.(*ast.FuncDecl)
		if ok && function.Name.Name == "completeSessionStart" {
			completeSessionStart = function
			break
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
