# Product Decisions

These decisions define the intended end state for Any Managed Agents.

## Environment and Sandbox

- `Environment` is a long-lived sandbox and runtime configuration, not a running sandbox.
- `Environment.hostingMode` is exactly `cloud` or `self_hosted`.
- `Environment.runtime` is exactly `ama`, `claude-code`, `codex`, or `copilot`.
- Environments own hosting mode, runtime, workspace setup, safe secret references, network policy, resource limits, and runtime configuration.
- The Environment API surface is `hostingMode`, `runtime`, and `runtimeConfig`; compatibility aliases for hosting or runtime image fields are not part of the public contract.
- `Sandbox` is an ephemeral workspace/runtime instance created from an environment snapshot when the selected hosting mode and runtime require Cloudflare Sandbox.
- Each running `cloud` `Session` that requires Cloudflare Sandbox owns exactly one sandbox.
- Sandbox instances follow the session lifecycle and are not reused across sessions.
- Cloudflare Sandbox owns filesystem, shell, process isolation, and the per-session execution environment.
- Sandbox instances are execution environments only and must not expose public ports or preview URLs.
- Environments own network policy. `unrestricted` permits outbound network subject to governance policy, `restricted` requires explicit allowed hosts, and `offline` denies outbound sandbox network operations.

## Runtime Boundary

- All agent products run as Environment-selected runtimes behind the same AMA control plane and canonical session event surface.
- The `ama` runtime is the first-party AMA/Pi runtime owned by the cloud control plane.
- `claude-code`, `codex`, and `copilot` are external agent runtimes launched, managed, observed, and translated by self-hosted `ama-runner` processes.
- `Agent` owns persona, instructions, policy, provider, model, skills, tools, and MCP connector configuration.
- `Environment` owns hosting mode, runtime, workspace, secrets, network, resource limits, and runtime config.
- `Session` snapshots the selected Agent and Environment and validates the exact runtime, provider, and model combination before any runtime work starts.
- Session creation must fail before workspace allocation when the selected session runtime does not support the Agent's exact provider/model.
- `cloud` environments run first-party AMA runtime execution through AMA-managed Cloudflare infrastructure. `self_hosted` environments run external agent runtimes through registered self-hosted runtime runners.
- Self-hosted runners are registered runtime hosts for `self_hosted` environments. They heartbeat safe capability/load metadata, claim session leases, renew or finish leases, open one outbound WebSocket per claimed session, execute runtime/tool work locally, and stream canonical AMA session events/results through AMA.
- Runner HTTP queue and lease APIs are for dispatch, ownership, heartbeat, expiry, recovery, and audit. A claimed self-hosted session uses its runner-owned session WebSocket as the real-time runtime/tool execution path.
- A claimed self-hosted session becomes active only after AMA authenticates and accepts the runner session WebSocket. Duplicate, stale, or mismatched runner channels cannot submit tool or runtime results.
- OIDC provider owns authentication, users, and organizations. AMA owns OIDC provider-backed tenancy enforcement, projects, agent, environment, and session metadata, OpenAPI CRUD, sandbox lifecycle, runtime proxy, UI, audit metadata, and usage metadata.
- Runtime traffic uses AMA session endpoints. Browser, SDK, and CLI helpers must not connect directly to sandbox-owned or runner-owned agent processes.
- The canonical AMA session event protocol is the only UI, API, and session-state contract. Every runtime adapter must translate provider, model, tool, workspace, policy, lifecycle, usage, and error activity into that protocol before clients observe state.
- AMA must not define a new incompatible runtime SDK or runtime protocol.
- Cloudflare Agents SDK is not the v1.0 runtime contract and v1.0 must not require `/agents/*` compatibility. It may become a future adapter.

## SDK Ownership

- This repository maintains repo-local generated SDK scaffolds under `sdk/typescript`, `sdk/go`, and `sdk/python` until the SDK release process moves out.
- This repository publishes the control-plane OpenAPI document.
- The TypeScript SDK is the only SDK pnpm workspace. Go and Python use language-native module or package metadata and are not pnpm workspaces.
- External SDK behavior must be generated from or mechanically aligned with this repository's Hono-generated OpenAPI document.
- This repository must not accumulate hand-authored bespoke SDK behavior that drifts from OpenAPI.
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
- Runner daemon authentication uses FlareAuth/OIDC device login. AMA validates provider-issued bearer tokens, binds OIDC runner operation to the runner registration subject/client id, rejects runner-scoped tokens on non-runner control-plane resources, and must not build a parallel runner credential issuer.

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
