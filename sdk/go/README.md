# Any Managed Agents Go SDK

This directory is the generated Go SDK module scaffold for the external Any Managed Agents control-plane API.

Regenerate generated operation metadata from the route-generated OpenAPI document:

```bash
pnpm run openapi:generate
go test ./...
```

This module is not a pnpm workspace. It uses native Go module metadata and must remain generated from or mechanically aligned with `sdk/openapi.json`.
The canonical OpenAPI snapshot is `sdk/openapi.json`; this directory does not
carry its own OpenAPI copy.

Environment resources own hosting and runtime selection:

```go
environment := map[string]any{
	"name":          "Node workspace",
	"hostingMode":   "cloud",
	"runtime":       "ama",
	"runtimeConfig": map[string]any{"image": "node:24"},
}

agent := map[string]any{
	"name":     "Research assistant",
	"provider": "workers-ai",
	"model":    "@cf/moonshotai/kimi-k2.6",
}
```
