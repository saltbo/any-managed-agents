# Any Managed Agents Go SDK

This directory is the generated Go SDK module scaffold for the external Any Managed Agents control-plane API.

Regenerate the OpenAPI snapshot and generated operation metadata from Hono routes:

```bash
npm run openapi:generate
go test ./...
```

This module is not an npm workspace. It uses native Go module metadata and must remain generated from or mechanically aligned with `sdk/openapi.json`.

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
