# Contributing to Any Managed Agents

Thanks for helping improve Any Managed Agents. This guide covers local development, verification, and contribution expectations. Product positioning and user-facing project overview belong in [README.md](README.md); implementation details belong here or in `docs/`.

## Project Boundaries

Any Managed Agents is a Cloudflare-native Managed Agent control plane.

- AMA owns the control plane: projects, agents, environments, sessions, providers, vault references, governance, usage, audit, OpenAPI, UI, sandbox lifecycle, and runtime proxy metadata.
- OIDC owns authentication, users, and organization identity. AMA must not maintain local user or organization tables.
- Pi coding agent is the v1 runtime inside one Cloudflare Sandbox per running session.
- Cloudflare Sandbox owns filesystem, process isolation, and per-session execution.
- Runtime traffic uses Pi protocol directly or through a transparent AMA proxy.
- OpenAPI is the external contract for direct HTTP clients, restish, and generated SDKs.
- The web console uses the shared Hono RPC client for internal control-plane calls.
- Secret values belong in Cloudflare Secrets or an approved external vault. D1 stores metadata, policy, snapshots, and secret references only.

This is a clean-room implementation. Do not copy source, specs, UI text, database schemas, or implementation details from AGPL projects.

## Requirements

- Node.js 24+
- npm
- Wrangler
- Cloudflare account for deployed runtime work
- OIDC application for login flows
- Cloudflare Sandbox/Containers access for live Pi runtime sessions

## Local Setup

```bash
git clone https://github.com/saltbo/any-managed-agents.git
cd any-managed-agents
npm install
cp .env.example .env
npm run dev
```

For local API and browser checks, configure OIDC issuer/client values, `AMA_SESSION_SECRET`, and Workers AI settings. Live runtime sessions require the Cloudflare Sandbox container image built from this repository's `Dockerfile`.

## Common Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Script responsibilities:

- `npm run lint`: Biome checks for formatting and linting.
- `npm run typecheck`: server and web TypeScript projects.
- `npm test`: unit, component, route, and runtime tests.
- `npm run test:e2e`: local Cucumber product specs backed by local resources.
- `npm run test:smoke`: deployed staging smoke that may use real Cloudflare, OIDC, runtime, and model quota.
- `npm run build`: production Vite/Worker build.

Choose the smallest meaningful check for a narrow change. For broad control-plane, runtime, or release work, run lint, typecheck, unit tests, e2e, and build.

## Executable Specs First

Product behavior starts in Gherkin:

1. Write or update a scenario in `specs/product/`.
2. Add or update Cucumber step definitions in `test/e2e/`.
3. Implement Worker, runtime, D1, or UI behavior.
4. Run the smallest meaningful verification command.

`@implemented` product scenarios must exercise real local behavior through local Worker routes, local D1/test bindings, browser pages, or local app harnesses. Static shape checks and pure assertions belong in unit or contract tests, not product e2e specs.

## Architecture Map

```txt
server/            Cloudflare Worker backend, routes, auth, D1, runtime orchestration
server/routes/     API routes and OpenAPI-backed control-plane surfaces
server/auth/       OIDC and session integration
server/db/         D1 schema and persistence helpers
server/runtime/    Cloudflare Sandbox and Pi runtime integration
src/app/           React providers and router setup
src/features/      Route-level console features
src/console/       Shared AMA console components and view models
src/components/ui/ shadcn-generated primitives
specs/product/     Product behavior in Gherkin
test/e2e/          Cucumber steps, browser helpers, and local harnesses
docs/product/      Product decisions, API boundaries, and implementation notes
docs/infra/        Cloudflare deployment and infrastructure notes
```

## API and OpenAPI

Control-plane API behavior must stay aligned across route handlers, validation schemas, tests, and generated OpenAPI output. Stable error envelopes matter. Do not replace structured API errors with ad hoc strings.

OpenAPI is the public contract for operators, generated SDKs, and restish workflows. The browser console should use the shared Hono RPC client instead of ad hoc `fetch('/api/...')` calls.

## Authentication

Use mature OIDC libraries:

- `oidc-client-ts` in the browser for authorization-code PKCE redirect handling.
- `openid-client` in the Worker for provider discovery and token-backed userinfo.

Do not hand-roll token parsing, token validation, callback validation, or OIDC discovery logic.

Expected configuration names use generic OIDC terminology, for example:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `AMA_SESSION_SECRET`

## UI Contributions

Follow `docs/product/ui-ux-standards.md` for visible console work.

- Compose route pages from shadcn primitives and shared AMA components.
- Use React Query for server state.
- Keep primary resources URL-routed and deep-linkable.
- Use shared formatting and confirmation-dialog helpers.
- Check desktop and 390px mobile behavior for visible UI changes.

## Deployment Notes

GitHub Actions runs CI checks. Production and staging deploys should run through Cloudflare Workers Builds unless the deployment policy changes.

For full deployment setup, including D1, OIDC redirect URIs, Cloudflare Sandbox, Workers AI, and Durable Object migration bootstrap, see [docs/infra/cloudflare-deploy.md](docs/infra/cloudflare-deploy.md).

## Pull Request Expectations

- Keep changes focused.
- Update specs or docs when behavior changes.
- Keep route schemas, OpenAPI output, and tests aligned.
- Do not commit `.env`, `.dev.vars`, secrets, local Playwright artifacts, Wrangler state, screenshots, videos, traces, or generated runtime artifacts.
- Prefer failing fast over swallowing errors.
- Delete dead code instead of polishing it.

Before opening a PR, run the smallest verification command that proves the change. For broad changes, run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```
