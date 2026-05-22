# Any Managed Agents

Workers-native managed agents for any model, tool, and edge runtime.

This is a clean-room implementation. It is not a fork of any AGPL managed-agents
project, and it does not copy source, specs, UI text, schemas, or implementation
details from those projects.

## Stack

- Vite 7 + Cloudflare Vite plugin
- React 19
- Hono
- Cloudflare Agents SDK
- D1 + Drizzle ORM
- Workers AI
- Tailwind CSS v4
- Biome
- Vitest
- Gherkin + Cucumber.js executable product specs

## Layout

```txt
workers/bootstrap.ts     Cloudflare Worker entry
server/                  Hono API, Drizzle schema, Agent classes
src/                     React app
migrations/              D1 migrations
docs/product/            Product-level specs and platform boundaries
specs/product/           Product specs in Gherkin
test/bdd/                Step definitions for executable specs
```

## Development

```bash
npm install
npm run typecheck
npm run bdd
npm run test:cf
npm run dev
```

Production and staging D1 databases are configured in `wrangler.toml`.

## CI and Deploy

GitHub Actions runs checks only: lint, typecheck, BDD specs, Cloudflare runtime
tests, and build. Deploys are handled by Cloudflare's CI/deploy pipeline.

Cloudflare runtime tests use `wrangler.test.toml`, which keeps D1 and Durable
Object bindings local and intentionally omits the Workers AI binding so CI does
not need Cloudflare deployment credentials.

See [docs/infra/cloudflare-deploy.md](docs/infra/cloudflare-deploy.md).

## Product Spec

The product-level platform boundaries are documented in
[docs/product/spec.md](docs/product/spec.md) and enforced through BDD specs in
`specs/product/`.
