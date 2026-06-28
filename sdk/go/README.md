# Any Managed Agents Go SDK

This directory is the Go SDK module for the external Any Managed Agents
control-plane API.

`ama.gen.go` is generated from `sdk/openapi.json`. `ama/client.go` is the stable
facade generated from `sdk/spec/resources.json`, the shared SDK shape used by
the TypeScript, Go, and Python SDKs.

Regenerate generated operation metadata from the route-generated OpenAPI document:

```bash
pnpm run openapi:generate
go test ./...
```

This module is not a pnpm workspace. It uses native Go module metadata and must remain generated from or mechanically aligned with `sdk/openapi.json` and `sdk/spec/resources.json`.
The canonical OpenAPI snapshot is `sdk/openapi.json`; this directory does not
carry its own OpenAPI copy.

Usage:

```go
client, err := ama.New(ama.ClientConfig{
	BaseURL:     "https://ama.example.com",
	AccessToken: accessToken,
	ProjectID:   projectID,
})
if err != nil {
	return err
}

project, err := client.Projects.Create(ctx, ama.CreateProjectRequest{Name: "Control Plane"})
```
