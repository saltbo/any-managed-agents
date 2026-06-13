import { drizzle } from 'drizzle-orm/d1'
import { createAuditPort } from './adapters/gateways/audit'
import { createMcpGateway } from './adapters/gateways/mcp'
import { createPolicyPort } from './adapters/gateways/policy'
import { createProviderCatalogGateway } from './adapters/gateways/provider-catalog'
import { createSecretStoreGateway } from './adapters/gateways/secret-store'
import { createSessionEventPort } from './adapters/gateways/session-events'
import { createAgentRepo } from './adapters/repos/agents'
import { createConnectionRepo } from './adapters/repos/connections'
import { createConnectorRepo } from './adapters/repos/connectors'
import { createEnvironmentRepo } from './adapters/repos/environments'
import { createProviderRepo } from './adapters/repos/providers'
import { createVaultRepo } from './adapters/repos/vaults'
import type { Env } from './env'
import type { Deps } from './usecases/deps'

// The single composition root. Wires adapters into the Deps object. Cheap,
// plain-object, and request-free so scheduled/queue entrypoints can reuse it.
export function createDeps(env: Env): Deps {
  const db = drizzle(env.DB)
  return {
    agents: createAgentRepo(db),
    environments: createEnvironmentRepo(db),
    providers: createProviderRepo(db),
    providerCatalog: createProviderCatalogGateway(),
    vaults: createVaultRepo(db),
    secretStore: createSecretStoreGateway(env),
    connectors: createConnectorRepo(db),
    connections: createConnectionRepo(db),
    mcp: createMcpGateway(env, db),
    sessionEvents: createSessionEventPort(db),
    audit: createAuditPort(db),
    policy: createPolicyPort(db),
  }
}
