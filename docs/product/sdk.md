# SDK and API Boundary

This repository does not maintain language SDKs. It publishes the Any Managed Agents control-plane OpenAPI contract. Product SDKs are generated and maintained in separate repositories.

## SDK Layers

```txt
User application
  -> external Any Managed Agents SDK or direct HTTP
  -> Any Managed Agents OpenAPI control-plane API
  -> Cloudflare Agents SDK / Cloudflare Sandbox SDK
```

## External Any Managed Agents SDKs

External SDK repositories use this repository's OpenAPI document as their source of truth. Those SDKs are the developer entry point for product resources:

- create, read, update, archive, and version agents
- create and manage environments
- create, start, stop, resume, and inspect sessions
- manage provider, vault, policy, usage, and audit resources
- connect to a running session through a Cloudflare Agents SDK-compatible runtime endpoint

SDKs should stay thin. They wrap the public control-plane API and provide a small set of ergonomic helpers, such as `sessions.connect(sessionId)`. SDK source, release process, and language-specific packaging do not live in this repository.

## Cloudflare Agents SDK

Cloudflare Agents SDK remains the runtime protocol and runtime client foundation.

The platform must not create a competing runtime protocol for WebSocket, RPC, state sync, streaming, or Agent Durable Object routing. Runtime session traffic should remain compatible with Cloudflare Agents SDK concepts such as agent class names, instance names, `AgentClient`, `useAgent`, and `agentFetch`.

## Cloudflare Sandbox SDK

Cloudflare Sandbox SDK remains the sandbox execution foundation.

The platform uses sandbox capabilities internally to execute commands, manage files, and run processes. The SDK should not expose the raw sandbox as the primary public product surface. Users manage `Environment` resources; the platform maps those environment descriptions to per-session sandbox runtime behavior.

## Product Model

- `Agent` is a managed definition: instructions, tools, model policy, sandbox requirements, governance rules, and versions.
- `Environment` is a long-lived sandbox environment description.
- `Sandbox` is a per-session runtime instance created from an environment snapshot.
- `Session` is a concrete run of an agent in an environment, with runtime state, one sandbox instance, events, transcript, tool calls, and status.

External SDKs should make this model explicit.
