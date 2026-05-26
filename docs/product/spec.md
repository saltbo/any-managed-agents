# Product Spec

Any Managed Agents is a Cloudflare-native managed agents system. It is inspired by CMA and Claude Managed Agents, but it is not vendor locked to Anthropic or any single model provider.

## End State

- The platform can be deployed on Cloudflare Workers.
- This repository publishes OpenAPI for product resource management and keeps generated SDK scaffolds under `sdk/` until SDK release ownership moves out.
- The control-plane API contract is generated from Hono route schemas.
- The web console uses the project-local Hono RPC client for internal control-plane calls.
- Command-line automation uses restish against the published OpenAPI document; this repository does not maintain a bespoke CLI binary.
- The project provides an agent-facing skill that teaches automation agents how to use restish with the AMA OpenAPI document.
- The v1.0 agent runtime loop and session state machine are owned by AMA cloud-side code.
- Runtime traffic goes through AMA session endpoints; AMA may use Pi Core loop/state primitives internally, but clients do not connect to a Pi process in the sandbox.
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
- agent definitions
- provider configuration for all supported providers
- model policy
- sandbox policy
- session metadata
- environment metadata
- sandbox lifecycle
- self-hosted runner metadata and work leases
- runtime endpoint and event transport
- UI surfaces
- usage and cost records
- audit records
- Cloudflare Secrets references
- governance rules

AMA owns the runtime protocol surface, session state machine, prompt, abort, follow-up, steer semantics, policy gates, and event persistence. v1 uses `@earendil-works/pi-agent-core` from cloud-side Worker code for the prompt loop, message state, and tool-call event flow.

Cloudflare Sandbox owns filesystem, shell, process isolation, and per-session tool execution. It is an executor backend, not the owner of the agent loop.

AMA must not define a custom sandbox SDK. Sandbox access is an internal platform responsibility behind environments, sessions, policy, and tool executor dispatch.

The platform owns the control-plane OpenAPI contract. Repo-local generated SDK scaffolds live under `sdk/typescript`, `sdk/go`, and `sdk/python` and are regenerated from the Hono-generated OpenAPI document. Product SDKs manage control-plane resources and may provide thin helpers that connect to AMA runtime endpoints, but they must not define a replacement runtime protocol. Hand-authored SDK behavior that drifts from OpenAPI does not belong in this repository.

Command-line usage is a control-plane concern. Operators use restish with the published OpenAPI document for resource management instead of a project-specific CLI implementation. Agent skills may wrap this workflow as documentation and task guidance, but they must still call the OpenAPI-described control plane and preserve the AMA runtime boundary.

The web console is an internal control-plane entrypoint. It uses Hono RPC for shared auth, error handling, tenancy, and response parsing. External developers and operators use the OpenAPI document through direct HTTP, generated SDKs, or restish.

## Runtime Shape

```txt
Control plane:
  web console -> Hono RPC client -> /api/* -> Hono OpenAPI routes -> D1 / governance / metadata
  client / generated SDK / restish -> /api/openapi.json + /api/* -> Hono OpenAPI routes -> D1 / governance / metadata

Runtime:
  client / external SDK helper -> AMA runtime endpoint -> AMA cloud-owned session loop -> D1 events

Tool execution:
  AMA session loop -> environment snapshot policy gates -> ToolExecutor -> Cloudflare Sandbox /workspace
  AMA session loop -> runner work queue -> self-hosted runner lease -> structured events/results -> D1 events
```

## Product Model

- `Agent` is a long-lived managed definition: instructions, carried skills, tool declarations, model config, metadata, and versions. Agents do not bind environments and do not own sandbox or network policy.
- `Environment` is a long-lived sandbox and runtime configuration: runtime type, packages, variables, network policy, resource limits, executor image configuration, and metadata. It is not a running sandbox.
- `Sandbox` is an ephemeral runtime instance created from an environment snapshot for exactly one session.
- `Session` is a concrete run of an agent in an explicitly selected environment. Each session binds an agent version snapshot, environment snapshot, safe resource references, sandbox id, cloud runtime state, events, and status. Each running session owns exactly one sandbox executor backend.
- `Runner` is a registered self-hosted tool executor backend. Runners heartbeat capability, load, and safe metadata to AMA, claim leases for queued work, upload structured events/results, and never own the Pi runtime loop.

Environment `runtimeType` is either `cloud-hosted` or `self-hosted`. Cloud-hosted sessions use the Cloudflare Sandbox ToolExecutor. Self-hosted environments enqueue runner work and keep sessions pending with `statusReason: "waiting-for-runner"` until an eligible runner claims a lease. Self-hosted session creation must not create a Cloudflare Sandbox or expose runner-local endpoints.

Runner credentials are stored outside D1. D1 may store runner ids, names, capabilities, environment binding metadata, heartbeat/load state, work item payloads, lease state, result/error metadata, and secret references only. Raw runner tokens, provider secrets, or vault secret values must not appear in D1, OpenAPI responses, events, logs, or UI state.

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

AMA stores only safe references. Raw tokens, clone URLs with embedded credentials, path traversal, and mount paths outside `/workspace` are rejected. Cloud-hosted session startup writes `/workspace/.ama/resources.json` with declared GitHub resources sorted by mount path. The manifest is a deterministic setup contract for the runtime/tool executor layer; repositories are not considered cloned or mounted until that layer performs setup using approved credential references.

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
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`,
  and `npm run build`.

Secrets must remain in Cloudflare Secrets or external vaults. D1 may store
metadata, policy, snapshots, and secret references, but not raw secret values.
