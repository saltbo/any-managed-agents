# Contributing

Thanks for helping build Any Managed Agents. This document explains the project stack, architecture, and development workflow.

## Project Goal

Any Managed Agents is a Cloudflare-native managed agents platform. It can be deployed on Cloudflare Workers, provides a thin product SDK, uses Cloudflare Agent SDK for runtime traffic, and is designed to use Cloudflare Sandbox SDK for sandbox execution.

The platform provides the control plane and product SDK. It does not define a competing custom runtime SDK.

## Technology Stack

- TypeScript
- Vite 7
- React 19
- Hono
- Cloudflare Workers
- Cloudflare Agent SDK
- Any Managed Agents SDK generated from the control-plane API
- Cloudflare Workers AI
- Cloudflare D1
- Cloudflare Durable Objects
- Drizzle ORM
- Tailwind CSS v4
- Biome
- Vitest
- Cloudflare Vitest pool
- Gherkin + Cucumber.js

The project is a single npm package. Do not introduce pnpm workspaces or a monorepo layout.

## Architecture

```txt
Client
  -> Any Managed Agents SDK
  -> /api/*
     -> Hono control-plane routes
     -> D1 metadata and governance state

Client
  -> Any Managed Agents SDK runtime helper
  -> Cloudflare Agent SDK
  -> /agents/*
  -> Agent Durable Object

Agent Durable Object
  -> Workers AI / model providers
  -> Cloudflare Sandbox SDK
```

### Control Plane

The control plane owns product resources:

- organizations, projects, and users
- agent definitions
- provider configuration
- model policy
- sandbox policy
- session metadata
- usage and cost records
- audit records
- vault and secret references
- governance rules

Control-plane routes live under `server/routes/` and are mounted under `/api/*`.

### Product SDK

The product SDK wraps the control-plane API for developer workflows:

- agents
- environments
- sessions
- providers
- vaults
- governance
- usage
- audit

The SDK may provide small runtime helpers, such as connecting to a session, but those helpers must delegate to Cloudflare Agents SDK-compatible endpoints instead of defining a separate runtime protocol.

### Runtime Plane

Agent runtime traffic must remain compatible with Cloudflare Agent SDK. The Worker forwards `/agents/*` requests to the SDK router instead of defining a custom runtime protocol.

Agent classes live under `server/agents/`.

### Storage

- D1 stores control-plane metadata.
- Durable Objects own live agent/session runtime state.
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
npm run bdd
npm run test:cf
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

- `npm test` runs ordinary Vitest tests.
- `npm run bdd` runs executable product specs.
- `npm run test:cf` runs Cloudflare runtime tests with D1 and Durable Objects.
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
- `npm run bdd` passes
- `npm run test:cf` passes when Cloudflare runtime behavior changes
- `npm run build` passes

## Coding Guidelines

- Keep changes small and scoped.
- Prefer existing project patterns.
- Do not add a dependency unless it removes real complexity.
- Do not introduce a custom runtime SDK.
- Keep the product SDK thin and generated from the API contract where possible.
- Do not bypass Cloudflare Agent SDK for agent runtime traffic.
- Do not introduce workspace tooling.
