# SDK and API Boundary

This repository maintains generated SDK scaffolds under `sdk/`, but it does not maintain a bespoke CLI binary or hand-authored SDK behavior that drifts from OpenAPI. It publishes the Any Managed Agents control-plane OpenAPI contract. SDKs are generated from or mechanically aligned with the Hono-generated OpenAPI document, and command-line automation uses restish against the same OpenAPI document. The web console is an internal entrypoint and uses the project-local Hono RPC client.

## SDK Layers

```txt
User application
  -> external Any Managed Agents SDK, restish, or direct HTTP
  -> Any Managed Agents OpenAPI control-plane API
  -> AMA runtime endpoint
  -> AMA cloud-owned session loop
  -> sandbox or runner tool executor

Web console
  -> Hono RPC client
  -> Any Managed Agents control-plane routes
  -> AMA runtime endpoint
  -> AMA cloud-owned session loop
```

## External Any Managed Agents SDKs

Repo-local generated SDK scaffolds use this repository's OpenAPI document as their source of truth. Those SDKs are the developer entry point for product resources:

- create, read, update, archive, and version agents
- create and manage environments
- create, start, stop, resume, and inspect sessions
- manage provider, vault, policy, usage, and audit resources
- connect to a running session through AMA runtime endpoints

SDKs should stay thin. They wrap the public control-plane API and may provide a small set of ergonomic helpers, such as `sessions.connect(sessionId)`, only when those helpers delegate to AMA runtime endpoints. Release ownership may move to separate repositories later, but this repository currently owns the reproducible generated layout.

## Repo-Local Generated Layout

The generated SDK layout is:

- `sdk/openapi.json` - committed OpenAPI snapshot generated from `createApp()` and Hono route schemas.
- `sdk/typescript` - npm workspace package `@any-managed-agents/sdk`.
- `sdk/go` - native Go module, not an npm workspace.
- `sdk/python` - native Python package, not an npm workspace.

Regenerate and check the SDK artifacts with:

```bash
npm run openapi:generate
npm run openapi:check
npm run --workspace sdk/typescript typecheck
```

The generator is intentionally repo-local and route-driven. Do not edit generated operation metadata or OpenAPI snapshots by hand.

## CLI Boundary

The CLI path is restish over OpenAPI. The OpenAPI document is the source of truth for operation discovery, request fields, response fields, authentication, and machine-readable output.

Restish is configured from the deployment document:

```bash
export AMA_ORIGIN="https://ama.example.com"
restish api configure ama "$AMA_ORIGIN/api/openapi.json"
restish ama get-health
```

Use the current AMA deployment origin and `/api` paths for control-plane operations. The implemented security scheme is a OIDC provider-issued OIDC access token declared as `bearerAuth`; do not document provider API keys as AMA control-plane credentials.

This repository includes:

- [Integration snippets](integration-snippets.md) for curl, restish, and generated SDK-shaped examples.
- [AMA restish CLI skill](../agent-skills/ama-restish-cli/SKILL.md) for automation agents.
- `scripts/generate-openapi-and-sdks.ts` for reproducible SDK regeneration.

The skill is guidance for automation agents, not a separate command surface. It references OpenAPI operations or documented paths rather than inventing project-specific CLI commands.

## Web Console Boundary

The web console should not use OpenAPI as its internal client implementation. It calls the same Hono routes through the shared Hono RPC client. OpenAPI remains the external contract for direct HTTP users, generated SDKs, and restish.

## Runtime Protocol

AMA session endpoints are the v1.0 runtime protocol surface. AMA cloud-side code owns the session loop and may use Pi Core primitives internally.

Restish is control-plane only. It manages API resources through OpenAPI-described `/api` operations; it does not replace AMA runtime traffic.

The platform must not create a second client-facing runtime protocol for RPC, session events, prompts, abort, follow-up, steering, or tool calls. Runtime session traffic goes through AMA session endpoints.

Cloudflare Agents SDK is not the v1.0 runtime contract. It may become a future adapter, but v1.0 must not require `/agents/*` compatibility.

## Cloudflare Sandbox

Cloudflare Sandbox remains the sandbox execution foundation.

The platform uses sandbox capabilities internally to provide filesystem, shell, process isolation, and per-session tool execution. SDKs should not expose the raw sandbox as the primary public product surface. Users manage `Environment` resources; the platform maps those environment descriptions to executor backend behavior.

## Product Model

- `Agent` is a managed definition: instructions, tools, model policy, sandbox requirements, governance rules, and versions.
- `Environment` is a long-lived sandbox and runtime configuration, not a running sandbox.
- `Sandbox` is a per-session runtime instance created from an environment snapshot.
- `Session` is a concrete run of an agent, binding an agent version snapshot, environment snapshot, sandbox id, cloud runtime state, events, transcript, tool calls, and status.

External SDKs should make this model explicit.
