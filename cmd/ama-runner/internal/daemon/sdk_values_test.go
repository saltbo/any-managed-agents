package daemon

import (
	"strings"
	"testing"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestSDKValueHelpers(t *testing.T) {
	value := "value"
	if got := stringValue(&value); got != value {
		t.Fatalf("expected string value %q, got %q", value, got)
	}
	if got := stringValue(nil); got != "" {
		t.Fatalf("expected empty string for nil pointer, got %q", got)
	}
}

func TestEnsureCompatibleHealth(t *testing.T) {
	if err := EnsureCompatibleHealth(&ama.HealthResponse{Status: ama.Ok, Name: "Any Managed Agents"}); err != nil {
		t.Fatalf("expected compatible health response, got %v", err)
	}
	if err := EnsureCompatibleHealth(nil); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("expected empty health response error, got %v", err)
	}
	if err := EnsureCompatibleHealth(&ama.HealthResponse{Status: "error", Name: "Other"}); err == nil || !strings.Contains(err.Error(), "incompatible") {
		t.Fatalf("expected incompatible health response error, got %v", err)
	}
}
