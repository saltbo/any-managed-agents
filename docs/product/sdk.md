# SDK Boundary

Any Managed Agents provides a thin product SDK for developers, but it does not replace Cloudflare's runtime SDKs.

## SDK Layers

```txt
User application
  -> Any Managed Agents SDK
  -> Any Managed Agents control-plane API
  -> Cloudflare Agents SDK / Cloudflare Sandbox SDK
```

## Any Managed Agents SDK

The Any Managed Agents SDK is the developer entry point for product resources:

- create, read, update, archive, and version agents
- create and manage environments
- create, start, stop, resume, and inspect sessions
- manage provider, vault, policy, usage, and audit resources
- connect to a running session through a Cloudflare Agents SDK-compatible runtime endpoint

The SDK should stay thin. It wraps the public control-plane API and provides a small set of ergonomic helpers, such as `sessions.connect(sessionId)`.

## Cloudflare Agents SDK

Cloudflare Agents SDK remains the runtime protocol and runtime client foundation.

The platform must not create a competing runtime protocol for WebSocket, RPC, state sync, streaming, or Agent Durable Object routing. Runtime session traffic should remain compatible with Cloudflare Agents SDK concepts such as agent class names, instance names, `AgentClient`, `useAgent`, and `agentFetch`.

## Cloudflare Sandbox SDK

Cloudflare Sandbox SDK remains the sandbox execution foundation.

The platform uses sandbox capabilities internally to execute commands, manage files, run processes, and expose services for an environment. The Any Managed Agents SDK should not expose the raw sandbox as the primary public product surface. Users manage `Environment` resources; the platform maps those resources to sandbox runtime behavior.

## Product Model

- `Agent` is a managed definition: instructions, tools, model policy, sandbox requirements, governance rules, and versions.
- `Environment` is the sandbox-backed runtime environment where an agent can execute work.
- `Session` is a concrete run of an agent in an environment, with runtime state, events, transcript, tool calls, and status.

The SDK should make this model explicit.

