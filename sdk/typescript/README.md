# Any Managed Agents TypeScript SDK

This workspace package is a generated SDK scaffold for the external Any Managed Agents control-plane API.

Regenerate it from the route-generated OpenAPI document:

```bash
npm run openapi:generate
npm run --workspace sdk/typescript typecheck
```

The web console does not import this package. Console code continues to use the project-local Hono RPC client in `src/lib/api.ts`.
