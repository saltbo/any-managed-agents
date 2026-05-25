# Contributing

Thanks for helping build Any Managed Agents. This document explains the project stack, architecture, and development workflow.

## Project Goal

Any Managed Agents is a Cloudflare-native managed agents platform. It can be deployed on Cloudflare Workers, publishes an OpenAPI control-plane contract, and runs Pi coding agent inside a per-session Cloudflare Sandbox for v1.0 runtime execution.

The platform provides the control plane. Language SDKs are generated and maintained in separate repositories. This repository does not define a competing custom runtime SDK or incompatible runtime protocol.

## Technology Stack

- TypeScript
- Vite 7
- React 19
- Hono
- Cloudflare Workers
- Pi coding agent
- Cloudflare Sandbox
- Cloudflare Workers AI
- Cloudflare D1
- Cloudflare Durable Objects
- Cloudflare Secrets
- Drizzle ORM
- Tailwind CSS v4
- Biome
- Vitest
- Cloudflare Vitest pool
- Gherkin + Cucumber.js + Playwright

The project is a single npm package. Do not introduce pnpm workspaces or a monorepo layout.

## Architecture

```txt
Client
  -> external SDK or direct HTTP
  -> /api/*
     -> Hono control-plane routes
     -> D1 metadata and governance state

Client
  -> external SDK runtime helper or direct runtime client
  -> AMA runtime proxy
  -> Pi RPC / JSON event stream

AMA session lifecycle
  -> Cloudflare Sandbox per-session sandbox
  -> Pi coding agent process
```

### Control Plane

The control plane owns product resources:

- organizations, projects, and users
- agent definitions
- provider configuration for all supported providers
- model policy
- sandbox policy
- session metadata
- environment metadata
- sandbox lifecycle
- runtime proxy
- UI surfaces
- usage and cost records
- audit records
- Cloudflare Secrets references
- governance rules

Control-plane routes live under `server/routes/` and are mounted under `/api/*`.

All control-plane APIs must be implemented with `@hono/zod-openapi`:

- define request and response schemas with `z` from `@hono/zod-openapi`
- define routes with `createRoute`
- register handlers with `app.openapi`
- expose the generated contract through `/api/openapi.json`
- expose interactive docs through `/api/docs`

Do not add new control-plane routes with plain `app.get`, `app.post`, or manual OpenAPI JSON. The route implementation, validation schema, response schema, OpenAPI contract, and tests should change together.

### SDK Repositories

This repository does not maintain SDK source code. It publishes `/api/openapi.json`; separate SDK repositories generate language clients from that contract.

OpenAPI changes must be treated as SDK contract changes. Keep route schemas stable and version breaking changes intentionally.

External SDKs may provide small runtime helpers, such as connecting to a session, but those helpers must delegate to Pi protocol or transparent AMA Pi proxy endpoints instead of defining a separate runtime protocol.

### Runtime Plane

v1.0 runtime traffic uses Pi protocol directly or through a transparent AMA proxy around Pi RPC and JSON event streams. AMA owns authentication, tenancy, session lookup, sandbox lifecycle, audit metadata, usage metadata, and proxying. Pi coding agent owns the runtime protocol, agent loop, built-in coding tools, session events, and prompt, abort, follow-up, and steer semantics.

Cloudflare Agents SDK is not the v1.0 runtime contract. It may become a future adapter, but v1.0 work must not require `/agents/*` compatibility.

### Environment and Sandbox

`Environment` is a long-lived sandbox and runtime configuration stored by the control plane. It defines packages, variables, network policy, resource limits, Pi runtime configuration, and metadata. It is not a running sandbox.

`Sandbox` is a runtime instance created from an environment snapshot. It is owned 1:1 by a session, follows the session lifecycle, provides filesystem, shell, process isolation, and per-session execution, and must not expose public ports.

### Storage

- D1 stores control-plane metadata.
- Durable Objects may own control-plane coordination state when needed, but Pi in Cloudflare Sandbox owns v1.0 live runtime behavior.
- Cloudflare Secrets stores provider credentials and other secret values.
- D1 migrations live in `migrations/`.
- Drizzle schema lives in `server/db/schema.ts`.

## Development

Install dependencies:

```bash
npm install
```

Start local development:

```bash
npm run dev
```

Run checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Useful scripts:

```bash
npm run db:generate
npm run db:migrate:d1
npm run db:migrate:d1:staging
npm run db:migrate:d1:prod
```

## BDD-First Workflow

Product behavior is described in Gherkin specs under `specs/product/`.

Use this workflow for feature work:

1. Discover the desired behavior.
2. Update or add BDD specs.
3. Implement the smallest code change that satisfies the specs.
4. Add focused tests when the behavior crosses module or runtime boundaries.
5. Run the verification commands.

If you discover new behavior while implementing, update the spec before continuing the implementation.

## Testing Strategy

- `npm test` runs unit, component, route, and Cloudflare runtime tests.
- `npm run test:e2e` runs executable product specs with Cucumber; browser flows use the Playwright library inside step definitions.
- `npm run test:smoke` runs deployed staging smoke only and may consume runtime/model quota.
- `npm run build` proves the Worker and client can be bundled.

Cloudflare runtime tests use `wrangler.test.toml`. It intentionally omits the Workers AI binding so CI does not need Cloudflare deployment credentials.

## Cloudflare Deployment

GitHub Actions does not deploy. It only runs CI checks.

Deployment is handled by Cloudflare Workers Builds. For a brand-new Worker with Durable Object migrations, run one non-versioned bootstrap deployment first:

```bash
npm run build
npx wrangler deploy
```

After that bootstrap, Cloudflare Workers Builds can upload versions normally.

## Pull Request Checklist

- BDD specs updated when product behavior changes
- `npm run lint` passes
- `npm run typecheck` passes
- `npm test` passes
- `npm run test:e2e` passes
- `npm run test:smoke` passes before promoting staging changes that touch runtime/model integration
- `npm run build` passes

## Coding Guidelines

- Keep changes small and scoped.
- Prefer existing project patterns.
- Do not add a dependency unless it removes real complexity.
- Do not introduce a custom runtime SDK or incompatible runtime protocol.
- Do not add SDK source code to this repository.
- Do not require Cloudflare Agents SDK or `/agents/*` compatibility for v1.0 runtime traffic.
- Do not store raw secret values in D1.
- Do not introduce workspace tooling.
