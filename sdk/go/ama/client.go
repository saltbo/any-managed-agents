package ama

// Regenerate the typed models and REST client (ama.gen.go) from the OpenAPI doc.
// Requires oapi-codegen on PATH:
//   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
// The config's paths (overlay, output) resolve from sdk/go, so run from there.
// `go generate` invokes this from the package dir, hence the `cd ..`.
//go:generate sh -c "cd .. && oapi-codegen -config oapi-codegen.config.yaml ../openapi.json"

import "net/http"

type Client struct {
	Origin      string
	AccessToken string
	ProjectID   string
	HTTPClient  *http.Client
}
