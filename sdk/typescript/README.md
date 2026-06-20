# Any Managed Agents TypeScript SDK

`@any-managed-agents/sdk` is generated from this repository's OpenAPI document
with [`@hey-api/openapi-ts`](https://heyapi.dev). Every control-plane operation
is a typed function and every request/response body is a generated type — there
is no hand-written client surface to drift from the contract.

## Layout

- `src/generated/` — output of `@hey-api/openapi-ts`. Do not edit by hand.
- `src/client.ts` — the stable, hand-maintained **facade** consumers code
  against (`createAmaClient(...).<resource>.<verb>(...)`). It delegates to the
  generated functions, so the generated layer can be re-shaped — or the
  generator swapped — without changing these call signatures.
- `src/index.ts` — public barrel: exports the facade plus the raw generated
  operations/models as an escape hatch.
- `openapi-ts.config.ts` — generator config (input `../openapi.json`).

## Regenerate

The canonical OpenAPI snapshot is `sdk/openapi.json`, produced from the Hono
routes. Regenerate the SDK from it:

```bash
pnpm run openapi:generate                            # repo root: routes -> openapi.json -> all SDKs
pnpm --filter @any-managed-agents/sdk run generate   # this package only
pnpm --filter @any-managed-agents/sdk run typecheck
```

## Usage

Create a client bound to an origin and an OIDC access token, then call the
resource methods. Each method takes the natural arguments (ids, body, query),
returns the typed result, and throws `AmaApiError` (with `.status`) on non-2xx.

```ts
import { createAmaClient, AmaApiError } from '@any-managed-agents/sdk'

const client = createAmaClient({
  baseUrl: process.env.AMA_ORIGIN,
  accessToken,        // sent as Authorization: Bearer <token>
  projectId,          // sent as x-ama-project-id (optional)
})

const env = await client.environments.create({
  name: 'Node workspace',
  hostingMode: 'cloud',
  runtime: 'ama',
  runtimeConfig: { image: 'node:24' },
})

const agent = await client.agents.create({
  name: 'Research assistant',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
})

const session = await client.sessions.create({ agentId: agent.id, environmentId: env.id, runtime: 'ama', title: 'Research' })

try {
  const found = await client.agents.get(agentId)
} catch (err) {
  if (err instanceof AmaApiError && err.status === 404) {
    // not found
  }
}
```

`body`, `query`, and the returned data are fully typed from the OpenAPI schemas.
The generated operation functions (`createAgent`, `readSession`, …) and
`createClient`/`createConfig` are also exported for operations the facade does
not wrap yet, reachable as `client.raw` too.

The web console does not import this package; console code uses the
project-local Hono RPC client in `src/lib/api.ts`.
