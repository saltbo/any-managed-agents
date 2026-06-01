# Any Managed Agents TypeScript SDK

This workspace package is a generated SDK scaffold for the external Any Managed Agents control-plane API.

Regenerate it from the route-generated OpenAPI document:

```bash
pnpm run openapi:generate
pnpm --filter -managed-agents/sdk run typecheck
```

The web console does not import this package. Console code continues to use the project-local Hono RPC client in `src/lib/api.ts`.

Environment resources own hosting and runtime selection:

```ts
await client.environments.create({
  name: 'Node workspace',
  hostingMode: 'cloud',
  runtime: 'ama',
  runtimeConfig: { image: 'node:24' },
})

await client.agents.create({
  name: 'Research assistant',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
})
```
