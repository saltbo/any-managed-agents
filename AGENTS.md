# Any Managed Agents Development Guide

## Clean-Room Boundary

- Do not copy code, specs, UI text, database schemas, or implementation details from AGPL projects.
- Use Cloudflare documentation, public product behavior, and locally authored specs as inputs.
- Keep this project under Apache-2.0-compatible dependencies unless explicitly reviewed.
- When comparing another project, use it only to identify capability categories, test gaps, and workflow ideas. Re-express all requirements in this repository's own product language.

## Product Boundaries

- Any Managed Agents is Cloudflare-native: Workers, D1, Durable Objects, Cloudflare Sandbox, Workers AI, and Cloudflare Secrets are the default platform assumptions.
- Prefer mature community libraries for established protocols and hard problems instead of reimplementing them locally. This applies to auth protocols, OpenAPI tooling, validation, crypto, date/time handling, UI primitives, routing, data fetching, and runtime integrations.
- FlareAuth owns authentication, users, and organizations. OIDC must use mature community libraries such as `openid-client` and `oidc-client-ts`; do not hand-roll token parsing, token validation, callback validation, or discovery logic.
- Pi coding agent is the v1.0 runtime inside one Cloudflare Sandbox per running session.
- AMA owns the control plane: auth integration, FlareAuth-backed tenancy enforcement, projects, agents, environments, sessions, providers, vaults, governance, usage, audit, OpenAPI, UI, sandbox lifecycle, and runtime proxy metadata. AMA must not maintain local user or organization tables.
- AMA must not invent a competing runtime protocol, sandbox SDK, or agent loop. Runtime traffic uses Pi protocol directly or a transparent AMA proxy.
- Cloudflare Agents SDK is not the v1.0 runtime contract. It may be added later as an adapter, but v1.0 must not require `/agents/*` compatibility.
- Command-line automation uses `restish` against the published OpenAPI document. Do not add a bespoke CLI binary unless the product decision changes.
- Agent-facing skills may document restish workflows, but they must call OpenAPI-described control-plane operations and preserve the Pi runtime boundary.
- Web UI code is an internal product entrypoint and should call the control plane through the shared Hono RPC client. External operators, generated SDKs, and restish use the published OpenAPI document.
- Secret values belong in Cloudflare Secrets or an approved external vault. D1 stores metadata, policy, snapshots, and secret references only.

## Workflow: Executable Specs First

1. Write or update a Gherkin scenario in `specs/product/`.
2. Add or update Cucumber step definitions in `test/e2e/`.
3. Implement the Worker, Agent, D1, or UI behavior.
4. Run the smallest meaningful check:
   - `npm run test:e2e`
   - `npm run typecheck`
   - `npm run test`

Scenarios should describe business behavior. Selectors, fixtures, and platform details belong in step definitions and helpers.

If implementation discovers a missing product decision or behavior, stop widening the code change and update the relevant spec or product doc first.

## BDD And Step Definition Rules

- Product specs in `specs/product/` are local end-to-end acceptance tests. `@implemented` product scenarios must run through the local app, local Worker routes, local D1/test bindings, public HTTP APIs, or a real browser page. Do not satisfy a product scenario with only constants, static file reads, schema existence checks, or `assert.ok(true)`.
- `npm run test:e2e` is the only product-spec runner. It runs `@implemented and not @planned` scenarios against local resources. Do not make product e2e depend on production, staging, real model quota, real user credentials, or direct database access.
- Staging or production verification belongs in `specs/smoke/` and `npm run test:smoke`. Smoke scenarios may use real FlareAuth, Cloudflare, Workers AI, and deployed runtime resources, but they must not replace local product e2e coverage.
- Unit tests, pure protocol constants, static documentation checks, lint, typecheck, and build checks do not belong in product Gherkin. Put those in `npm test`, `npm run lint`, `npm run typecheck`, or dedicated scripts.
- OpenAPI/restish coverage may appear in product e2e only when it talks to a locally running AMA harness or local Worker app. Static OpenAPI shape checks are contract tests, not product behavior, unless paired with an actual local request flow.
- Restish behavior belongs in Cucumber step definitions and `test/e2e` support code. Do not add standalone `scripts/` test runners for product-spec behavior.
- Every `@implemented` scenario should have meaningful Given/When/Then causality: setup real local state, perform one user/API/browser action, then assert externally observable behavior. Avoid repeated generic steps that execute the same helper without scenario-specific assertions.
- `@planned` means accepted product intent that is not yet implemented or not yet covered by local e2e. When a feature ships, update the scenario to `@implemented` in the same change that adds the step coverage.
- Prefer reusable helpers for setup and cleanup, but keep step names product-specific. A reader should be able to tell what behavior is being verified without opening the helper.

## Architecture Map

- `server/` - Cloudflare Worker backend, Hono routes, auth, D1 access, runtime orchestration, and Pi bridge code.
- `server/routes/` - API routes and OpenAPI-backed control-plane surfaces.
- `server/auth/` - FlareAuth and session integration.
- `server/db/` - D1 schema and persistence helpers.
- `server/runtime/` - Cloudflare Sandbox and Pi runtime integration.
- `src/app/` - React application providers and router setup.
- `src/features/` - Route-level feature orchestration for console pages.
- `src/features/console/` - Shared authenticated console shell and context.
- `src/console/` - Reusable AMA product components, form helpers, formatting, defaults, and view models.
- `src/components/ui/` - shadcn-generated primitives. Prefer these before writing custom primitives.
- `specs/product/` - Product behavior in Gherkin. `@planned` scenarios are design intent; unplanned implemented scenarios are executable acceptance.
- `test/e2e/` - Cucumber step definitions, browser helpers, and local e2e harnesses.
- `docs/product/` - Product decisions, UI/UX standards, API/SDK boundaries, and implementation notes.
- `docs/infra/` - Cloudflare deployment and infrastructure notes.

## UI/UX Rules

- Follow `docs/product/ui-ux-standards.md` for all visible console work.
- `src/App.tsx` should compose providers and `RouterProvider`; primary route definitions belong in `src/app/router.tsx`.
- Primary resources must be URL-routed and deep-linkable. Do not drive major pages only through local view state.
- Use React Query for server state. Do not add feature-level `useEffect + useState` API loading loops.
- Use the shared Hono RPC client for browser control-plane calls. Do not add ad hoc `fetch('/api/...')` clients in feature code.
- Compose route pages from shadcn primitives and shared AMA components. Do not recreate local button, input, card, panel, or field systems.
- Forms use shadcn `Field` primitives for labels, descriptions, errors, and validation layout.
- Date and time display uses the shared dayjs-backed formatter in `src/console/format.ts`.
- Destructive actions use the shared confirmation dialog.
- For visible UI changes, check desktop and 390px mobile behavior. Avoid horizontal scrolling, truncated mobile nav labels, card-in-card layouts, and marketing-style hero surfaces inside the console.

## API And OpenAPI Rules

- Control-plane API behavior must be represented in OpenAPI generated from route schemas.
- Keep route handlers, validation schemas, tests, and OpenAPI output aligned in the same change.
- Stable error envelopes matter; do not replace structured API errors with ad hoc strings.
- OpenAPI is the contract for direct HTTP, generated SDKs, and restish CLI workflows.
- OpenAPI is the external contract. It should not become the internal browser client implementation when Hono RPC can provide the project-local API entrypoint.

## Runtime And Session Rules

- A running session owns exactly one sandbox.
- Environments are reusable configuration and policy snapshots, not running containers.
- A session binds immutable agent and environment snapshots for runtime execution.
- Session events, transcript, tool calls, usage, policy decisions, and safe runtime errors must remain inspectable after completion or failure.
- Do not expose raw sandbox ports or preview URLs as the product surface.

## Verification

Choose the smallest meaningful check, then broaden when touching shared contracts:

- Product/e2e specs: `npm run test:e2e`
- Type safety: `npm run typecheck`
- Unit/integration/runtime tests: `npm test`
- Lint/format checks: `npm run lint`
- Production build: `npm run build`
- Staging smoke after deployment: `npm run test:smoke`

For v1 acceptance or broad changes, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.

## Local Safety

- Do not commit `.dev.vars`, `.env`, secrets, local Playwright captures, Wrangler state, or generated runtime artifacts.
- Do not change real Cloudflare resource names, account ids, service bindings, or deployment targets unless the task requires it.
- Prefer failing fast over adding fallback logic. Add defensive handling only at real boundaries: user input, external APIs, network, filesystem, and process execution.
