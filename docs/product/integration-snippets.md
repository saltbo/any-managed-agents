# Integration Snippets

These examples use the current AMA deployment origin and the published `/api/openapi.json` document. Set `AMA_ORIGIN` to the console origin, for example `https://ama.example.com`. Do not point AMA control-plane examples at model-provider API hosts.

## OpenAPI

```bash
export AMA_ORIGIN="https://ama.example.com"
curl -fsS "$AMA_ORIGIN/api/openapi.json"
```

The document contains `/api` paths for agents, environments, sessions, providers, vaults, governance, usage, audit, MCP, auth, and health. It is the source of truth for request fields, response fields, auth, and machine-readable output.

## curl

Use a OIDC provider-issued OIDC access token. The token is local to the operator session and must not be committed or shared.

```bash
curl -fsS "$AMA_ORIGIN/api/health"

curl -fsS "$AMA_ORIGIN/api/environments" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"name":"Node workspace","hostingMode":"cloud","runtime":"ama","runtimeConfig":{"image":"node:24"},"packages":[{"name":"tsx","version":"latest"}]}'

curl -fsS "$AMA_ORIGIN/api/agents" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"name":"Research assistant","instructions":"Answer with citations.","provider":"workers-ai","model":"@cf/moonshotai/kimi-k2.6"}'

curl -fsS "$AMA_ORIGIN/api/sessions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"agentId":"agent_abc123","environmentId":"env_abc123"}'
```

External products that own higher-level workflow can map their stable product references to AMA resources without exposing their own board, review, or pull-request concepts to AMA. The `externalRef` object is AMA-owned product language:

```json
{
  "product": "agent-kanban",
  "kind": "agent_profile",
  "id": "profile_abc123"
}
```

Use idempotent mapping upserts for agent profiles and execution targets, then create a correlated task-run session:

```bash
curl -fsS -X PUT "$AMA_ORIGIN/api/agents/external" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"externalRef":{"product":"agent-kanban","kind":"agent_profile","id":"profile_abc123"},"name":"AK worker","instructions":"Work from the product-provided task context.","provider":"workers-ai","model":"@cf/moonshotai/kimi-k2.6"}'

curl -fsS -X PUT "$AMA_ORIGIN/api/environments/external" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"externalRef":{"product":"agent-kanban","kind":"execution_target","id":"target_abc123"},"name":"AK target","hostingMode":"cloud","runtime":"ama","runtimeConfig":{"image":"node:24"}}'

curl -fsS "$AMA_ORIGIN/api/sessions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"agentId":"agent_abc123","environmentId":"env_abc123","externalRef":{"product":"agent-kanban","kind":"task_run","id":"run_abc123"},"metadata":{"correlationId":"ak:run_abc123","workItem":"implementation"}}'
```

Repeated agent/environment upserts with the same `externalRef` update the same AMA resource. Repeated session creates with the same task-run `externalRef` return the existing AMA session unless the request points at a different agent or environment.

## restish

Configure restish from the deployment OpenAPI document and keep JSON output enabled for automation.

```bash
restish api configure ama "$AMA_ORIGIN/api/openapi.json"
restish ama get-health
restish ama list-agents --rsh-output-format json
printf '%s\n' '{"name":"Node workspace","hostingMode":"cloud","runtime":"ama","runtimeConfig":{"image":"node:24"},"packages":[{"name":"tsx","version":"latest"}]}' \
  | restish ama create-environment --rsh-output-format json
printf '%s\n' '{"name":"Research assistant","instructions":"Answer with citations.","provider":"workers-ai","model":"@cf/moonshotai/kimi-k2.6"}' \
  | restish ama create-agent --rsh-output-format json
printf '%s\n' '{"agentId":"agent_abc123","environmentId":"env_abc123"}' \
  | restish ama create-session --rsh-output-format json
```

The local e2e check exercises actual restish discovery plus create environment, create agent, and create session serialization:

```bash
pnpm run test:e2e
```

Common control-plane workflows map to these OpenAPI operations:

| Workflow | Operation IDs | Paths |
| --- | --- | --- |
| Health | `getHealth` | `GET /api/health` |
| Agents | `listAgents`, `createAgent`, `upsertExternalAgentMapping`, `readAgent`, `updateAgent`, `archiveAgent`, `listAgentVersions` | `/api/agents` |
| Environments | `listEnvironments`, `createEnvironment`, `upsertExternalEnvironmentMapping`, `readEnvironment`, `updateEnvironment`, `archiveEnvironment`, `listEnvironmentVersions` | `/api/environments` |
| Sessions | `listSessions`, `createSession`, `readSession`, `updateSession`, `stopSession`, `archiveSession`, `listSessionEvents`, `exportSessionEvents`, `streamSessionEvents` | `/api/sessions` |
| Providers | `listProviders`, `createProvider`, `readProvider`, `updateProvider`, `deleteProvider`, `listProviderModels`, `upsertProviderModel` | `/api/providers` |
| Vaults | `listVaults`, `createVault`, `readVault`, `updateVault`, `archiveVault`, credential and version operations | `/api/vaults` |
| Governance | `readGovernancePolicy`, `updateGovernancePolicy`, `readEffectiveGovernancePolicy`, `evaluateGovernancePolicy`, provider access and budget operations | `/api/governance` |
| Usage | `listUsageRecords`, `readUsageSummary` | `/api/usage` |
| Audit | `listAuditRecords`, `exportAuditRecords` | `/api/audit-records` |

Archive operations are destructive from the active resource view. Confirm the target id before calling `archiveAgent`, `archiveEnvironment`, `archiveVault`, `archiveSession`, or delete operations for provider configs and vault credential versions.

## Generated SDK Shape

Generated SDKs are generated from or mechanically aligned with `/api/openapi.json`. They should keep control-plane calls thin:

```ts
const client = createAmaClient({
  origin: window.location.origin,
  credentials: 'include',
})

const environment = await client.environments.create({
  name: 'Node workspace',
  hostingMode: 'cloud',
  runtime: 'ama',
  runtimeConfig: { image: 'node:24' },
  packages: [{ name: 'tsx', version: 'latest' }],
})

const agent = await client.agents.create({
  name: 'Research assistant',
  instructions: 'Answer with citations.',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
})

const mappedAgent = await client.agents.upsertExternalMapping({
  externalRef: { product: 'agent-kanban', kind: 'agent_profile', id: 'profile_abc123' },
  name: 'AK worker',
  instructions: 'Work from the product-provided task context.',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
})

const mappedEnvironment = await client.environments.upsertExternalMapping({
  externalRef: { product: 'agent-kanban', kind: 'execution_target', id: 'target_abc123' },
  name: 'AK target',
  hostingMode: 'cloud',
  runtime: 'ama',
  runtimeConfig: { image: 'node:24' },
})

const session = await client.sessions.create({
  agentId: mappedAgent.id,
  environmentId: mappedEnvironment.id,
  externalRef: { product: 'agent-kanban', kind: 'task_run', id: 'run_abc123' },
  metadata: { correlationId: 'ak:run_abc123', workItem: 'implementation' },
  resourceRefs: [
    {
      type: 'github_repository',
      owner: 'saltbo',
      repo: 'any-managed-agents',
      ref: 'main',
      mountPath: '/workspace/repos/saltbo/any-managed-agents',
    },
  ],
})
```

Runtime task interaction is separate from restish control-plane automation. Use the `runtimeEndpointPath` returned by session reads with AMA runtime helpers. Do not define a new CLI-level runtime protocol.

`cloud` sessions also expose a deterministic `/workspace/.ama/resources.json` manifest inside the sandbox. It declares safe GitHub repository refs and target mount paths for the selected runtime to set up; it does not imply that AMA has already cloned the repositories.

Regenerate repo-local SDK scaffolds from the Hono-generated OpenAPI document before publishing SDK changes:

```bash
pnpm run openapi:generate
pnpm run openapi:check
```
