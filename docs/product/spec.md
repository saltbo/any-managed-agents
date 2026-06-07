# Product Spec

Any Managed Agents is a Cloudflare-native managed agents system. It is inspired by CMA and Claude Managed Agents, but it is not vendor locked to Anthropic or any single model provider.

## End State

- The platform can be deployed on Cloudflare Workers.
- This repository publishes OpenAPI for product resource management and keeps generated SDK scaffolds under `sdk/` until SDK release ownership moves out.
- The control-plane API contract is generated from Hono route schemas.
- The web console uses the project-local Hono RPC client for internal control-plane calls.
- Command-line automation uses restish against the published OpenAPI document; this repository does not maintain a bespoke CLI binary.
- The project provides an agent-facing skill that teaches automation agents how to use restish with the AMA OpenAPI document.
- Agent products run as Environment-selected runtimes. `ama`, `claude-code`, `codex`, and `copilot` are runtime choices behind one AMA control-plane and event surface.
- The `ama` runtime is the first-party AMA/Pi runtime. External runtimes such as `claude-code`, `codex`, and `copilot` are runner-managed integrations, not replacements for AMA's control plane.
- Runtime traffic goes through AMA session endpoints; clients do not connect directly to sandbox-owned or runner-owned agent processes.
- The canonical AMA session event protocol is the only UI, API, and session-state contract.
- Cloudflare Agents SDK is not the v1.0 runtime contract. It may be added later as an adapter, but v1.0 must not require `/agents/*` compatibility.
- The platform does not maintain a competing runtime SDK or incompatible runtime protocol.
- Workers AI is a first-class provider, and the model layer supports all configured providers through provider adapters.
- Anthropic is optional, not required.
- Authentication is delegated to OIDC provider.
- OIDC provider owns users and organizations; AMA stores project and product-resource metadata only.
- Secret values are stored in Cloudflare Secrets; D1 stores metadata and references only.
- BDD specs are the agent-facing acceptance contract for development and verification.
- E2E specs use Cucumber with Playwright.

## Boundary

The platform owns the control plane:

- OIDC provider-backed tenancy and AMA projects
- agent definitions for persona, instructions, policy, provider, model, skills, tools, and MCP connectors
- provider configuration for all supported providers
- model policy
- sandbox and runtime policy
- session metadata
- environment hosting, runtime, workspace, network, resource, secret-reference, and runtime-config metadata
- sandbox lifecycle
- self-hosted runtime runner metadata and work leases
- runtime endpoint and event transport
- UI surfaces
- usage and cost records
- audit records
- Cloudflare Secrets references
- governance rules

AMA owns the control-plane surface, tenant enforcement, session record state machine, runtime endpoint, policy gates, and event persistence. The `ama` runtime owns first-party AMA/Pi loop behavior. External runtime adapters for `claude-code`, `codex`, and `copilot` are launched and observed by self-hosted runners while AMA remains the canonical session owner.

Cloudflare Sandbox owns filesystem, shell, process isolation, and per-session `cloud` workspace execution. Self-hosted runners own `self_hosted` external runtime process execution after claiming session work. Neither surface may expose raw runtime process endpoints to product clients.

AMA must not define a custom sandbox SDK. Sandbox access is an internal platform responsibility behind environments, sessions, policy, and tool executor dispatch.

The platform owns the control-plane OpenAPI contract. Repo-local generated SDK scaffolds live under `sdk/typescript`, `sdk/go`, and `sdk/python` and are regenerated from the Hono-generated OpenAPI document. Product SDKs manage control-plane resources and may provide thin helpers that connect to AMA runtime endpoints, but they must not define a replacement runtime protocol. Hand-authored SDK behavior that drifts from OpenAPI does not belong in this repository.

Command-line usage is a control-plane concern. Operators use restish with the published OpenAPI document for resource management instead of a project-specific CLI implementation. Agent skills may wrap this workflow as documentation and task guidance, but they must still call the OpenAPI-described control plane and preserve the AMA session endpoint boundary.

The web console is an internal control-plane entrypoint. It uses Hono RPC for shared auth, error handling, tenancy, and response parsing. External developers and operators use the OpenAPI document through direct HTTP, generated SDKs, or restish.

## Runtime Shape

```txt
Control plane:
  web console -> Hono RPC client -> /api/* -> Hono OpenAPI routes -> D1 / governance / metadata
  client / generated SDK / restish -> /api/openapi.json + /api/* -> Hono OpenAPI routes -> D1 / governance / metadata

Runtime:
  client / external SDK helper -> AMA session endpoint -> selected session runtime -> canonical AMA session events -> D1 events

Runtime hosting:
  cloud environment -> AMA-managed Cloudflare infrastructure -> selected runtime -> workspace / safe secrets / policy gates
  self_hosted environment -> runner work queue -> self-hosted runtime lease -> per-session runner WebSocket -> selected external runtime -> structured events/results
```

## Product Model

- `Agent` is a long-lived managed definition: persona, instructions, policy, provider, model, carried skills, tool declarations, MCP connectors, metadata, and versions. Agents do not bind environments and do not own hosting, workspace, secrets, network, or resource policy.
- `Environment` is a long-lived hosting and runtime configuration: hosting mode, runtime, workspace setup, packages, variables, safe secret references, network policy, resource limits, runtime config, and metadata. It is not a running sandbox or runner.
- `Sandbox` is an ephemeral `cloud` workspace/runtime instance created from an environment snapshot for exactly one cloud session when the selected hosting/runtime combination requires Cloudflare Sandbox.
- `Session` is a concrete run of an agent in an explicitly selected environment. Each session binds an agent version snapshot, environment snapshot, safe resource references, runtime/provider/model validation result, runtime endpoint, canonical AMA session events, and status.
- `Runner` is a registered `self_hosted` runtime host. Runners heartbeat capability, supported runtime/provider/model combinations, load, and safe metadata to AMA, claim leases for queued self-hosted session runtime work, open one outbound session WebSocket per claimed session, and send canonical AMA session events/results through AMA.

Environment `hostingMode` is exactly `cloud` or `self_hosted`. Environment `runtime` is exactly `ama`, `claude-code`, `codex`, or `copilot`.

The Environment API surface is `hostingMode`, `runtime`, and `runtimeConfig`. Hosting mode chooses AMA-managed cloud infrastructure or registered self-hosted runners, while `runtime` selects the adapter family and `runtimeConfig` stores runtime-owned configuration such as image, command, or adapter settings.

Session creation validates the selected Agent provider/model against the selected Environment runtime and hosting mode. If the exact runtime/provider/model combination is unsupported, session creation fails before workspace allocation, sandbox creation, or self-hosted lease creation.

`cloud` sessions use AMA-managed Cloudflare infrastructure for the selected runtime. `self_hosted` environments enqueue runtime work and keep sessions pending with `statusReason: "waiting-for-runner"` until an eligible runner that supports the exact runtime/provider/model combination claims a lease. `self_hosted` session creation must not create a Cloudflare Sandbox or expose runner-local endpoints.

Queue and lease APIs solve session dispatch, ownership, heartbeat, expiry, and recovery. They are not the per-tool real-time execution path. After a runner claims a self-hosted session, the runner opens an outbound WebSocket for that exact session because self-hosted runners may sit behind NAT or firewalls. AMA sends approved runtime/tool calls over that claimed session channel, and the runner streams lifecycle, stdout, stderr, output, timing, usage, safe errors, and tool/runtime results back over the same channel. A self-hosted session becomes active only after AMA accepts the claimed runner session channel. Duplicate, stale, or mismatched runner channels cannot submit results.

All runtimes emit canonical AMA session events. The protocol covers lifecycle, message, provider call, tool call, workspace, policy, usage, and error events with monotonically increasing sequence numbers, stable ids, redacted payloads, and runtime-specific details confined to safe metadata.

Runner authentication uses FlareAuth/OIDC. `ama-runner login` uses OAuth/OIDC device authorization for the registered runner client and stores token material only in the local runner config. AMA validates FlareAuth-issued bearer tokens, binds OIDC runner registrations to the creating token subject/client id, rejects runner heartbeats, lease operations, event upload, or session WebSocket upgrades when the bearer token does not match that binding, and rejects runner-scoped device tokens on non-runner control-plane resources. AMA must not implement a parallel runner credential issuer. D1 may store runner ids, names, OIDC subject/client binding metadata, capabilities, supported runtime/provider/model combinations, environment binding metadata, heartbeat/load state, work item payloads, lease state, result/error metadata, and secret references only. Raw runner tokens, provider secrets, or vault secret values must not appear in D1, OpenAPI responses, events, logs, or UI state.

Environment `networkPolicy.mode` is exactly `unrestricted`, `restricted`, or `offline`. Restricted policy requires explicit `allowedHosts`; unrestricted and offline policy do not carry host allow-lists. Offline policy denies outbound sandbox network operations.

Sandbox instances follow the session lifecycle, are not reusable across sessions, and must not expose public ports.

Session `resourceRefs` may include GitHub repository declarations:

```json
{
  "type": "github_repository",
  "owner": "saltbo",
  "repo": "any-managed-agents",
  "ref": "main",
  "mountPath": "/workspace/repos/saltbo/any-managed-agents",
  "credentialRef": "vaultcred_abc123"
}
```

AMA stores only safe references. Raw tokens, clone URLs with embedded credentials, path traversal, and mount paths outside `/workspace` are rejected. `cloud` session startup writes `/workspace/.ama/resources.json` with declared GitHub resources sorted by mount path. The manifest is a deterministic setup contract for the selected runtime layer; repositories are not considered cloned or mounted until that layer performs setup using approved credential references.

## Spec Discipline

Product behavior should be described in BDD specs before implementation. These specs are primarily for agents and developers, not for end users.

See `specs/product/spec-index.md` for the current product spec map.

See `docs/product/decisions.md` for fixed product decisions.

See `docs/product/sdk.md` for the SDK ownership and generation boundary.

## v1.0 Acceptance

The first release is accepted when a signed-in user can create an environment,
create an agent, create a session by selecting an agent and environment, send a task through the AMA runtime endpoint,
inspect persisted session events, and stop the session.

Release verification must include:

- OIDC login through `openid-client`, with no hand-written OIDC token
  parsing or validation.
- Agent, environment, and session CRUD covered by Cloudflare integration tests.
- OpenAPI generated from Hono route schemas for auth, agents, environments, and
  sessions.
- UI coverage for signed-out and signed-in console states.
- BDD release acceptance scenarios in `specs/product/`.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run test:e2e`,
  and `pnpm run build`.

Secrets must remain in Cloudflare Secrets or external vaults. D1 may store
metadata, policy, snapshots, and secret references, but not raw secret values.
