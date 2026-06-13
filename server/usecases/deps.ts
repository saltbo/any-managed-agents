import type {
  AccessRuleRepo,
  AgentRepo,
  AuditPort,
  AuditReadRepo,
  BudgetRepo,
  ConnectionRepo,
  ConnectorRepo,
  EnvironmentRepo,
  FederatedTenantRepo,
  LeaseRepo,
  McpGateway,
  PolicyPort,
  PolicyRepo,
  ProjectRepo,
  ProviderCatalogGateway,
  ProviderRepo,
  RunnerRepo,
  RuntimeSecretEnvGateway,
  SecretStoreGateway,
  SessionEventPort,
  TriggerRepo,
  UsageRepo,
  VaultRepo,
  WorkItemRepo,
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
  policies: PolicyRepo
  accessRules: AccessRuleRepo
  budgets: BudgetRepo
  mcp: McpGateway
  sessionEvents: SessionEventPort
  audit: AuditPort
  policy: PolicyPort
  usageRecords: UsageRepo
  auditRecords: AuditReadRepo
  triggers: TriggerRepo
  projects: ProjectRepo
  federatedTenants: FederatedTenantRepo
  runners: RunnerRepo
  workItems: WorkItemRepo
  leases: LeaseRepo
  runtimeSecretEnv: RuntimeSecretEnvGateway
}
