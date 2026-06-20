# Any Managed Agents TypeScript SDK

`@any-managed-agents/sdk` is generated from this repository's OpenAPI document
with [`@hey-api/openapi-ts`](https://heyapi.dev). Every control-plane operation
is a typed function and every request/response body is a generated type — there
is no hand-written client surface to drift from the contract.

## Layout

- `src/generated/` — output of `@hey-api/openapi-ts`. Do not edit by hand.
- `src/index.ts` — the only hand-maintained file: re-exports the generated
  operations, models, and the `createClient`/`createConfig` factory.
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
typed operation functions. Pass a per-call `client` for multi-tenant use, or
configure the default client once.

```ts
import {
  createClient,
  createConfig,
  createAgent,
  createEnvironment,
  readSession,
} from '@any-managed-agents/sdk'

const client = createClient(
  createConfig({
    baseUrl: process.env.AMA_ORIGIN,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-ama-project-id': projectId,
    },
  }),
)

const env = await createEnvironment({
  client,
  body: { name: 'Node workspace', hostingMode: 'cloud', runtime: 'ama', runtimeConfig: { image: 'node:24' } },
})

const agent = await createAgent({
  client,
  body: { name: 'Research assistant', provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6' },
})

const { data, error } = await readSession({ client, path: { sessionId } })
```

Each function returns `{ data, error }` (or throws when called with
`{ throwOnError: true }`). `data` and `body` are fully typed from the OpenAPI
schemas.

The web console does not import this package; console code uses the
project-local Hono RPC client in `src/lib/api.ts`.
