# Product Decisions

These decisions define the intended end state for Any Managed Agents.

## Environment and Sandbox

- `Environment` is a long-lived sandbox and runtime configuration, not a running sandbox.
- `Environment.hostingMode` is exactly `cloud` or `self_hosted`.
- `Environment.runtime` is exactly `ama`, `claude-code`, `codex`, or `copilot`.
- Environments own hosting mode, runtime, workspace setup, safe secret references, network policy, resource limits, and runtime configuration.
- The target Environment API surface is `hostingMode`, `runtime`, and runtime configuration; implementation work removes the old `runtimeType` surface instead of preserving it as a compatibility contract.
- `Sandbox` is an ephemeral workspace/runtime instance created from an environment snapshot when the selected hosting mode and runtime require Cloudflare Sandbox.
- Each running `cloud` `Session` that requires Cloudflare Sandbox owns exactly one sandbox.
- Sandbox instances follow the session lifecycle and are not reused across sessions.
- Cloudflare Sandbox owns filesystem, shell, process isolation, and the per-session execution environment.
- Sandbox instances are execution environments only and must not expose public ports or preview URLs.
- Environments own network policy. `unrestricted` permits outbound network subject to governance policy, `restricted` requires explicit allowed hosts, and `offline` denies outbound sandbox network operations.

## Runtime Boundary

- The previous decision that AMA cloud-side Pi loop is the only v1 runtime owner is overturned.
- All agent products run as Environment-selected runtimes. `ama`, `claude-code`, `codex`, and `copilot` are peer runtime choices behind the same AMA control plane.
- `Agent` owns persona, instructions, policy, provider, model, skills, tools, and MCP connector configuration.
- `Environment` owns hosting mode, runtime, workspace, secrets, network, resource limits, and runtime config.
- `Session` snapshots the selected Agent and Environment and validates the exact runtime, provider, and model combination before any runtime work starts.
- Session creation must fail before workspace allocation when the selected environment runtime does not support the Agent's exact provider/model.
- `cloud` environments run the selected runtime through AMA-managed Cloudflare infrastructure. `self_hosted` environments run the selected runtime through registered self-hosted runtime workers.
- Self-hosted runners are registered runtime hosts for `self_hosted` environments. They heartbeat safe capability/load metadata, lease session runtime work, renew or finish leases, and upload canonical AMA session events/results through AMA APIs.
- OIDC provider owns authentication, users, and organizations. AMA owns OIDC provider-backed tenancy enforcement, projects, agent, environment, and session metadata, OpenAPI CRUD, sandbox lifecycle, runtime proxy, UI, audit metadata, and usage metadata.
- Runtime traffic uses AMA session endpoints. Browser, SDK, and CLI helpers must not connect directly to sandbox-owned or runner-owned agent processes.
- The canonical AMA session event protocol is the only UI, API, and session-state contract. Every runtime adapter must translate provider, model, tool, workspace, policy, lifecycle, usage, and error activity into that protocol before clients observe state.
- AMA must not define a new incompatible runtime SDK or runtime protocol.
- Cloudflare Agents SDK is not the v1.0 runtime contract and v1.0 must not require `/agents/*` compatibility. It may become a future adapter.

## SDK Ownership

- This repository maintains repo-local generated SDK scaffolds under `sdk/typescript`, `sdk/go`, and `sdk/python` until the SDK release process moves out.
- This repository publishes the control-plane OpenAPI document.
- The TypeScript SDK is the only SDK npm workspace. Go and Python use language-native module or package metadata and are not npm workspaces.
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
