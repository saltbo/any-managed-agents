package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"testing"
)

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
