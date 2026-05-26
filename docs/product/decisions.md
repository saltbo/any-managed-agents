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

- v1.0 runs the session loop and runtime state machine in AMA cloud-side code.
- AMA uses `@earendil-works/pi-agent-core` from cloud-side Worker code for the v1 prompt loop, message state, and tool-call event flow. The full Pi/PyAgent binary is not launched inside the sandbox.
- Cloudflare Sandbox and future self-hosted runners are tool executor backends. They execute approved tool requests in `/workspace` and return structured results/events.
- OIDC provider owns authentication, users, and organizations. AMA owns OIDC provider-backed tenancy enforcement, projects, agent, environment, and session metadata, OpenAPI CRUD, sandbox lifecycle, runtime proxy, UI, audit metadata, and usage metadata.
- Runtime traffic uses AMA session endpoints. Browser, SDK, and CLI helpers must not connect directly to sandbox-owned agent processes.
- AMA must not define a new incompatible runtime SDK or runtime protocol.
- Cloudflare Agents SDK is not the v1.0 runtime contract and v1.0 must not require `/agents/*` compatibility. It may become a future adapter.

## SDK Ownership

- This repository does not maintain SDK source code.
- This repository publishes the control-plane OpenAPI document.
- TypeScript, Python, Go, and other SDKs should live in separate repositories.
- External SDKs must be generated from or mechanically aligned with this repository's OpenAPI document.
- Runtime helpers in external SDKs must delegate to AMA runtime endpoints.
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
