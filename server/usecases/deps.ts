import type {
  AgentRepo,
  AuditPort,
  AuditReadRepo,
  AuthScope,
  BudgetRepo,
  CloudTurnQueue,
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
  RunnerChannel,
  RunnerRepo,
  RuntimeSecretEnvGateway,
  SandboxRuntimeHost,
  SecretStoreGateway,
  SessionEventPort,
  SessionOrchestrationStore,
  SessionRepo,
  TriggerDispatchRepo,
  TriggerRepo,
  UsageRepo,
  VaultRepo,
  WorkItemRepo,
} from './ports'
import type { ToolApprovalGate } from './runtime/approval-gate'

// The approval-gate factory the cloud turn loop threads into its turn callbacks.
// Built once per Deps so the runtime usecases reach it without re-acquiring the
// store/audit/policy ports it closes over.
type CreateApprovalGate = (values: {
  auth: AuthScope
  sessionId: string
  sessionMetadata: Record<string, unknown>
  appendEvent: (event: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<string>
}) => ToolApprovalGate

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
  budgets: BudgetRepo
  mcp: McpGateway
  sessionEvents: SessionEventPort
  audit: AuditPort
  policy: PolicyPort
  usageRecords: UsageRepo
  auditRecords: AuditReadRepo
  triggers: TriggerRepo
  triggerDispatch: TriggerDispatchRepo
  projects: ProjectRepo
  federatedTenants: FederatedTenantRepo
  runners: RunnerRepo
  workItems: WorkItemRepo
  leases: LeaseRepo
  runtimeSecretEnv: RuntimeSecretEnvGateway
  cloudTurnQueue: CloudTurnQueue
  runnerChannel: RunnerChannel
  sandboxRuntime: SandboxRuntimeHost
  sessionOrchestration: SessionOrchestrationStore
  sessions: SessionRepo
  createApprovalGate: CreateApprovalGate
  // Mirrors the legacy AMA_RUNTIME_MODE === 'test' branch: in test mode the
  // inline cloud launch runs synchronously so the create flow re-reads the
  // started row; in production the launch is fire-and-forget.
  rereadStartedSession: boolean
}
