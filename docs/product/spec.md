# Product Spec

Any Managed Agents is a Cloudflare-native managed agents system. It is inspired by CMA and Claude Managed Agents, but it is not vendor locked to Anthropic or any single model provider.

## End State

- The platform can be deployed on Cloudflare Workers.
- This repository publishes OpenAPI for product resource management; SDKs are generated and maintained in separate repositories.
- The control-plane API contract is generated from Hono route schemas.
- The agent runtime uses Cloudflare Agent SDK directly.
- Sandbox execution uses Cloudflare Sandbox SDK directly.
- The platform does not maintain a competing runtime SDK for agent runtime or sandbox execution.
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
- usage and cost records
- audit records
- Cloudflare Secrets references
- governance rules

The platform owns the control-plane OpenAPI contract. Product SDKs are generated and maintained outside this repository. The platform does not own a custom runtime SDK. Runtime interaction must remain compatible with Cloudflare Agent SDK. Sandbox execution must remain compatible with Cloudflare Sandbox SDK.

## Runtime Shape

```txt
Control plane:
  client / external SDK -> /api/* -> Hono OpenAPI routes -> D1 / governance / metadata

Agent runtime:
  client / external SDK helper -> Cloudflare Agent SDK -> /agents/* -> Agent Durable Object

Sandbox runtime:
  Agent Durable Object -> Cloudflare Sandbox SDK -> per-session sandbox execution
```

## Product Model

- `Agent` is a long-lived managed definition: instructions, tools, model policy, default environment, governance rules, and versions.
- `Environment` is a long-lived execution environment description: packages, variables, network policy, resource limits, and metadata.
- `Sandbox` is an ephemeral runtime instance created from an environment snapshot for exactly one session.
- `Session` is a concrete run of an agent. Each session owns exactly one sandbox while it is running.

Sandbox instances follow the session lifecycle, are not reusable across sessions, and must not expose public ports.

## Spec Discipline

Product behavior should be described in BDD specs before implementation. These specs are primarily for agents and developers, not for end users.

See `specs/product/spec-index.md` for the current product spec map.

See `docs/product/decisions.md` for fixed product decisions.

See `docs/product/sdk.md` for the SDK ownership boundary.
