import { createAuditPort } from './adapters/gateways/audit'
import { createCloudTurnQueue } from './adapters/gateways/cloud-turn-queue'
import { createMcpGateway } from './adapters/gateways/mcp'
import { createPolicyPort } from './adapters/gateways/policy'
import { createProviderCatalogGateway } from './adapters/gateways/provider-catalog'
import { createRunnerChannel } from './adapters/gateways/runner-channel'
import { createRuntimeSecretEnvGateway } from './adapters/gateways/runtime-secret-env'
import { createSecretStoreGateway } from './adapters/gateways/secret-store'
import { createSessionEventPort } from './adapters/gateways/session-events'
import { createSessionRuntimeGateway } from './adapters/gateways/session-runtime'
import { createAccessRuleRepo } from './adapters/repos/access-rules'
import { createAgentRepo } from './adapters/repos/agents'
import { createAuditReadRepo } from './adapters/repos/audit-records'
import { createBudgetRepo } from './adapters/repos/budgets'
import { createConnectionRepo } from './adapters/repos/connections'
import { createConnectorRepo } from './adapters/repos/connectors'
import { createEnvironmentRepo } from './adapters/repos/environments'
import { createFederatedTenantRepo } from './adapters/repos/federated-tenants'
import { createLeaseRepo } from './adapters/repos/leases'
import { createPolicyRepo } from './adapters/repos/policies'
import { createProjectRepo } from './adapters/repos/projects'
import { createProviderRepo } from './adapters/repos/providers'
import { createRunnerRepo } from './adapters/repos/runners'
import { createRuntimeOrchestrationRepo } from './adapters/repos/runtime-orchestration'
import { createSessionRepo } from './adapters/repos/sessions'
import { createTriggerDispatchRepo } from './adapters/repos/trigger-dispatch'
import { createTriggerRepo } from './adapters/repos/triggers'
import { createUsageRepo } from './adapters/repos/usage-records'
import { createVaultRepo } from './adapters/repos/vaults'
import { createWorkItemRepo } from './adapters/repos/work-items'
import { createSandboxRuntimeHost } from './adapters/runtime/sandbox-runtime-host'
import { createDb } from './db/client'
import type { Env } from './env'
import type { Deps } from './usecases/deps'

// The single composition root. Wires adapters into the Deps object. Cheap,
// plain-object, and request-free so scheduled/queue entrypoints can reuse it.
export function createDeps(env: Env): Deps {
  const db = createDb(env)
  const sessions = createSessionRepo(db)
  return {
    agents: createAgentRepo(db),
    environments: createEnvironmentRepo(db),
    providers: createProviderRepo(db),
    providerCatalog: createProviderCatalogGateway(),
    vaults: createVaultRepo(db),
    secretStore: createSecretStoreGateway(env),
    connectors: createConnectorRepo(db),
    connections: createConnectionRepo(db),
    policies: createPolicyRepo(db),
    accessRules: createAccessRuleRepo(db),
    budgets: createBudgetRepo(db),
    mcp: createMcpGateway(env, db),
    sessionEvents: createSessionEventPort(db),
    audit: createAuditPort(db),
    policy: createPolicyPort(db),
    usageRecords: createUsageRepo(db),
    auditRecords: createAuditReadRepo(db),
    triggers: createTriggerRepo(db),
    triggerDispatch: createTriggerDispatchRepo(db),
    projects: createProjectRepo(db),
    federatedTenants: createFederatedTenantRepo(db),
    runners: createRunnerRepo(db),
    workItems: createWorkItemRepo(db),
    leases: createLeaseRepo(db),
    runtimeSecretEnv: createRuntimeSecretEnvGateway(env, db),
    cloudTurnQueue: createCloudTurnQueue(env),
    runnerChannel: createRunnerChannel(env),
    sandboxRuntime: createSandboxRuntimeHost(env),
    sessionOrchestration: createRuntimeOrchestrationRepo(db),
    sessions,
    sessionRuntime: createSessionRuntimeGateway(env, db, sessions),
  }
}
