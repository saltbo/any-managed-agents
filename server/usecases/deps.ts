import type { AgentRepo, AuditPort, EnvironmentRepo, PolicyPort, ProviderCatalogGateway, ProviderRepo } from './ports'

// Aggregates every port a usecase may reach for. Constructed once per request
// by composition.createDeps and handed to routes via Hono context.
export interface Deps {
  agents: AgentRepo
  environments: EnvironmentRepo
  providers: ProviderRepo
  providerCatalog: ProviderCatalogGateway
  audit: AuditPort
  policy: PolicyPort
}
