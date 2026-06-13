# E2E /api/v1 Migration Cheatsheet

The control-plane API was rewritten to strict-RESTful `/api/v1` (see
`docs/api-v1-design.md`, and `sdk/openapi.json` for exact paths/methods/schemas).
The cucumber e2e suite (`test/e2e/**/*.steps.ts`, `specs/**/*.feature`) still
targets the old contract. Migrate every step/feature file to the new contract
using the rules below.

**Already migrated — DO NOT touch, just use:** `test/e2e/local-app.ts`,
`test/e2e/shared-helpers.ts`, `test/e2e/restish-openapi.ts`. Their helpers
(`createAgent/createEnvironment/createSession/createProvider/createProviderModel/
createAndActivateRunner/claimRunnerLease/stopSession/uploadRunnerEvent/
completeRunnerLease/sessionEvents/waitForSession/...`) already speak v1. Prefer
calling them over inlining raw requests.

**DO NOT run `pnpm test:e2e`** — parallel runs collide on the shared local D1
state. Do careful static migration; the orchestrator runs the full suite.

## Path & verb rules

- All paths `/api/*` → `/api/v1/*` (including `/api/e2e/*` → `/api/v1/e2e/*`,
  `/api/openapi.json` → `/api/v1/openapi.json`, `/api/health` → `/api/v1/health`).
  Leave external IdP URLs like `https://oidc.example.test/api/auth` alone.
- **Archive ≠ DELETE.** `DELETE /api/<res>/{id}` for agents/environments/sessions/
  vaults/triggers/connections → `PATCH /api/v1/<res>/{id}` `{archived:true}`.
  Real DELETE remains only for: providers, provider models, credential versions,
  access-rules, budgets, policies, federated-tenants.
- Session stop: `POST /sessions/{id}/stop` → `PATCH /api/v1/sessions/{id}`
  `{state:'stopped'}`. `GET /sessions/{id}/reconnect` → `GET /sessions/{id}/connection`.
- Session command: `POST /sessions/{id}/commands` `{type,message}` →
  `POST /api/v1/sessions/{id}/messages` `{type:'prompt', content}` → **201**.
- Approval decision: `POST /sessions/{id}/approvals/{aid}` →
  `PATCH /api/v1/sessions/{id}/approvals/{aid}` `{decision, reason?, result?}`.
- Events export/stream paths removed → `GET /sessions/{id}/events` with
  `Accept: text/csv` / `text/event-stream`. Usage/audit export likewise via Accept.
- Provider model upsert: `POST /providers/{id}/models` →
  `PUT /api/v1/providers/{id}/models/{modelId}`. Discovery:
  `POST /providers/{id}/models/discovery` → `POST /api/v1/providers/{id}/model-discovery-tasks` (201).
- Runner heartbeat: `POST /runners/{id}/heartbeats` `{status}` →
  `PUT /api/v1/runners/{id}/heartbeat` `{state}`.
- Lease claim (two-step): `POST /runners/{id}/leases` (auto-pick / 204 = no work)
  → `GET /api/v1/work-items?state=available[&sessionId=]` then
  `POST /api/v1/leases` `{workItemId, runnerId, leaseDurationSeconds?}` (201; 409 race).
- Lease update: `PATCH /runners/{id}/leases/{lid}` `{status}` →
  `PATCH /api/v1/leases/{lid}` `{state, result?, error?, resumeToken?}` or
  `{leaseDurationSeconds}` to renew. Lease channel: `GET /api/v1/leases/{lid}/channel`.
- Lease events: `POST /runners/{id}/leases/{lid}/events` →
  `POST /api/v1/sessions/{sessionId}/events` `{events:[...]}` (201 `{accepted}`).
- Namespaces flattened: `/governance/policy` → `/policies` (collection, scope obj);
  `/governance/effective-policy` → `/effective-policy`; `/governance/budgets` →
  `/budgets`; `/governance/provider-access-rules` → `/access-rules`;
  `POST /governance/evaluations` → `GET /effective-policy?providerId=&modelId=`.
  **Declarative config endpoints DELETED**: `/governance/config`,
  `/config/preview`, `/config/validate` — remove those scenarios/steps entirely.
- MCP namespace: `/mcp/connectors` → `/connectors`, `/mcp/connections` →
  `/connections`; tool call `POST /connections/{id}/tools/{tool}/calls` (201);
  disconnect `DELETE` → `PATCH {state:'disconnected'}`. Connection create POST → 201
  only (409 if exists). Connector catalog dropped `policyStatus`/`connectionStatus`/
  `connectorId`(→`id`)/`status`(→`availability`).
- Renames: `scheduled-agent-triggers` → `triggers`; `/usage` → `/usage-records`,
  `/usage/summary` → `/usage-summary`; `external-bindings` (under projects) →
  `/auth/federated-tenants`; `/auth/login-options` → `/auth/config`;
  `POST /auth/session` → `POST /auth/sessions` (201); logout `DELETE /auth/sessions/current`.

## Field / shape rules

- Session: `status` → `state` (pending|running|idle|stopped|error), `statusReason`
  → `stateReason`, lifecycle via `archivedAt`. Removed: `runtimeEndpointPath`
  (use `GET /sessions/{id}/connection` `.path`), `durableObjectName`, `sandboxId`,
  `organizationId`, `vaultRefs`, `runtimeEnv`(→`env`), `runtimeSecretEnv`(→`secretEnv`).
- `secretEnv` entries: `{name, ref}` → `{name, credentialRef:{credentialId, versionId?}}`.
- Agent: `provider` → `providerId`; `tools` is object array `[{name, ...}]` (no
  `allowedTools` string array); no `systemPrompt`; lifecycle `archivedAt`.
- Environment: `secretRefs` → `credentialRefs:[{credentialId, versionId?}]`.
- Provider: `status` → `enabled`(bool); `hasCredential`/`credentialSecretRef` →
  `credentialRef`; `modelCatalogStatus` → `modelCatalogState`.
- Vault credential/version: `status` → `state`. Budget: `status` → `enabled`.
- Trigger: `status`(active/paused/archived) → `enabled`(bool) + `archivedAt`;
  `runtimeEnv`→`env`, `runtimeSecretEnv`→`secretEnv`. Run `status`→`state`.
- List query: `includeArchived` → `archived`; the `status` query param is gone
  (filter by `state`/`enabled`/`archived` where the resource supports it).
- Pagination envelope: `{limit, hasMore, nextCursor}` — `firstId`/`lastId`/
  `firstSequence`/`lastSequence` removed. If a step used firstId/lastId, use the
  first/last element of `data`.
- All responses dropped `organizationId`.

## Verification

After editing, your files must follow the contract exactly. Cross-check any
exact path/method/schema assertions (especially OpenAPI-contract feature files)
against `sdk/openapi.json`. Do not run the e2e suite.

## Frequently-missed patterns (verify these explicitly)

- `POST /sessions/{id}/commands` `{type:'prompt', message}` →
  `POST /api/v1/sessions/{id}/messages` `{type:'prompt', content}` (field
  `message`→`content`), expect 201. Any sendPrompt/sendCommand helper hitting
  `/commands` must change.
- `GET /usage?...` (bare list) → `GET /api/v1/usage-records?...`.
  `/usage/summary` → `/usage-summary`.
- Agent create/update body: `provider:'workers-ai'` → for the platform default
  OMIT providerId (null resolves to the project default); for a configured
  provider pass `providerId:<provider.id>`. Never send a `provider` type string.
  Remove `systemPrompt`/`allowedTools`; tools are `[{name,...}]`.
- Reads of `.status` on session/runner/workItem/lease/connection/credential
  objects → `.state` (leave Playwright `response.status()` and HTTP status-code
  assertions alone). Session `.statusReason` → `.stateReason`.
- Runtime RPC proxy path `/runtime/sessions/{id}/rpc` (and `/ws`) →
  `/api/v1/runtime/sessions/{id}/rpc`.
- `GET /runners/work-items` → top-level `GET /api/v1/work-items`.
- Declarative `applyConfig`-style helpers are gone; set policy via
  `POST /api/v1/policies {scope:{level},...}` (upsert: GET then PUT
  `/policies/{id}` if it exists) and `POST /api/v1/access-rules`.
