# Product Spec

Any Managed Agents is a Cloudflare-native managed agents system. It is inspired by CMA and Claude Managed Agents, but it is not vendor locked to Anthropic or any single model provider.

## End State

- The platform can be deployed on Cloudflare Workers.
- The platform provides a thin Any Managed Agents SDK for product resource management.
- The control-plane API contract is generated from Hono route schemas.
- The agent runtime uses Cloudflare Agent SDK directly.
- Sandbox execution uses Cloudflare Sandbox SDK directly.
- The platform does not maintain a competing runtime SDK for agent runtime or sandbox execution.
- Workers AI is a first-class provider, but the model layer supports multiple providers.
- Anthropic is optional, not required.
- BDD specs are the agent-facing acceptance contract for development and verification.

## Boundary

The platform owns the control plane:

- organizations, projects, and users
- agent definitions
- provider configuration
- model policy
- sandbox policy
- session metadata
- usage and cost records
- audit records
- vault and secret references
- governance rules

The platform owns a thin product SDK for control-plane resources. The platform does not own a custom runtime SDK. Runtime interaction must remain compatible with Cloudflare Agent SDK. Sandbox execution must remain compatible with Cloudflare Sandbox SDK.

## Runtime Shape

```txt
Control plane:
  client -> Any Managed Agents SDK -> /api/* -> Hono routes -> D1 / governance / metadata

Agent runtime:
  client -> Any Managed Agents SDK helper -> Cloudflare Agent SDK -> /agents/* -> Agent Durable Object

Sandbox runtime:
  Agent Durable Object -> Cloudflare Sandbox SDK -> sandbox execution
```

## Spec Discipline

Product behavior should be described in BDD specs before implementation. These specs are primarily for agents and developers, not for end users.

See `specs/product/spec-index.md` for the current product spec map.

See `docs/product/sdk.md` for the SDK ownership boundary.
