import type {
  AgentRepo,
  AuditPort,
  ConnectionRepo,
  ConnectorRepo,
  EnvironmentRepo,
  McpGateway,
  PolicyPort,
  ProviderCatalogGateway,
  ProviderRepo,
  SecretStoreGateway,
  SessionEventPort,
  VaultRepo,
} from './ports'

// Aggregates every port a usecase may reach for. Constructed once per request
// by composition.createDeps and handed to routes via Hono context.
export interface Deps {
  agents: AgentRepo
  environments: EnvironmentRepo
  providers: ProviderRepo
  providerCatalog: ProviderCatalogGateway
  vaults: VaultRepo
  secretStore: SecretStoreGateway
  connectors: ConnectorRepo
  connections: ConnectionRepo
  mcp: McpGateway
  sessionEvents: SessionEventPort
  audit: AuditPort
  policy: PolicyPort
}
