# Product Spec

Any Managed Agents is a Cloudflare-native managed agents system. It is inspired by CMA and Claude Managed Agents, but it is not vendor locked to Anthropic or any single model provider.

## End State

- The platform can be deployed on Cloudflare Workers.
- This repository publishes OpenAPI for product resource management; SDKs are generated and maintained in separate repositories.
- The control-plane API contract is generated from Hono route schemas.
- Command-line automation uses restish against the published OpenAPI document; this repository does not maintain a bespoke CLI binary.
- The project provides an agent-facing skill that teaches automation agents how to use restish with the AMA OpenAPI document.
- The v1.0 agent runtime is Pi coding agent running inside a per-session Cloudflare Sandbox.
- Runtime traffic uses Pi protocol directly or through a transparent AMA proxy around Pi RPC and JSON session events.
- Cloudflare Agents SDK is not the v1.0 runtime contract. It may be added later as an adapter, but v1.0 must not require `/agents/*` compatibility.
- The platform does not maintain a competing runtime SDK or incompatible runtime protocol.
- Workers AI is a first-class provider, and the model layer supports all configured providers through provider adapters.
- Anthropic is optional, not required.
- Authentication is delegated to FlareAuth.
- Secret values are stored in Cloudflare Secrets; D1 stores metadata and references only.
- BDD specs are the agent-facing acceptance contract for development and verification.
- E2E specs use Cucumber with Playwright.

## Boundary

The platform owns the control plane:

- organizations, projects, and users
- agent definitions
- provider configuration for all supported providers
- model policy
- sandbox policy
- session metadata
- environment metadata
- sandbox lifecycle
- runtime proxy
- UI surfaces
- usage and cost records
- audit records
- Cloudflare Secrets references
- governance rules

Pi coding agent owns the runtime protocol, agent loop, built-in coding tools, session events, and prompt, abort, follow-up, and steer semantics. AMA must proxy or adapt Pi protocol rather than inventing a new incompatible runtime protocol.

Cloudflare Sandbox owns the filesystem, shell, process isolation, and per-session execution environment.

AMA must not define a custom sandbox SDK. Sandbox access is an internal platform responsibility behind environments, sessions, policy, and Pi runtime execution.

The platform owns the control-plane OpenAPI contract. Product SDKs are generated and maintained outside this repository. Product SDKs manage control-plane resources and may provide thin helpers that connect to Pi runtime sessions through the AMA proxy, but they must not define a replacement runtime protocol.

Command-line usage is a control-plane concern. Operators use restish with the published OpenAPI document for resource management instead of a project-specific CLI implementation. Agent skills may wrap this workflow as documentation and task guidance, but they must still call the OpenAPI-described control plane and preserve the Pi runtime boundary.

## Runtime Shape

```txt
Control plane:
  client / external SDK / restish -> /api/* -> Hono OpenAPI routes -> D1 / governance / metadata

Runtime proxy:
  client / external SDK helper -> AMA runtime proxy -> Pi RPC / JSON event stream

Sandbox runtime:
  AMA session lifecycle -> Cloudflare Sandbox -> Pi coding agent process -> /workspace
```

## Product Model

- `Agent` is a long-lived managed definition: instructions, tools, model policy, governance rules, and versions. Agents do not bind environments.
- `Environment` is a long-lived sandbox and runtime configuration: packages, variables, network policy, resource limits, Pi runtime configuration, and metadata. It is not a running sandbox.
- `Sandbox` is an ephemeral runtime instance created from an environment snapshot for exactly one session.
- `Session` is a concrete run of an agent in an explicitly selected environment. Each session binds an agent version snapshot, environment snapshot, sandbox id, Pi session or runtime id, and status. Each running session owns exactly one sandbox.

Sandbox instances follow the session lifecycle, are not reusable across sessions, and must not expose public ports.

## Spec Discipline

Product behavior should be described in BDD specs before implementation. These specs are primarily for agents and developers, not for end users.

See `specs/product/spec-index.md` for the current product spec map.

See `docs/product/decisions.md` for fixed product decisions.

See `docs/product/sdk.md` for the SDK ownership boundary.

## v1.0 Acceptance

The first release is accepted when a signed-in user can create an environment,
create an agent, create a session by selecting an agent and environment, send a task to the Pi runtime through the AMA
runtime proxy, inspect persisted session events, and stop the session.

Release verification must include:

- FlareAuth OIDC login through `openid-client`, with no hand-written OIDC token
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
