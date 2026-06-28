package runtimebridge

import (
	"os"
	"strings"
	"testing"
)

func TestMaterializeWritesEmbeddedBundle(t *testing.T) {
	path, err := Materialize()
	if err != nil {
		t.Fatalf("expected embedded bridge to materialize, got %v", err)
	}
	if !strings.HasSuffix(path, ".mjs") {
		t.Fatalf("expected bridge bundle path, got %q", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(Bytes()) {
		t.Fatal("expected materialized bridge to match embedded bundle")
	}
}
