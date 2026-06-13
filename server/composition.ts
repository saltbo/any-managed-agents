import { drizzle } from 'drizzle-orm/d1'
import { createAuditPort } from './adapters/gateways/audit'
import { createPolicyPort } from './adapters/gateways/policy'
import { createProviderCatalogGateway } from './adapters/gateways/provider-catalog'
import { createAgentRepo } from './adapters/repos/agents'
import { createEnvironmentRepo } from './adapters/repos/environments'
import { createProviderRepo } from './adapters/repos/providers'
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
    audit: createAuditPort(db),
    policy: createPolicyPort(db),
  }
}
