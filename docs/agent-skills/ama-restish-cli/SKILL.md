---
name: ama-restish-cli
description: Operate Any Managed Agents control-plane resources from a terminal using restish and the published OpenAPI document.
---

# AMA restish CLI

Use this skill when an agent needs terminal automation for Any Managed Agents resources. This skill is documentation only: it does not define a bespoke AMA CLI binary or a replacement runtime protocol.

## Setup

1. Set the deployment origin:

   ```bash
   export AMA_ORIGIN="https://ama.example.com"
   ```

2. Authenticate through FlareAuth and provide a FlareAuth-issued OIDC access token. The current implemented OpenAPI security scheme is `bearerAuth` in `/api/openapi.json`.

3. Configure restish from the published OpenAPI document:

   ```bash
   restish api configure ama "$AMA_ORIGIN/api/openapi.json"
   restish ama get-health
   ```

4. Use JSON output when another tool will parse command output:

   ```bash
   restish ama list-agents --rsh-output-format json
   ```

## Workflow Map

Use OpenAPI operation names or documented `/api` paths. Do not invent local command names.

| Resource | Read/list | Create/update | Archive/delete or command |
| --- | --- | --- | --- |
| Health | `getHealth` | n/a | n/a |
| Agents | `listAgents`, `readAgent`, `listAgentVersions` | `createAgent`, `updateAgent` | `archiveAgent` |
| Environments | `listEnvironments`, `readEnvironment`, `listEnvironmentVersions` | `createEnvironment`, `updateEnvironment` | `archiveEnvironment` |
| Sessions | `listSessions`, `readSession`, `readSessionReconnect`, `listSessionEvents`, `exportSessionEvents`, `streamSessionEvents` | `createSession`, `updateSession` | `stopSession`, `archiveSession` |
| Providers | `listProviders`, `readProvider`, `listProviderModels` | `createProvider`, `updateProvider`, `upsertProviderModel` | `deleteProvider` |
| Vaults | `listVaults`, `readVault`, `listVaultCredentials`, `readVaultCredential`, `listVaultCredentialVersions` | `createVault`, `updateVault`, `createVaultCredential`, `updateVaultCredential`, `rotateVaultCredential` | `archiveVault`, `deleteVaultCredentialVersion` |
| Governance | `readGovernancePolicy`, `readEffectiveGovernancePolicy`, `listProviderAccessRules`, `listBudgets` | `updateGovernancePolicy`, `createProviderAccessRule`, `createBudget` | `evaluateGovernancePolicy` |
| Usage | `listUsageRecords`, `readUsageSummary` | n/a | n/a |
| Audit | `listAuditRecords`, `exportAuditRecords` | n/a | n/a |

## Common Commands

```bash
restish ama list-environments --rsh-output-format json
printf '%s\n' '{"name":"Node workspace","packages":[{"name":"tsx","version":"latest"}]}' \
  | restish ama create-environment --rsh-output-format json

restish ama list-agents --rsh-output-format json
printf '%s\n' '{"name":"Research assistant","instructions":"Answer with citations."}' \
  | restish ama create-agent --rsh-output-format json

printf '%s\n' '{"agentId":"agent_abc123","environmentId":"env_abc123"}' \
  | restish ama create-session --rsh-output-format json
restish ama read-session sessionId:"session_abc123"
restish ama list-session-events sessionId:"session_abc123" --rsh-output-format json

restish ama list-providers --rsh-output-format json
restish ama list-vaults --rsh-output-format json
restish ama read-effective-governance-policy --rsh-output-format json
restish ama read-usage-summary --rsh-output-format json
restish ama list-audit-records --rsh-output-format json
```

Run `npm run test:e2e` in this repository when you need local evidence that the current OpenAPI document is ingestible by restish and that restish can serialize the core create environment, create agent, and create session workflow.

## Safety Boundaries

- Confirm ids before `archiveAgent`, `archiveEnvironment`, `archiveVault`, `archiveSession`, `deleteProvider`, or `deleteVaultCredentialVersion`.
- Treat vault values and auth tokens as secrets. Never paste raw secret values into notes, commits, or screenshots.
- Runtime interaction remains Pi-compatible. Discover a session's `runtimeEndpointPath` with `readSession`, then use AMA runtime endpoints or Pi-compatible helpers for task traffic.
- Do not add a `bin`, shell wrapper, npm global command, or project-specific command surface for AMA control-plane work.
