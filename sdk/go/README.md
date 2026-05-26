# Any Managed Agents Go SDK

This directory is the generated Go SDK module scaffold for the external Any Managed Agents control-plane API.

Regenerate the OpenAPI snapshot and generated operation metadata from Hono routes:

```bash
npm run openapi:generate
go test ./...
```

This module is not an npm workspace. It uses native Go module metadata and must remain generated from or mechanically aligned with `sdk/openapi.json`.
