# SDK and API Boundary

This repository does not maintain language SDKs or a bespoke CLI binary. It publishes the Any Managed Agents control-plane OpenAPI contract. Product SDKs are generated and maintained in separate repositories. SDKs are generated from or mechanically aligned with the OpenAPI document, and command-line automation uses restish against the same OpenAPI document.

## SDK Layers

```txt
User application
  -> external Any Managed Agents SDK, restish, or direct HTTP
  -> Any Managed Agents OpenAPI control-plane API
  -> AMA runtime proxy
  -> Pi coding agent in Cloudflare Sandbox
```

## External Any Managed Agents SDKs

External SDK repositories use this repository's OpenAPI document as their source of truth. Those SDKs are the developer entry point for product resources:

- create, read, update, archive, and version agents
- create and manage environments
- create, start, stop, resume, and inspect sessions
- manage provider, vault, policy, usage, and audit resources
- connect to a running session through Pi protocol or a transparent AMA Pi proxy endpoint

SDKs should stay thin. They wrap the public control-plane API and provide a small set of ergonomic helpers, such as `sessions.connect(sessionId)`. SDK source, release process, and language-specific packaging do not live in this repository.

## CLI Boundary

The CLI path is restish over OpenAPI. The OpenAPI document is the source of truth for operation discovery, request fields, response fields, authentication, and machine-readable output.

Restish is configured from the deployment document:

```bash
export AMA_ORIGIN="https://ama.example.com"
restish api configure ama "$AMA_ORIGIN/api/openapi.json"
restish ama get-health
```

Use the current AMA deployment origin and `/api` paths for control-plane operations. The implemented security scheme is the FlareAuth-issued AMA session cookie declared as `cookieAuth`; do not document provider API keys as AMA control-plane credentials.

This repository includes:

- [Integration snippets](integration-snippets.md) for curl, restish, and generated SDK-shaped examples.
- [AMA restish CLI skill](../agent-skills/ama-restish-cli/SKILL.md) for automation agents.

The skill is guidance for automation agents, not a separate command surface. It references OpenAPI operations or documented paths rather than inventing project-specific CLI commands.

## Runtime Protocol

Pi protocol is the v1.0 runtime protocol. Pi coding agent is the v1.0 runtime implementation inside Cloudflare Sandbox.

Restish is control-plane only. It manages API resources through OpenAPI-described `/api` operations; it does not replace Pi runtime traffic.

The platform must not create a competing runtime protocol for RPC, session events, prompts, abort, follow-up, steering, or tool calls. Runtime session traffic should use Pi protocol directly or a transparent AMA proxy around Pi RPC and JSON event streams.

Cloudflare Agents SDK is not the v1.0 runtime contract. It may become a future adapter, but v1.0 must not require `/agents/*` compatibility.

## Cloudflare Sandbox

Cloudflare Sandbox remains the sandbox execution foundation.

The platform uses sandbox capabilities internally to provide filesystem, shell, process isolation, and per-session execution for Pi. SDKs should not expose the raw sandbox as the primary public product surface. Users manage `Environment` resources; the platform maps those environment descriptions to per-session sandbox runtime behavior.

## Product Model

- `Agent` is a managed definition: instructions, tools, model policy, sandbox requirements, governance rules, and versions.
- `Environment` is a long-lived sandbox and runtime configuration, not a running sandbox.
- `Sandbox` is a per-session runtime instance created from an environment snapshot.
- `Session` is a concrete run of an agent, binding an agent version snapshot, environment snapshot, sandbox id, Pi session or runtime id, events, transcript, tool calls, and status.

External SDKs should make this model explicit.
