# Product Decisions

These decisions define the intended end state for Any Managed Agents.

## Environment and Sandbox

- `Environment` is a long-lived sandbox and runtime configuration, not a running sandbox.
- `Sandbox` is a runtime instance created from an environment snapshot.
- Each running `Session` owns exactly one sandbox.
- Sandbox instances follow the session lifecycle and are not reused across sessions.
- Cloudflare Sandbox owns filesystem, shell, process isolation, and the per-session execution environment.
- Sandbox instances are execution environments only and must not expose public ports or preview URLs.

## Runtime Boundary

- v1.0 runs Pi coding agent inside one Cloudflare Sandbox per session.
- Pi coding agent owns the runtime protocol, agent loop, built-in coding tools, session events, and prompt, abort, follow-up, and steer semantics.
- OIDC provider owns authentication, users, and organizations. AMA owns OIDC provider-backed tenancy enforcement, projects, agent, environment, and session metadata, OpenAPI CRUD, sandbox lifecycle, runtime proxy, UI, audit metadata, and usage metadata.
- Runtime traffic uses Pi protocol directly or a transparent AMA proxy around Pi RPC and JSON event streams.
- AMA must not define a new incompatible runtime SDK or runtime protocol.
- Cloudflare Agents SDK is not the v1.0 runtime contract and v1.0 must not require `/agents/*` compatibility. It may become a future adapter.

## SDK Ownership

- This repository does not maintain SDK source code.
- This repository publishes the control-plane OpenAPI document.
- TypeScript, Python, Go, and other SDKs should live in separate repositories.
- External SDKs must be generated from or mechanically aligned with this repository's OpenAPI document.
- Runtime helpers in external SDKs must delegate to Pi protocol or transparent AMA Pi proxy endpoints.
- The web console is an internal entrypoint and uses Hono RPC for control-plane calls. OpenAPI remains the external contract for direct HTTP, generated SDKs, and restish.

## CLI Ownership

- This repository does not maintain a bespoke CLI binary.
- Command-line automation uses restish against the published control-plane OpenAPI document.
- OpenAPI remains the source of truth for CLI operation discovery, fields, auth, and response shapes.
- Agent-facing skills may document restish workflows, but must not introduce a separate runtime protocol or command contract.

## Authentication

- Authentication integrates with OIDC provider.
- This project must not reimplement a parallel authentication system.
- Control-plane and runtime requests resolve tenant context from OIDC sessions or credentials.

## Providers

- Workers AI is first-class.
- All configured providers should be supported through provider adapters.
- Provider behavior should be normalized for usage, policy, errors, and audit records.

## Secrets

- Secret values are stored in Cloudflare Secrets.
- D1 stores metadata and references only.
- API responses, events, logs, and UI views must not expose raw secret values.

## Specs

- Gherkin is the product spec format.
- Cucumber is the executable spec runner.
- E2E specs use Cucumber step definitions backed by Playwright.
