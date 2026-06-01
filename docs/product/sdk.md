# SDK and API Boundary

This repository maintains generated SDK scaffolds under `sdk/`, but it does not maintain a bespoke CLI binary or hand-authored SDK behavior that drifts from OpenAPI. It publishes the Any Managed Agents control-plane OpenAPI contract. SDKs are generated from or mechanically aligned with the Hono-generated OpenAPI document, and command-line automation uses restish against the same OpenAPI document. The web console is an internal entrypoint and uses the project-local Hono RPC client.

## SDK Layers

```txt
User application
  -> external Any Managed Agents SDK, restish, or direct HTTP
  -> Any Managed Agents OpenAPI control-plane API
  -> AMA session endpoint
  -> selected environment runtime
  -> canonical AMA session events

Web console
  -> Hono RPC client
  -> Any Managed Agents control-plane routes
  -> AMA session endpoint
  -> selected environment runtime
  -> canonical AMA session events
```

## External Any Managed Agents SDKs

Repo-local generated SDK scaffolds use this repository's OpenAPI document as their source of truth. Those SDKs are the developer entry point for product resources:

- create, read, update, archive, and version agents
- create and manage environments
- create, start, stop, resume, and inspect sessions
- manage provider, vault, policy, usage, and audit resources
- connect to a running session through AMA session endpoints

SDKs should stay thin. They wrap the public control-plane API and may provide a small set of ergonomic helpers, such as `sessions.connect(sessionId)`, only when those helpers delegate to AMA session endpoints. Release ownership may move to separate repositories later, but this repository currently owns the reproducible generated layout.

## Repo-Local Generated Layout

The generated SDK layout is:

- `sdk/openapi.json` - committed OpenAPI snapshot generated from `createApp()` and Hono route schemas.
- `sdk/typescript` - pnpm workspace package `@any-managed-agents/sdk`.
- `sdk/go` - native Go module, not a pnpm workspace.
- `sdk/python` - native Python package, not a pnpm workspace.

Regenerate and check the SDK artifacts with:

```bash
pnpm run openapi:generate
pnpm run openapi:check
pnpm --filter -managed-agents/sdk run typecheck
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

AMA session endpoints and canonical AMA session events are the v1.0 UI/API/session-state protocol surface. Agent products run through the runtime selected by the session's environment.

Restish is control-plane only. It manages API resources through OpenAPI-described `/api` operations; it does not replace AMA runtime traffic.

The platform must not create a second client-facing runtime protocol for RPC, session events, prompts, abort, follow-up, steering, or tool calls. Runtime session traffic goes through AMA session endpoints, and observed state comes from canonical AMA session events.

Cloudflare Agents SDK is not the v1.0 runtime contract. It may become a future adapter, but v1.0 must not require `/agents/*` compatibility.

## Cloudflare Sandbox

Cloudflare Sandbox remains the sandbox execution foundation.

The platform uses sandbox capabilities internally to provide filesystem, shell, process isolation, and `cloud` workspace execution. SDKs should not expose the raw sandbox as the primary public product surface. Users manage `Environment` resources; the platform maps those environment descriptions to selected runtime behavior.

## Product Model

- `Agent` is a managed definition: persona, instructions, policy, provider, model, tools, MCP connectors, governance rules, and versions.
- `Environment` is a long-lived hosting and runtime configuration, not a running sandbox or runner. `hostingMode` is `cloud` or `self_hosted`; `runtime` is `ama`, `claude-code`, `codex`, or `copilot`.
- `Sandbox` is a per-session cloud workspace instance created from an environment snapshot when the selected hosting/runtime combination requires it.
- `Session` is a concrete run of an agent, binding an agent version snapshot, environment snapshot, validated runtime/provider/model combination, runtime endpoint, canonical events, transcript, tool calls, and status.

External SDKs should make this model explicit.
