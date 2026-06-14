import type { AgentConfig, AgentToolAttachment } from '@server/domain/agent'
import type {
  ConnectionApprovalMode,
  ConnectionState,
  ToolAvailability,
  ToolCallState,
} from '@server/domain/connection'
import type { ConnectorAvailability, ConnectorCatalogEntry, ConnectorCatalogTool } from '@server/domain/connector'
import type { EnvironmentConfig } from '@server/domain/environment'
import type {
  CredentialStatus,
  DiscoveryTaskState,
  ModelAvailability,
  ModelCatalogState,
  ProviderType,
} from '@server/domain/provider'
import type { DiscoveredProviderModel } from '@server/domain/provider-adapter'
import type { RunnerAuthMode } from '@server/domain/runner-queue'
import type {
  CredentialState,
  SecretMaterial,
  SecretProvider,
  SecretReference,
  VaultScope,
  VersionState,
} from '@server/domain/vault'

// A port-level error so the http layer can map orchestration validation
// failures to a 400 without importing usecases internals or adapters. The
// fields map mirrors the domain FieldErrors shape.
export class AgentValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'AgentValidationError'
    this.fields = fields
  }
}

// Agent thrown when an archived agent receives field updates. The http layer
// maps it to 409.
export class AgentArchivedError extends Error {
  constructor(message = 'Archived agents cannot be updated') {
    super(message)
    this.name = 'AgentArchivedError'
  }
}

// Identity claims the audit + policy ports need. Mirrors the http auth context
// without dragging the http auth module into usecases.
export interface AuthScope {
  organization: { id: string; name: string }
  project: { id: string; name: string; organizationId?: string }
  user: { id: string }
  roles: string[]
  permissions: string[]
  teams?: string[]
}

// Organization-level identity: the AuthScope subset that org-scoped usecases
// (which never resolve a project) require. Both AuthScope and the project-less
// http AuthIdentity satisfy it structurally, so neither needs a cast.
export type OrgScope = Pick<AuthScope, 'organization'>

export interface AgentRecord extends AgentConfig {
  id: string
  projectId: string
  name: string
  description: string | null
  archivedAt: string | null
  currentVersionId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface AgentVersionRecord extends AgentConfig {
  id: string
  agentId: string
  projectId: string
  version: number
  createdAt: string
}

export interface AgentMemoryRecord {
  agentId: string
  projectId: string
  content: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AgentHandoffCandidate {
  id: string
  name: string
  role: string | null
  capabilityTags: string[]
}

export interface AgentListQuery {
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface AgentListPage {
  rows: AgentRecord[]
  hasMore: boolean
}

export interface CreateAgentInput {
  projectId: string
  name: string
  description: string | null
  config: AgentConfig
}

export interface UpdateAgentFields {
  name: string
  description: string | null
  config: AgentConfig
  archivedAt: string | null
  currentVersionId: string | null
}

// DB boundary. The only implementation lives in adapters/repos and is the only
// place drizzle/schema is imported. Repos return parsed records — no JSON
// strings, no drizzle rows leak past this port.
export interface AgentRepo {
  list(query: AgentListQuery): Promise<AgentListPage>
  find(projectId: string, agentId: string): Promise<AgentRecord | null>
  // Live (non-archived) agents in the project, newest first — handoff resolution.
  liveAgents(projectId: string): Promise<AgentRecord[]>

  latestVersionNumber(agentId: string): Promise<number | null>
  insertVersion(
    agent: { id: string; projectId: string },
    config: AgentConfig,
    createdAt: string,
  ): Promise<AgentVersionRecord>
  listVersions(projectId: string, agentId: string): Promise<AgentVersionRecord[]>
  findVersion(projectId: string, agentId: string, version: number): Promise<AgentVersionRecord | null>

  insert(input: CreateAgentInput, createdAt: string): Promise<AgentRecord>
  setCurrentVersion(agentId: string, versionId: string): Promise<void>
  update(projectId: string, agentId: string, fields: UpdateAgentFields, updatedAt: string): Promise<void>
  unarchive(projectId: string, agentId: string, updatedAt: string): Promise<void>

  findMemory(projectId: string, agentId: string): Promise<AgentMemoryRecord | null>
  insertMemory(record: AgentMemoryRecord): Promise<void>
  replaceMemory(
    projectId: string,
    agentId: string,
    content: string,
    metadata: Record<string, unknown>,
    updatedAt: string,
  ): Promise<void>

  // Reference validation against sibling resources.
  providerEnabled(projectId: string, providerId: string): Promise<boolean>
  modelAvailable(projectId: string, providerId: string, model: string): Promise<boolean>
  connectorConnected(projectId: string, connectorId: string): Promise<boolean>
}

export interface AuditEntry {
  action: string
  resourceType: string
  resourceId?: string | null
  outcome: 'success' | 'failure' | 'denied'
  requestId?: string | null
  // Correlates the audit record with a broader dispatch flow (e.g. a scheduled
  // trigger run). Persisted to the audit_records.correlation_id column.
  correlationId?: string | null
  // Correlates the audit record with a session (e.g. a tool call denied inside
  // a session). Persisted to the audit_records.session_id column.
  sessionId?: string | null
  policyCategory?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

// Audit log boundary. Records governance-relevant mutations.
export interface AuditPort {
  record(auth: AuthScope, entry: AuditEntry): Promise<void>
}

// A policy decision crossing the port boundary. Mirrors the http-layer
// PolicyDecision so the connections usecase can branch on it without importing
// the policy module.
export interface PolicyDecisionResult {
  allowed: boolean
  category: string
  rule: string | null
  message: string
}

// The sandbox operation a runtime tool maps to, mirrored at the port boundary
// so the runtime callers branch on it without importing the policy module.
// Structurally matches domain/policy's SandboxRuntimeOperation so the adapter's
// real return value is assignable.
export type SandboxRuntimeOperationView =
  | { operation: 'command'; command: string | null; resourceType: 'sandbox_command'; resourceId: string }
  | { operation: 'network'; host: string | null; resourceType: 'sandbox_network'; resourceId: string }

// A blocked sandbox operation: the denying decision plus the operation it
// concerns. Null at the call site means the tool is not a sandbox operation or
// the operation is allowed.
export interface SandboxPolicyBlock {
  decision: PolicyDecisionResult
  operation: SandboxRuntimeOperationView
}

// Session-creation provider decision crossing the port boundary. Mirrors
// server/policy's ProviderPolicySessionDecision: the resolved decision plus the
// denied decision an admin explicitly overrode (null when none).
export interface ProviderPolicySessionDecisionView {
  decision: PolicyDecisionResult
  override: PolicyDecisionResult | null
}

// Effective-policy boundary. Agents need the merged tool policy that gates which
// tools an agent version may attach; connections need the merged MCP policy (to
// gate connector creation) and full MCP tool-call evaluation. The
// effective-policy resource reads the full merged policy and evaluates a
// provider/model decision. The DB-mixed hierarchy resolution and provider
// evaluation stay in server/policy.ts behind this port.
export interface PolicyPort {
  resolveToolPolicy(auth: AuthScope): Promise<Record<string, unknown>>
  resolveMcpPolicy(auth: AuthScope): Promise<Record<string, unknown>>
  evaluateMcpTool(
    auth: AuthScope,
    values: {
      connectorId: string
      toolName: string
      session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null }
    },
  ): Promise<PolicyDecisionResult>
  resolveEffective(auth: AuthScope): Promise<EffectivePolicyResult>
  evaluateProvider(auth: AuthScope, values: { providerId: string; modelId: string }): Promise<PolicyDecisionResult>
  // Sandbox executor seam: evaluates a startup/command/network operation against
  // the governance sandbox policy and the session environment network policy.
  // Session creation gates the cloud startup; the executor gates command/network.
  evaluateSandboxRuntime(
    auth: AuthScope,
    values: {
      session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null }
      operation: 'startup' | 'command' | 'network'
      command: string | null
      host: string | null
    },
  ): Promise<PolicyDecisionResult>
  // Maps a runtime tool call to its sandbox operation and gates it. Returns null
  // when the tool is not a sandbox operation or the operation is allowed.
  policyBlocksSandboxOperation(
    auth: AuthScope,
    values: {
      session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null }
      toolName: string
      input: Record<string, unknown>
    },
  ): Promise<SandboxPolicyBlock | null>
  // Whether a sensitive sandbox tool demands a human decision before execution.
  toolPolicyRequiresApproval(auth: AuthScope, toolName: string): Promise<boolean>
  // Session-creation provider gate: evaluates effective provider policy and
  // honors an explicit admin override request only for admin-role callers.
  evaluateProviderForSession(
    auth: AuthScope,
    values: { providerId: string; modelId: string | null; adminOverride?: boolean },
  ): Promise<ProviderPolicySessionDecisionView>
}

// --- environments ---

// Port-level validation error for environment orchestration. The http layer
// maps it to a 400 with the same field-keyed shape the domain produces.
export class EnvironmentValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'EnvironmentValidationError'
    this.fields = fields
  }
}

// Thrown when an archived environment receives field updates. The http layer
// maps it to 409.
export class EnvironmentArchivedError extends Error {
  constructor(message = 'Archived environments cannot be updated') {
    super(message)
    this.name = 'EnvironmentArchivedError'
  }
}

export interface EnvironmentRecord extends EnvironmentConfig {
  id: string
  projectId: string
  name: string
  description: string | null
  archivedAt: string | null
  currentVersionId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface EnvironmentVersionRecord extends EnvironmentConfig {
  id: string
  environmentId: string
  projectId: string
  version: number
  createdAt: string
}

export interface EnvironmentListQuery {
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface EnvironmentListPage {
  rows: EnvironmentRecord[]
  hasMore: boolean
}

export interface CreateEnvironmentInput {
  projectId: string
  name: string
  description: string | null
  config: EnvironmentConfig
}

export interface UpdateEnvironmentFields {
  name: string
  description: string | null
  config: EnvironmentConfig
  archivedAt: string | null
  currentVersionId: string | null
}

// DB boundary for environments. The only implementation lives in
// adapters/repos and is the only place drizzle/schema is imported. Repos
// return parsed records — no JSON strings, no drizzle rows leak past this port.
export interface EnvironmentRepo {
  list(query: EnvironmentListQuery): Promise<EnvironmentListPage>
  find(projectId: string, environmentId: string): Promise<EnvironmentRecord | null>

  insertVersion(
    environment: { id: string; projectId: string },
    config: EnvironmentConfig,
    createdAt: string,
  ): Promise<EnvironmentVersionRecord>
  listVersions(projectId: string, environmentId: string): Promise<EnvironmentVersionRecord[]>
  findVersion(projectId: string, environmentId: string, version: number): Promise<EnvironmentVersionRecord | null>

  insert(input: CreateEnvironmentInput, createdAt: string): Promise<EnvironmentRecord>
  setCurrentVersion(environmentId: string, versionId: string): Promise<void>
  update(projectId: string, environmentId: string, fields: UpdateEnvironmentFields, updatedAt: string): Promise<void>
  unarchive(projectId: string, environmentId: string, updatedAt: string): Promise<void>

  // Reference validation against sibling resources.
  credentialActive(organizationId: string, projectId: string, credentialId: string): Promise<boolean>
  credentialVersionUsable(credentialId: string, versionId: string): Promise<boolean>
  connectorConnected(projectId: string, connectorId: string): Promise<boolean>
}

// --- providers ---

export class ProviderValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'ProviderValidationError'
    this.fields = fields
  }
}

// Thrown when a provider is still referenced by agents and cannot be deleted.
// The http layer maps it to 409.
export class ProviderReferencedError extends Error {
  readonly fields: Record<string, string>
  constructor(
    message = 'Provider is referenced by agents and cannot be deleted',
    fields: Record<string, string> = { providerId: 'Detach or archive agents using this provider first.' },
  ) {
    super(message)
    this.name = 'ProviderReferencedError'
    this.fields = fields
  }
}

export interface ProviderRecord {
  id: string
  organizationId: string
  projectId: string
  type: ProviderType
  displayName: string
  baseUrl: string | null
  isDefault: boolean
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
  credentialStatus: CredentialStatus
  metadata: Record<string, unknown>
  rateLimits: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
  modelCatalogState: ModelCatalogState
  lastError: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ProviderModelRecord {
  id: string
  providerId: string
  modelId: string
  displayName: string
  capabilities: string[]
  contextWindow: number | null
  pricing: Record<string, unknown>
  availability: ModelAvailability
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ModelDiscoveryTaskRecord {
  id: string
  providerId: string
  state: DiscoveryTaskState
  discoveredCount: number | null
  error: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ProviderListQuery {
  projectId: string
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface ProviderListPage {
  rows: ProviderRecord[]
  hasMore: boolean
}

export interface CreateProviderInput {
  organizationId: string
  projectId: string
  type: ProviderType
  displayName: string
  baseUrl: string | null
  isDefault: boolean
  credentialId: string | null
  credentialVersionId: string | null
  metadata: Record<string, unknown>
  rateLimits: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
}

export interface UpdateProviderFields {
  type: ProviderType
  displayName: string
  baseUrl: string | null
  isDefault: boolean
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
  metadata: Record<string, unknown>
  rateLimits: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
}

export interface UpsertProviderModelInput {
  organizationId: string
  projectId: string
  providerId: string
  modelId: string
  displayName: string
  capabilities: string[]
  contextWindow: number | null
  pricing: Record<string, unknown>
  availability: ModelAvailability
  metadata: Record<string, unknown>
}

export interface ProviderCatalogStatus {
  modelCatalogState: ModelCatalogState
  lastError: Record<string, unknown> | null
}

// DB boundary for providers, their model catalog, and discovery tasks. The
// only implementation lives in adapters/repos. The platform-default Workers AI
// provider is a synthesized read-only record (no DB row); the repo returns it
// from `platformDefault(...)` so the usecase/http need no synthesis logic.
export interface ProviderRepo {
  list(query: ProviderListQuery): Promise<ProviderListPage>
  find(projectId: string, providerId: string): Promise<ProviderRecord | null>
  platformDefault(projectId: string): ProviderRecord
  insert(input: CreateProviderInput, createdAt: string): Promise<ProviderRecord>
  update(
    projectId: string,
    providerId: string,
    fields: UpdateProviderFields,
    updatedAt: string,
  ): Promise<ProviderRecord>
  delete(projectId: string, providerId: string): Promise<void>
  clearDefaults(projectId: string, updatedAt: string): Promise<void>
  setCatalogStatus(
    projectId: string,
    providerId: string,
    status: ProviderCatalogStatus,
    updatedAt: string,
  ): Promise<void>
  agentReferences(projectId: string, providerId: string): Promise<boolean>

  listModels(projectId: string, providerId: string): Promise<ProviderModelRecord[]>
  platformDefaultModels(projectId: string, providerId: string, defaultModelId: string): ProviderModelRecord[]
  findModel(projectId: string, providerId: string, modelId: string): Promise<ProviderModelRecord | null>
  upsertModel(
    input: UpsertProviderModelInput,
    timestamp: string,
  ): Promise<{ record: ProviderModelRecord; created: boolean }>
  deleteModel(projectId: string, modelRecordId: string): Promise<void>

  insertDiscoveryTask(
    input: { organizationId: string; projectId: string; providerId: string },
    createdAt: string,
  ): Promise<ModelDiscoveryTaskRecord>
  updateDiscoveryTask(
    projectId: string,
    taskId: string,
    fields: { state: DiscoveryTaskState; discoveredCount: number | null; error: Record<string, unknown> | null },
    updatedAt: string,
  ): Promise<ModelDiscoveryTaskRecord>
  findDiscoveryTask(projectId: string, providerId: string, taskId: string): Promise<ModelDiscoveryTaskRecord | null>
}

// External-provider catalog boundary. Fetches a provider's live model list;
// the only fetch caller for provider discovery. Throws on transport/HTTP
// failure (normalized by the usecase into a stable error category).
export interface ProviderCatalogGateway {
  fetchCatalog(provider: { type: string; baseUrl: string | null }): Promise<DiscoveredProviderModel[]>
}

// --- vaults ---

// Thrown when secret material is invalid (bad provider field combination,
// unapproved external path, secret-store failure). The http layer maps it to a
// 400 validation error keyed on the secret field.
export class VaultSecretError extends Error {
  constructor(message = 'Invalid secret reference') {
    super(message)
    this.name = 'VaultSecretError'
  }
}

// Thrown when a credential version cannot be deleted: it is the active version
// or pinned by live runtime metadata. The http layer maps it to 409.
export class VaultVersionReferencedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultVersionReferencedError'
  }
}

export interface VaultRecord {
  id: string
  organizationId: string
  projectId: string | null
  name: string
  description: string | null
  scope: VaultScope
  metadata: Record<string, unknown>
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CredentialRecord {
  id: string
  vaultId: string
  organizationId: string
  projectId: string | null
  name: string
  type: string
  connectorBinding: Record<string, unknown>
  metadata: Record<string, unknown>
  state: CredentialState
  activeVersionId: string | null
  revokedAt: string | null
  revokedByUserId: string | null
  revokeReason: string | null
  createdAt: string
  updatedAt: string
}

export interface CredentialVersionRecord {
  id: string
  credentialId: string
  vaultId: string
  organizationId: string
  projectId: string | null
  version: number
  provider: SecretProvider
  secretRef: string
  externalVaultPath: string | null
  referenceName: string
  state: VersionState
  hasSecret: boolean
  // Includes stored secret material (encryptedSecretValue, cloudflareSecretId).
  // Never serialize the raw metadata — strip stored secret keys first.
  metadata: Record<string, unknown>
  createdAt: string
  supersededAt: string | null
  revokedAt: string | null
}

export interface VaultListQuery {
  organizationId: string
  projectId: string
  archived: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CredentialListQuery {
  vaultId: string
  state?: CredentialState
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface VersionListQuery {
  credentialId: string
  state?: VersionState
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface ListPageResult<T> {
  rows: T[]
  hasMore: boolean
}

export interface VaultVisibility {
  organizationId: string
  projectId: string
}

export interface CreateVaultInput {
  organizationId: string
  projectId: string | null
  name: string
  description: string | null
  scope: VaultScope
  metadata: Record<string, unknown>
}

export interface UpdateVaultFields {
  name: string
  description: string | null
  scope: VaultScope
  projectId: string | null
  metadata: Record<string, unknown>
  archivedAt: string | null
}

export interface CreateCredentialInput {
  vaultId: string
  organizationId: string
  projectId: string | null
  name: string
  type: string
  connectorBinding: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface InsertVersionInput {
  id: string
  credentialId: string
  vaultId: string
  organizationId: string
  projectId: string | null
  version: number
  reference: SecretReference
  metadata: Record<string, unknown>
}

// DB boundary for vaults, credentials, and versions. The only implementation
// lives in adapters/repos. Visibility (project|organization scope) is enforced
// inside the repo.
export interface VaultRepo {
  list(query: VaultListQuery): Promise<ListPageResult<VaultRecord>>
  find(vaultId: string, visibility: VaultVisibility): Promise<VaultRecord | null>
  insert(input: CreateVaultInput, createdAt: string): Promise<VaultRecord>
  update(vaultId: string, fields: UpdateVaultFields, updatedAt: string): Promise<void>
  hasCredentials(vaultId: string): Promise<boolean>

  listCredentials(query: CredentialListQuery): Promise<ListPageResult<CredentialRecord>>
  findCredential(vaultId: string, credentialId: string): Promise<CredentialRecord | null>
  activeVersion(credential: CredentialRecord): Promise<CredentialVersionRecord | null>
  latestVersionNumber(credentialId: string): Promise<number>
  insertCredentialWithVersion(
    credential: CreateCredentialInput,
    version: InsertVersionInput,
    createdAt: string,
  ): Promise<{ credential: CredentialRecord; version: CredentialVersionRecord }>
  updateCredential(
    credentialId: string,
    fields: {
      metadata: Record<string, unknown>
      state: CredentialState
      activeVersionId: string | null
      revokedAt: string | null
      revokedByUserId: string | null
      revokeReason: string | null
    },
    updatedAt: string,
    revokeActiveVersions: boolean,
    revokedAt: string,
  ): Promise<void>

  listVersions(query: VersionListQuery): Promise<ListPageResult<CredentialVersionRecord>>
  findVersion(credentialId: string, versionId: string): Promise<CredentialVersionRecord | null>
  insertVersionRotation(
    version: InsertVersionInput,
    previousActiveVersionId: string | null,
    timestamp: string,
  ): Promise<CredentialVersionRecord>
  deleteVersion(versionId: string): Promise<void>
  versionHasActiveReferences(version: CredentialVersionRecord): Promise<boolean>
}

// Secret-store boundary (crypto + Cloudflare secrets). Stores a secret value
// for a credential version (returns stored metadata, e.g. ciphertext +
// cloudflareSecretId) and deletes a stored secret. The only fetch caller for
// vault secret material. Throws on invalid material or transport failure.
export interface SecretStoreGateway {
  store(reference: SecretReference, values: SecretMaterial): Promise<Record<string, unknown> | undefined>
  delete(version: { provider: string; hasSecret: boolean; metadata: Record<string, unknown> }): Promise<void>
}

// --- connectors ---

export interface ConnectorRecord extends ConnectorCatalogEntry {
  createdAt: string
  updatedAt: string
}

export interface ConnectorListQuery {
  search?: string
  category?: string
  trustLevel?: string
  capability?: string
  availability?: ConnectorAvailability
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for the connector catalog. The catalog is a static, read-only
// platform directory; rows are lazily seeded once and only read afterwards.
export interface ConnectorRepo {
  seedCatalog(): Promise<void>
  list(query: ConnectorListQuery): Promise<ListPageResult<ConnectorRecord>>
  find(connectorId: string): Promise<ConnectorRecord | null>
}

// --- connections ---

// Thrown when a connection operation conflicts with current state (connector
// unavailable, connection already exists, endpoint missing, credential
// unavailable). The http layer maps it to 409. `details` carries optional
// structured error fields.
export class ConnectionConflictError extends Error {
  readonly details: Record<string, unknown> | undefined
  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ConnectionConflictError'
    this.details = details
  }
}

// Thrown when a referenced connector or credential is required but missing. The
// http layer maps it to 400.
export class ConnectionValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'ConnectionValidationError'
    this.fields = fields
  }
}

// Thrown when governance policy blocks creating the connection. The http layer
// maps it to 403.
export class ConnectionPolicyDeniedError extends Error {
  readonly connectorId: string
  constructor(connectorId: string, message = 'MCP connector is blocked by governance policy.') {
    super(message)
    this.name = 'ConnectionPolicyDeniedError'
    this.connectorId = connectorId
  }
}

export interface ConnectionRecord {
  id: string
  organizationId: string
  projectId: string
  connectorId: string
  credentialId: string | null
  credentialVersionId: string | null
  endpointUrl: string | null
  approvalMode: ConnectionApprovalMode
  state: ConnectionState
  lastError: Record<string, unknown> | null
  metadata: Record<string, unknown>
  connectedAt: string
  disconnectedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ConnectionToolRecord {
  id: string
  connectionId: string
  connectorId: string
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
  approvalMode: ConnectionApprovalMode
  policyMetadata: Record<string, unknown>
  availability: ToolAvailability
  createdAt: string
  updatedAt: string
}

export interface ToolCallRecord {
  id: string
  connectionId: string
  connectorId: string
  toolName: string
  sessionId: string
  state: ToolCallState
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: { type: string; message: string } | null
  durationMs: number
  createdAt: string
}

export interface ConnectionListQuery {
  projectId: string
  state?: ConnectionState
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface ToolCallListQuery {
  projectId: string
  connectionId: string
  toolName: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateConnectionInput {
  organizationId: string
  projectId: string
  connectorId: string
  credentialId: string | null
  credentialVersionId: string | null
  endpointUrl: string | null
  approvalMode: ConnectionApprovalMode
  metadata: Record<string, unknown>
}

export interface UpdateConnectionFields {
  credentialId: string | null
  credentialVersionId: string | null
  endpointUrl: string | null
  approvalMode: ConnectionApprovalMode
  state: ConnectionState
  disconnectedAt: string | null
  metadata: Record<string, unknown>
}

export interface ResolvedCredential {
  credentialId: string | null
  credentialVersionId: string | null
}

export interface ToolCallExecution {
  id: string
  organizationId: string
  projectId: string
  connectionId: string
  connectorId: string
  toolName: string
  sessionId: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  state: ToolCallState
  error: { type: string; message: string } | null
  durationMs: number
  createdAt: string
}

// DB boundary for connections, their synced tools, and tool-call records. The
// only implementation lives in adapters/repos.
export interface ConnectionRepo {
  list(query: ConnectionListQuery): Promise<ListPageResult<ConnectionRecord>>
  find(projectId: string, connectionId: string): Promise<ConnectionRecord | null>
  findByConnector(projectId: string, connectorId: string): Promise<ConnectionRecord | null>
  insert(input: CreateConnectionInput, timestamp: string): Promise<ConnectionRecord>
  update(connectionId: string, fields: UpdateConnectionFields, updatedAt: string): Promise<ConnectionRecord>

  // Reference validation against sibling resources.
  resolveCredential(
    visibility: VaultVisibility,
    ref: { credentialId: string; versionId?: string | undefined } | null,
  ): Promise<ResolvedCredential>
  findSession(
    projectId: string,
    sessionId: string,
  ): Promise<{ id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null>

  listTools(connectionId: string): Promise<ConnectionToolRecord[]>
  findTool(connectionId: string, toolName: string): Promise<ConnectionToolRecord | null>
  // Replaces all synced tool rows from the catalog tool metadata captured at
  // connect time (connection.approvalMode overrides per-tool when not policy).
  replaceCatalogTools(connection: ConnectionRecord, catalogTools: ConnectorCatalogTool[]): Promise<void>
  // Replaces all synced tool rows from a live MCP server listing.
  replaceServerTools(connection: ConnectionRecord, tools: McpServerToolDescriptor[]): Promise<void>

  // Persists a tool-call record (input/output redacted at this boundary) and
  // returns the persisted record so the response mirrors what was stored.
  insertToolCall(execution: ToolCallExecution): Promise<ToolCallRecord>
  listToolCalls(query: ToolCallListQuery): Promise<ListPageResult<ToolCallRecord>>
  findToolCall(
    projectId: string,
    connectionId: string,
    toolName: string,
    callId: string,
  ): Promise<ToolCallRecord | null>
}

export interface McpToolError {
  type: string
  message: string
}

export interface McpServerToolDescriptor {
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
}

export interface McpCallResult {
  content: unknown[]
  structuredContent: Record<string, unknown> | null
  isError: boolean
}

// The connection target an MCP gateway call resolves: endpoint, the vault
// scope + credential to authorize with, and the per-connection request timeout.
export interface McpConnectionTarget {
  endpointUrl: string
  organizationId: string
  projectId: string
  credentialId: string | null
  credentialVersionId: string | null
  timeoutMs: number
}

// MCP client boundary (fetch). Lists/calls tools against a live MCP server,
// resolving the connection credential to an Authorization header. Failures are
// categorized into the stable McpToolError surface.
export interface McpGateway {
  readonly upstreamError: McpToolError
  normalizeError(error: unknown): McpToolError
  validateToolInput(schema: Record<string, unknown>, input: Record<string, unknown>): void
  listTools(target: McpConnectionTarget): Promise<McpServerToolDescriptor[]>
  callTool(
    target: McpConnectionTarget,
    values: { toolName: string; input: Record<string, unknown> },
  ): Promise<McpCallResult>
}

// Session-event boundary. The connections tool-call flow appends canonical
// session events (policy decisions, tool execution start/end) so MCP activity
// stays inspectable on the session after completion.
export interface SessionEventPort {
  append(values: {
    auth: AuthScope
    sessionId: string
    type: 'policy.decision' | 'tool_execution_start' | 'tool_execution_end'
    payload: Record<string, unknown>
    parentEventId?: string | null
    correlationId?: string | null
  }): Promise<string>
}

// --- governance: policies, access rules, budgets ---

import type { BudgetScope, PolicyScopeLevel } from '@server/domain/policy'

// Field-keyed validation error for governance CRUD orchestration (scope rules,
// immutability). The http layer maps it to a 400 with the same shape the domain
// produces.
export class GovernanceValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'GovernanceValidationError'
    this.fields = fields
  }
}

// Thrown when a scoped policy already exists for the requested scope. The http
// layer maps it to 409.
export class PolicyScopeConflictError extends Error {
  readonly policyId: string
  constructor(policyId: string, message = 'A policy already exists for this scope') {
    super(message)
    this.name = 'PolicyScopeConflictError'
    this.policyId = policyId
  }
}

export interface PolicyScope {
  level: PolicyScopeLevel
  teamId?: string
}

export interface PolicyRecord {
  id: string
  projectId: string
  scope: PolicyScope
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreatePolicyInput {
  organizationId: string
  projectId: string
  scope: PolicyScope
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface ReplacePolicyFields {
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}

// DB boundary for scoped governance policy documents. The only implementation
// lives in adapters/repos. Repos return parsed records — no JSON strings.
export interface PolicyRepo {
  list(projectId: string): Promise<PolicyRecord[]>
  find(projectId: string, policyId: string): Promise<PolicyRecord | null>
  findByScope(projectId: string, scope: PolicyScope): Promise<PolicyRecord | null>
  insert(input: CreatePolicyInput, timestamp: string): Promise<PolicyRecord>
  replace(projectId: string, policyId: string, fields: ReplacePolicyFields, updatedAt: string): Promise<PolicyRecord>
  delete(projectId: string, policyId: string): Promise<void>
}

export interface AccessRuleRecord {
  id: string
  providerId: string
  modelId: string
  teamId: string | null
  effect: 'allow' | 'deny'
  reason: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateAccessRuleInput {
  organizationId: string
  projectId: string
  providerId: string
  modelId: string
  teamId: string | null
  effect: 'allow' | 'deny'
  reason: string | null
  metadata: Record<string, unknown>
}

export interface UpdateAccessRuleFields {
  effect: 'allow' | 'deny'
  reason: string | null
  metadata: Record<string, unknown>
}

// DB boundary for provider/model access rules. The only implementation lives in
// adapters/repos.
export interface AccessRuleRepo {
  list(projectId: string): Promise<AccessRuleRecord[]>
  find(projectId: string, ruleId: string): Promise<AccessRuleRecord | null>
  insert(input: CreateAccessRuleInput, timestamp: string): Promise<AccessRuleRecord>
  update(
    projectId: string,
    ruleId: string,
    fields: UpdateAccessRuleFields,
    updatedAt: string,
  ): Promise<AccessRuleRecord>
  delete(projectId: string, ruleId: string): Promise<void>
}

export interface BudgetRecord {
  id: string
  scope: BudgetScope
  providerId: string | null
  modelId: string | null
  limitType: 'tokens' | 'cost_micros' | 'sessions'
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateBudgetInput {
  organizationId: string
  projectId: string
  scope: BudgetScope
  providerId: string | null
  modelId: string | null
  limitType: 'tokens' | 'cost_micros' | 'sessions'
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
}

export interface UpdateBudgetFields {
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
}

// DB boundary for usage budgets. The only implementation lives in
// adapters/repos.
export interface BudgetRepo {
  list(projectId: string): Promise<BudgetRecord[]>
  listEnabled(projectId: string): Promise<BudgetRecord[]>
  find(projectId: string, budgetId: string): Promise<BudgetRecord | null>
  insert(input: CreateBudgetInput, timestamp: string): Promise<BudgetRecord>
  update(projectId: string, budgetId: string, fields: UpdateBudgetFields, updatedAt: string): Promise<BudgetRecord>
  delete(projectId: string, budgetId: string): Promise<void>
}

// The merged effective governance policy (org → team → project) the
// effective-policy resource reads. Mirrors resolveEffectivePolicy's projection;
// the heavy hierarchy resolution stays in server/policy.ts behind this port.
export interface EffectivePolicyResult {
  source: { type: string; id: string }
  sources: { scope: string; id: string; teamId: string | null }[]
  accessRules: {
    id: string
    providerId: string
    modelId: string
    teamId: string | null
    effect: 'allow' | 'deny'
    reason: string | null
  }[]
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
}

// --- policy evaluation (read side) ---

import type {
  BudgetRule,
  BudgetUsageRecord,
  PolicyAccessRule,
  PolicyLevel,
  ProviderAccessRule,
} from '@server/domain/policy'

// A provider row the policy engine evaluates: enablement + the vault credential
// binding it must verify is still usable.
export interface PolicyProvider {
  id: string
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
}

// An MCP connection row the policy engine gates: connection state + credential
// binding + tool availability the tool-call decision needs.
export interface PolicyConnection {
  id: string
  state: string
  credentialId: string | null
  credentialVersionId: string | null
}

// Read-only DB boundary for the cross-cutting policy engine (server/policy.ts).
// Aggregates every governance read the engine needs so the engine itself stays
// drizzle-free: it composes these reads with the pure decision rules in
// domain/policy.ts. The only implementation lives in adapters/repos. `auth` is
// the same identity shape the engine receives (org/project/team claims).
export interface PolicyEvalRepo {
  // The applicable policy hierarchy rows (org for the org, all team rows, the
  // project row); applicablePolicyLevels filters them by team membership.
  policyLevels(auth: AuthScope): Promise<PolicyLevel[]>
  // Every access rule for the project (effective-policy projection).
  projectAccessRules(projectId: string): Promise<PolicyAccessRule[]>

  // The provider row matched by id (or the workers-ai type for the platform
  // default id); null when not configured.
  findProvider(projectId: string, providerId: string): Promise<PolicyProvider | null>
  // Whether the provider's pinned/active vault credential version is usable
  // (credential + version present and not revoked).
  providerCredentialUsable(auth: AuthScope, provider: PolicyProvider): Promise<boolean>
  // The access rules matching a provider/model lookup, scoped to the project.
  providerAccessRules(
    projectId: string,
    values: { providerId: string; providerRowId: string | null; modelId: string | null },
  ): Promise<ProviderAccessRule[]>

  // The project's successful usage records (budget windows filter by createdAt).
  successfulUsage(projectId: string): Promise<BudgetUsageRecord[]>
  // The project's enabled budgets.
  enabledBudgets(projectId: string): Promise<BudgetRule[]>

  // The connection for a connector in the project; null when absent.
  findConnection(projectId: string, connectorId: string): Promise<PolicyConnection | null>
  // The synced tool row for a connector tool; null when absent.
  findConnectionTool(
    connectionId: string,
    connectorId: string,
    toolName: string,
  ): Promise<{ availability: string } | null>
  // Whether the connection's resolved credential version is active (resolving
  // the credential's active version when the connection pins none).
  connectionCredentialUsable(auth: AuthScope, connection: PolicyConnection): Promise<boolean>
}

// --- usage records + summary (read-only reporting) ---

import type { UsageMeasurement, UsageProviderType, UsageStatus, UsageType } from '@server/domain/usage'

export interface UsageRecord {
  id: string
  projectId: string
  agentId: string | null
  agentVersionId: string | null
  sessionId: string | null
  sessionEventId: string | null
  correlationId: string | null
  providerId: string | null
  providerType: UsageProviderType
  modelId: string
  status: UsageStatus
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
  usageType: UsageType
  metadata: Record<string, unknown>
  createdAt: string
}

export interface UsageListQuery {
  projectId: string
  providerId?: string
  modelId?: string
  agentId?: string
  sessionId?: string
  from?: string
  to?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface UsageSummaryQuery {
  projectId: string
  from?: string
  to?: string
}

// DB boundary for usage records. Read-only: rows are written by the runtime
// metering path, this port only lists/reads/aggregates. The only implementation
// lives in adapters/repos. `list` returns the full filtered, ordered set (the
// route paginates or serializes to CSV); `summaryRows` returns the bare
// measurement projection the domain summarizer folds over.
export interface UsageRepo {
  list(query: UsageListQuery): Promise<UsageRecord[]>
  find(projectId: string, recordId: string): Promise<UsageRecord | null>
  summaryRows(query: UsageSummaryQuery): Promise<UsageMeasurement[]>
}

// --- audit records (read side) ---

export interface AuditRecord {
  id: string
  projectId: string | null
  actorUserId: string | null
  actorType: 'user' | 'system'
  action: string
  resourceType: string
  resourceId: string | null
  outcome: 'success' | 'failure' | 'denied'
  requestId: string | null
  correlationId: string | null
  sessionId: string | null
  policyCategory: string | null
  metadata: Record<string, unknown>
  before: Record<string, unknown>
  after: Record<string, unknown>
  createdAt: string
}

export interface AuditListQuery {
  organizationId: string
  actorId?: string
  projectId?: string
  action?: string
  resourceType?: string
  resourceId?: string
  outcome?: string
  from?: string
  to?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for reading audit records. Distinct from AuditPort (the write
// boundary other resources use to record governance mutations): this is the
// audit *resource* reading its own log. The repo redacts secret material from
// metadata/before/after at this boundary so raw secrets never leave the DB.
export interface AuditReadRepo {
  list(query: AuditListQuery): Promise<AuditRecord[]>
  find(organizationId: string, recordId: string): Promise<AuditRecord | null>
}

// --- triggers ---

import type { RuntimeName } from '@server/contracts/environment-contracts'

// Field-keyed validation error for trigger orchestration (secret-material
// rejection). The http layer maps it to a 400.
export class TriggerValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'TriggerValidationError'
    this.fields = fields
  }
}

// Thrown when an archived trigger receives field updates, or when the
// referenced agent/environment is archived/unavailable. `status` selects the
// http mapping (404 missing, 409 conflict).
export class TriggerConflictError extends Error {
  readonly status: 404 | 409
  constructor(message: string, status: 404 | 409 = 409) {
    super(message)
    this.name = 'TriggerConflictError'
    this.status = status
  }
}

export interface TriggerSchedule {
  intervalSeconds: number
  windowSeconds: number
}

export interface SecretEnvEntry {
  name: string
  credentialRef: { credentialId: string; versionId?: string }
}

export interface TriggerConfig {
  agentId: string
  environmentId: string
  runtime: RuntimeName
  name: string
  promptTemplate: string
  resourceRefs: Record<string, unknown>[]
  env: Record<string, string>
  secretEnv: SecretEnvEntry[]
  schedule: TriggerSchedule
  enabled: boolean
  nextDueAt: string
  metadata: Record<string, unknown>
}

export interface TriggerRecord extends TriggerConfig {
  id: string
  projectId: string
  lastDispatchedAt: string | null
  lastRunId: string | null
  createdByUserId: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TriggerRunRecord {
  id: string
  projectId: string
  triggerId: string
  scheduledFor: string
  heartbeatAt: string
  state: 'claimed' | 'session_created' | 'failed'
  idempotencyKey: string
  sessionId: string | null
  correlationId: string
  errorMessage: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface TriggerListQuery {
  projectId: string
  archived: boolean
  enabled?: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface TriggerRunListQuery {
  projectId: string
  triggerId: string
  state?: 'claimed' | 'session_created' | 'failed'
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateTriggerInput {
  organizationId: string
  projectId: string
  config: TriggerConfig
  createdByUserId: string | null
}

export interface UpdateTriggerFields {
  config: TriggerConfig
  archivedAt: string | null
}

// DB boundary for triggers and their run sub-resource. The only implementation
// lives in adapters/repos. Repos return parsed records — no JSON strings.
export interface TriggerRepo {
  list(query: TriggerListQuery): Promise<ListPageResult<TriggerRecord>>
  find(projectId: string, triggerId: string): Promise<TriggerRecord | null>
  insert(input: CreateTriggerInput, timestamp: string): Promise<TriggerRecord>
  update(projectId: string, triggerId: string, fields: UpdateTriggerFields, updatedAt: string): Promise<TriggerRecord>

  listRuns(query: TriggerRunListQuery): Promise<ListPageResult<TriggerRunRecord>>
  findRun(projectId: string, triggerId: string, runId: string): Promise<TriggerRunRecord | null>

  // Reference validation against sibling resources, returning a stable status
  // when the agent/environment is missing (404) or unusable (409).
  agentUsable(projectId: string, agentId: string): Promise<{ status: 404 | 409; message: string } | null>
  environmentUsable(projectId: string, environmentId: string): Promise<{ status: 404 | 409; message: string } | null>
}

// --- trigger dispatch (background cron/queue) ---

// The dispatch-relevant projection of a due trigger. Carries only the fields the
// dispatch orchestration reads — the parsed execution spec plus the scheduling
// columns needed to advance the next due time. runtime is validated at the repo
// boundary so the usecase never re-parses raw column strings.
export interface DueTrigger {
  id: string
  organizationId: string
  projectId: string
  name: string
  agentId: string
  environmentId: string
  runtime: RuntimeName
  promptTemplate: string
  resourceRefs: Record<string, unknown>[]
  metadata: Record<string, unknown>
  nextDueAt: string
  intervalSeconds: number
}

// A claimed dispatch run: the idempotency-keyed triggerRuns row the dispatch
// flow advances. Null at claim time means the run was already claimed (the
// UNIQUE idempotency guard lost the race) and is skipped.
export interface ClaimedRun {
  id: string
  scheduledFor: string
  correlationId: string
}

// DB boundary for the background trigger dispatcher (cron/queue entry). The
// drizzle reads (due triggers), the idempotent run claim (UNIQUE-guarded
// insert), and the run/trigger state advances all live in adapters/repos; the
// dispatch-triggers usecase owns the orchestration (claim → session → audit).
export interface TriggerDispatchRepo {
  dueTriggers(options: { heartbeatAt: string; projectId?: string; limit: number }): Promise<DueTrigger[]>
  // Returns null when the idempotency key collides (run already claimed).
  claimRun(trigger: DueTrigger, heartbeatAt: string): Promise<ClaimedRun | null>
  projectName(projectId: string): Promise<string | null>
  markRunFailed(trigger: DueTrigger, run: ClaimedRun, message: string): Promise<void>
  markRunSessionCreated(
    trigger: DueTrigger,
    run: ClaimedRun,
    sessionId: string,
    sessionMetadata: Record<string, unknown>,
  ): Promise<void>
}

// --- projects ---

export interface ProjectRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ProjectListQuery {
  organizationId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for projects. organizationId stays in the DB for tenancy but is
// never exposed on ProjectRecord. The only implementation lives in
// adapters/repos.
export interface ProjectRepo {
  list(query: ProjectListQuery): Promise<ListPageResult<ProjectRecord>>
  find(organizationId: string, projectId: string): Promise<ProjectRecord | null>
  insert(organizationId: string, name: string, timestamp: string): Promise<ProjectRecord>
}

// --- federated tenants ---

// Thrown when a federated tenant already exists for the (issuer, externalTenant)
// pair. The http layer maps it to 409.
export class FederatedTenantConflictError extends Error {
  constructor(message = 'Federated tenant already exists for this issuer and external tenant') {
    super(message)
    this.name = 'FederatedTenantConflictError'
  }
}

export interface FederatedTenantRecord {
  id: string
  issuer: string
  externalTenantId: string
  projectId: string
  environmentId: string | null
  capabilities: string[]
  enabled: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface FederatedTenantListQuery {
  projectId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateFederatedTenantInput {
  issuer: string
  externalTenantId: string
  projectId: string
  environmentId: string | null
  capabilities: string[]
  metadata: Record<string, unknown>
}

export interface UpdateFederatedTenantFields {
  enabled: boolean
  capabilities: string[]
  environmentId: string | null
  metadata: Record<string, unknown>
}

// DB boundary for federated tenants. The only implementation lives in
// adapters/repos.
export interface FederatedTenantRepo {
  list(query: FederatedTenantListQuery): Promise<ListPageResult<FederatedTenantRecord>>
  find(projectId: string, tenantId: string): Promise<FederatedTenantRecord | null>
  findByIssuerTenant(issuer: string, externalTenantId: string): Promise<{ id: string } | null>
  insert(input: CreateFederatedTenantInput, timestamp: string): Promise<FederatedTenantRecord>
  update(
    projectId: string,
    tenantId: string,
    fields: UpdateFederatedTenantFields,
    updatedAt: string,
  ): Promise<FederatedTenantRecord>
  delete(projectId: string, tenantId: string): Promise<void>
}

// --- runners, work items, leases (self-hosted runner queue) ---

// Field-keyed validation error for runner registration orchestration (secret
// material, OIDC binding, credential/environment references). The http layer
// maps it to a 400.
export class RunnerValidationError extends Error {
  readonly fields: Record<string, string> | undefined
  constructor(message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'RunnerValidationError'
    this.fields = fields
  }
}

// Thrown when a runner/lease operation conflicts with current state (runner not
// active, at capacity, work item unavailable, lease no longer active, secret
// resolution failure). `status` selects the http mapping: a missing referenced
// resource is 404, everything else is 409.
export class RunnerConflictError extends Error {
  readonly status: 404 | 409
  constructor(message: string, status: 404 | 409 = 409) {
    super(message)
    this.name = 'RunnerConflictError'
    this.status = status
  }
}

export interface RunnerCredentialRef {
  credentialId: string
  versionId?: string
}

export interface RuntimeUsageWindow {
  label: string
  utilization: number
  resetsAt: string
}

export interface RuntimeUsage {
  runtime: string
  windows: RuntimeUsageWindow[]
}

export interface RuntimeInventoryEntry {
  runtime: string
  version?: string
  state: string
  detail?: string
}

export interface RunnerRecord {
  id: string
  projectId: string
  name: string
  capabilities: string[]
  environmentId: string | null
  credentialRef: RunnerCredentialRef | null
  authMode: RunnerAuthMode
  state: string
  currentLoad: number
  maxConcurrent: number
  runtimeUsage: RuntimeUsage[]
  runtimeInventory: RuntimeInventoryEntry[]
  metadata: Record<string, unknown>
  lastHeartbeatAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

// The full row including tenancy + OIDC binding columns the http layer needs
// for runner-token authorization. Kept distinct from the wire-facing
// RunnerRecord so authz claims never leak into a serialized response.
export interface RunnerAuthRecord extends RunnerRecord {
  organizationId: string
  oidcSubject: string | null
  oidcClientId: string | null
}

export interface RunnerListQuery {
  projectId: string
  archived: boolean
  state?: string
  environmentId?: string
  search?: string
  createdFrom?: string
  createdTo?: string
  // Runner-token scoping: a runner token only sees its own runner(s).
  runnerId?: string
  oidcSubject?: string
  oidcClientId?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface CreateRunnerInput {
  organizationId: string
  projectId: string
  name: string
  capabilities: string[]
  environmentId: string | null
  credentialRef: RunnerCredentialRef | null
  authMode: RunnerAuthMode
  oidcSubject: string | null
  oidcClientId: string | null
  maxConcurrent: number
  metadata: Record<string, unknown>
}

export interface UpdateRunnerFields {
  name: string
  capabilities: string[]
  state: string
  maxConcurrent: number
  metadata: Record<string, unknown>
  archivedAt: string | null
}

export interface RunnerHeartbeatFields {
  state: string
  capabilities: string[]
  currentLoad: number
  runtimeUsage: RuntimeUsage[]
  runtimeInventory: RuntimeInventoryEntry[]
  metadata: Record<string, unknown>
}

// DB boundary for self-hosted runners. The only implementation lives in
// adapters/repos. Repos return parsed records; the auth-bearing find returns the
// row's OIDC binding columns so the http layer can authorize runner tokens.
export interface RunnerRepo {
  list(query: RunnerListQuery): Promise<ListPageResult<RunnerAuthRecord>>
  find(projectId: string, runnerId: string): Promise<RunnerAuthRecord | null>
  // Looks up a reusable federated/oidc runner row by machine id for
  // re-registration; null when no machine binding applies.
  findForMachineRegistration(
    projectId: string,
    authMode: string,
    oidcSubject: string,
    environmentId: string | null,
    machineId: string | null,
  ): Promise<RunnerAuthRecord | null>
  insert(input: CreateRunnerInput, timestamp: string): Promise<RunnerAuthRecord>
  // Federated re-registration: rewrites the existing row and returns it.
  reregister(
    projectId: string,
    runnerId: string,
    input: CreateRunnerInput,
    timestamp: string,
  ): Promise<RunnerAuthRecord>
  update(projectId: string, runnerId: string, fields: UpdateRunnerFields, timestamp: string): Promise<RunnerAuthRecord>
  heartbeat(
    projectId: string,
    runnerId: string,
    fields: RunnerHeartbeatFields,
    timestamp: string,
  ): Promise<RunnerAuthRecord>

  // Reference validation against sibling resources.
  environmentUsable(projectId: string, environmentId: string): Promise<boolean>
  credentialRefUsable(
    organizationId: string,
    projectId: string,
    ref: RunnerCredentialRef,
  ): Promise<{ credentialMissing: boolean; versionMissing: boolean }>
}

export interface WorkItemRecord {
  id: string
  organizationId: string
  projectId: string
  sessionId: string | null
  environmentId: string | null
  runnerId: string | null
  leaseId: string | null
  type: string
  state: string
  priority: number
  attempts: number
  maxAttempts: number
  // Redacted payload (token-like values stripped). The raw payload is only
  // materialized for the lease-holding runner via `materializePayload`.
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: Record<string, unknown> | null
  availableAt: string
  leaseExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkItemListQuery {
  projectId: string
  state?: string
  sessionId?: string
  runnerId?: string
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

// DB boundary for the self-hosted work-item queue (read-only view). The only
// implementation lives in adapters/repos. `find` returns the redacted record;
// `rawPayload` returns the unredacted payload the lease-holding runner needs (the
// materialize usecase resolves its secret env). `activeLeaseRunnerId` returns the
// runner currently holding a still-active lease on the work item, or null.
export interface WorkItemRepo {
  list(query: WorkItemListQuery): Promise<ListPageResult<WorkItemRecord>>
  find(projectId: string, workItemId: string): Promise<WorkItemRecord | null>
  rawPayload(projectId: string, workItemId: string): Promise<Record<string, unknown> | null>
  activeLeaseRunnerId(projectId: string, workItemId: string): Promise<string | null>
}

// The claim-relevant projection of a work item: state machine fields plus the
// raw (unredacted) payload the eligibility gate reads.
export interface WorkItemClaimCandidate {
  state: string
  availableAt: string
  environmentId: string | null
  sessionId: string | null
  rawPayload: Record<string, unknown>
}

export interface LeaseRecord {
  id: string
  workItemId: string
  runnerId: string
  state: string
  expiresAt: string
  renewedAt: string | null
  resumeToken: string | null
  createdAt: string
  updatedAt: string
}

export interface LeaseListQuery {
  projectId: string
  runnerId?: string
  state?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface ClaimLeaseInput {
  organizationId: string
  projectId: string
  workItemId: string
  runnerId: string
  leaseDurationSeconds: number
}

export interface FinishLeaseInput {
  organizationId: string
  projectId: string
  leaseId: string
  // 'active' renews; 'interrupted' requeues for recovery; the rest are terminal.
  state: 'active' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  expiresAt?: string
  leaseDurationSeconds?: number
  resumeToken?: string
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

// DB boundary for runner work leases. The atomic work-item state transitions,
// runner load accounting, session-state-machine updates, and recovery requeue
// all live in the repo (they are pure cross-table SQL orchestration). The
// usecase owns the eligibility gate and claim-time secret resolution.
// Claim/finish return null when an optimistic guard lost the race so the
// usecase can map it to a 409.
export interface LeaseRepo {
  list(query: LeaseListQuery): Promise<ListPageResult<LeaseRecord>>
  find(projectId: string, leaseId: string): Promise<LeaseRecord | null>
  // The claim-relevant projection of a work item (state machine + raw payload).
  claimCandidate(projectId: string, workItemId: string): Promise<WorkItemClaimCandidate | null>
  // Expires leases whose deadline has passed and recovers their work items.
  // Called opportunistically before queue reads/writes.
  expireStale(projectId: string): Promise<void>
  // Atomically reserves a runner slot and flips the work item to leased.
  // Returns the created lease + claimed work item's session id, or a marker for
  // each lost-race outcome: 'at_capacity' (the runner slot reservation lost) or
  // 'work_item_lost' (another runner claimed the work item, slot released).
  claim(
    input: ClaimLeaseInput,
    timestamp: string,
  ): Promise<{ lease: LeaseRecord; sessionId: string | null } | 'at_capacity' | 'work_item_lost'>
  // Fails an already-claimed lease + work item (claim-time secret failure).
  failClaim(input: {
    projectId: string
    leaseId: string
    workItemId: string
    runnerId: string
    sessionId: string | null
    reason: string
  }): Promise<void>
  // Renews / completes / fails / cancels / interrupts a lease, transitioning the
  // work item and session. Returns the updated lease or null on a lost guard.
  finish(input: FinishLeaseInput, timestamp: string): Promise<LeaseRecord | null>

  // Channel acceptance: validates the lease still owns a self-hosted session
  // waiting for a runner channel, supersedes any active channel, creates the new
  // channel row, flips the session to running, and records the accepted event.
  // Returns the channel descriptor on success or a conflict marker the http
  // layer maps to a status. Runner authorization happens in the http layer
  // before this is called.
  prepareSessionChannel(
    scope: { organizationId: string; projectId: string },
    leaseId: string,
    timestamp: string,
  ): Promise<LeaseChannelPrepared | LeaseChannelConflict>
  // Rolls the channel + session back when the DO upgrade fails after preparation.
  rollbackSessionChannel(projectId: string, channelId: string, sessionId: string, timestamp: string): Promise<void>
}

export interface LeaseChannelPrepared {
  ok: true
  channelId: string
  sessionId: string
  workItemId: string
  runnerId: string
}

export interface LeaseChannelConflict {
  ok: false
  status: 404 | 409
  message: string
}

// Runtime secret-env boundary: resolves vault credential references into raw
// secret values for runtime dispatch. Used by the lease claim guard (to fail
// fast on an unresolvable credential) and work-item payload materialization.
// Resolved values never touch D1, events, audit, or logs. Throws on an
// unresolvable reference.
export interface RuntimeSecretEnvGateway {
  resolve(scope: { organizationId: string; projectId: string }, items: unknown): Promise<Record<string, string>>
}

// --- cloud turn queue (usecase ↔ queue worker contract) ---

// A runtime secret-env entry as it rides on a cloud-turn message: a vault
// credential reference resolved to a raw value only inside the queue consumer.
// Mirrors the gateway adapter's RuntimeSecretEnvEntry without importing it.
export interface CloudTurnSecretEnvEntry {
  name: string
  credentialRef: { credentialId: string; versionId?: string }
}

// Cloud session work runs from a queue consumer instead of HTTP waitUntil:
// a turn that shells out (installs, builds, sleeps) or a sandbox cold boot
// outlives the request lifetime cap and was silently killed mid-flight,
// stranding the session. The consumer invocation owns the wall-clock budget.
export type CloudSessionTurnMessage = {
  type: 'session.turn'
  sessionId: string
  organizationId: string
  projectId: string
  prompt: string
  auditAction: 'session.initial_prompt' | 'session.command'
}

// Continuation of a paused turn: the transcript is rebuilt from persisted
// events and the loop continues from the trailing tool results. Chaining
// steps lifts the per-invocation wall-clock cap from total turn duration.
// Carries the turnId so the step renews the SAME lease the paused turn holds —
// the continuation chain is one logical turn, so a concurrent prompt that
// arrives mid-chain loses the lease and is deferred until the chain ends.
export type CloudSessionStepMessage = {
  type: 'session.step'
  sessionId: string
  organizationId: string
  projectId: string
  // Present for a budget continuation (renew the held lease); absent for an
  // approval-resume step, which acquires a fresh lease in the consumer.
  turnId?: string
  auditAction: 'session.initial_prompt' | 'session.command'
}

export type CloudSessionStartMessage = {
  type: 'session.start'
  sessionId: string
  organizationId: string
  projectId: string
  runtime: string
  runtimeConfig: Record<string, unknown>
  resourceRefs: Array<Record<string, unknown>>
  runtimeEnv: Record<string, string>
  runtimeSecretEnv: CloudTurnSecretEnvEntry[]
  initialPrompt?: string
}

export type CloudTurnMessage = CloudSessionTurnMessage | CloudSessionStepMessage | CloudSessionStartMessage

// Cloud-turn queue boundary. The runtime enqueues start/step/turn work onto the
// CLOUD_TURNS queue (the consumer owns the wall-clock budget). `runsInline`
// reports the test/no-binding mode where turns run synchronously inline so
// existing assertions keep working. The only implementation lives in adapters.
export interface CloudTurnQueue {
  enqueue(message: CloudTurnMessage, opts?: { delaySeconds?: number }): Promise<void>
  runsInline(): boolean
}

// --- runner session channel (self-hosted runner DO) ---

// Self-hosted runner session channels live in a per-session Durable Object.
// This gateway talks to that DO over its internal fetch protocol and never
// touches control-plane tables. The only implementation lives in adapters.
export interface RunnerChannel {
  // Whether the session's runner channel DO has an accepted (active) runner.
  isAccepted(sessionId: string): Promise<boolean>
  // Dispatches a command to the runner over the channel; true when accepted.
  dispatch(sessionId: string, command: Record<string, unknown>): Promise<boolean>
}

// --- sandbox runtime host (cloud session execution) ---

// ports.ts may name the runtime-core execution contract: runtime-core/ sits
// outside the depcruise scope (it is host-agnostic, framework-free, shared by
// the Worker and the runner), so importing its types here keeps the port honest
// without dragging infrastructure into usecases.
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  RuntimeToolPolicyDecision,
  RuntimeToolPolicyInput,
  ToolExecutionInput,
  ToolExecutionResult,
} from '../../runtime-core/ports'

export type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput, ToolExecutionInput, ToolExecutionResult }

// Start input for the cloud sandbox runtime host. Plain data — no drizzle rows.
export interface SandboxRuntimeStartInput {
  sessionId: string
  sandboxId: string
  runtime?: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  environmentSnapshot: Record<string, unknown> | null
  mcpSnapshot?: Record<string, unknown>
  resourceRefs?: Record<string, unknown>[]
  runtimeEnv?: Record<string, string>
  runtimeSecretEnv?: CloudTurnSecretEnvEntry[]
  // Secret env values already resolved from the vault by the control plane.
  // Applied to the sandbox session env but never written to workspace files.
  resolvedSecretEnv?: Record<string, string>
}

export interface SandboxRuntimeStartResult {
  sandboxId: string
  runtimeEndpointPath: string
  metadata: Record<string, unknown>
}

export interface SandboxRuntimeToolCall {
  id?: string
  name?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: Record<string, unknown>
  durationMs?: number
}

export interface SandboxRuntimeCommandBody {
  type?: string
  message?: string
  response?: string
  simulateError?: boolean
  errorMessage?: string
  toolCalls?: SandboxRuntimeToolCall[]
}

export interface SandboxRuntimeTurnResult {
  // 'paused': the run still wants more model turns but yielded its execution
  // budget; the caller re-enters with `continuation` to pick up the transcript.
  status: 'idle' | 'aborted' | 'paused'
}

// One model turn's outcome. 'paused' means the run wants more turns but yielded
// its execution budget; the caller re-enters with `continuation` to resume from
// the persisted transcript (whose last message is a tool result).
export type SessionTurnResult = {
  status: 'idle' | 'aborted' | 'paused'
}

// One model turn's input: the resolved provider/model, the agent snapshot, the
// prompt or continuation, and the callback bundle the turn driver supplies
// (liveness, event sink, tool-result resolver, tool-call approval, pause check).
export type SessionTurnInput = {
  sessionId: string
  sandboxId: string
  provider: string
  model: string | null
  agentSnapshot: Record<string, unknown>
  // Required unless `continuation` is set: a continuation resumes from the
  // persisted transcript whose last message is a tool result.
  prompt?: string
  continuation?: boolean
  messages?: AgentMessage[]
  // Checked before each model call after the first; returning true pauses the run.
  shouldPause?: () => boolean
  ensureActive?: () => Promise<void>
  onEvent: (event: Record<string, unknown>, metadata?: Record<string, unknown>) => Promise<void>
  approveToolCall?: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision>
  // Supplies a caller-provided tool result (e.g. an approved custom tool
  // outcome) instead of executing the tool in the sandbox.
  resolveToolResult?: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
}

// Cloud sandbox runtime host boundary. Wraps the @cloudflare/sandbox + turn
// engine host: model resolve, sandbox start/stop, workspace prep, the model
// turn loop, and tool-call execution. The only implementation lives in
// adapters/runtime. The SessionTurnInput callback bundle carries runtime-core
// message types; this port covers the host operations the runtime clusters
// reach for by capability.
export interface SandboxRuntimeHost {
  startCloudSession(input: SandboxRuntimeStartInput): Promise<SandboxRuntimeStartResult>
  stopCloudSession(sandboxId: string): Promise<void>
  executeToolCalls(input: { sessionId: string; sandboxId: string; body: unknown }): Promise<unknown[]>
  // Executes a single sandbox tool — the approval-decision continuation runs the
  // approved tool through this seam instead of the model-turn loop.
  executeTool(input: ToolExecutionInput): Promise<ToolExecutionResult>
  runTurn(input: SessionTurnInput): Promise<SessionTurnResult>
}

// --- runtime orchestration store (runtime-internal persistence boundary) ---

import type {
  AgentRow,
  AgentVersionRow,
  ConnectionRow,
  ConnectionToolRow,
  EnvironmentRow,
  EnvironmentVersionRow,
  ProviderConfigRow,
  SessionApprovalInsert,
  SessionInsert,
  SessionRow,
  SessionUpdate,
  WorkItemInsert,
  WorkItemRow,
} from '@shared/runtime-rows'
import type { CanonicalAmaSessionEvent } from '@shared/session-events'

export type {
  AgentRow,
  AgentVersionRow,
  ConnectionRow,
  ConnectionToolRow,
  EnvironmentRow,
  EnvironmentVersionRow,
  ProviderConfigRow,
  SessionRow,
} from '@shared/runtime-rows'

// Runtime-internal persistence boundary. The env-bound session execution engine
// (server/runtime/*) routes every drizzle read/write through this store so the
// runtime layer itself stays drizzle-free. It is intentionally runtime-shaped
// (raw session rows, work-item/lease/channel mechanics, snapshot reads) —
// distinct from the REST-facing SessionRepo, which serializes DTOs. The only
// implementation lives in adapters/repos/runtime-orchestration. The raw `db`
// handle is intentionally NOT on this interface: persistence stays behind the
// port surface.
export interface SessionOrchestrationStore {
  // ── session reads ──
  findSession(projectId: string, sessionId: string): Promise<SessionRow | null>
  sessionState(projectId: string, sessionId: string): Promise<{ state: string } | null>
  sessionMetadata(projectId: string, sessionId: string): Promise<{ metadata: string | null } | null>

  // ── session writes ──
  insertSession(row: SessionInsert): Promise<void>
  updateSession(projectId: string, sessionId: string, fields: SessionUpdate): Promise<void>
  updateSessionWhenState(
    projectId: string,
    sessionId: string,
    expected: string | string[],
    fields: SessionUpdate,
  ): Promise<boolean>

  // ── per-session turn lease ──
  acquireTurnLease(
    projectId: string,
    sessionId: string,
    turnId: string,
    leaseExpiresAt: string,
    now: string,
  ): Promise<boolean>
  renewTurnLease(projectId: string, sessionId: string, turnId: string, leaseExpiresAt: string): Promise<boolean>
  releaseTurnLease(projectId: string, sessionId: string, turnId: string, fields: SessionUpdate): Promise<boolean>
  incrementContinuationDepth(projectId: string, sessionId: string, turnId: string): Promise<number>

  // ── snapshot reads ──
  findAgent(projectId: string, agentId: string): Promise<AgentRow | null>
  findAgentVersion(agentId: string, versionId: string): Promise<AgentVersionRow | null>
  agentMemoryContent(projectId: string, agentId: string): Promise<string | null>
  findEnvironment(projectId: string, environmentId: string): Promise<EnvironmentRow | null>
  findEnvironmentVersion(projectId: string, versionId: string): Promise<EnvironmentVersionRow | null>

  // ── provider resolution ──
  configuredDefaultProvider(projectId: string): Promise<{ id: string; type: string } | null>
  providerType(projectId: string, providerId: string): Promise<{ type: string } | null>
  defaultProviderConfig(projectId: string): Promise<ProviderConfigRow | null>
  namedProviderConfig(projectId: string, providerId: string): Promise<ProviderConfigRow | null>

  // ── runtime/runner capability validation ──
  activeRunnerCapabilities(projectId: string, environmentId: string): Promise<string[]>

  // ── MCP snapshot resolution ──
  connectedConnections(projectId: string): Promise<ConnectionRow[]>
  availableConnectionTools(connectionId: string): Promise<ConnectionToolRow[]>

  // ── credential validation ──
  activeCredentialVersionExists(organizationId: string, projectId: string, versionId: string): Promise<boolean>
  activeCredentialExists(organizationId: string, projectId: string, credentialId: string): Promise<boolean>
  activeCredentialForSecretEnv(
    organizationId: string,
    projectId: string,
    credentialId: string,
  ): Promise<{ id: string; activeVersionId: string | null } | null>
  activeVersionForCredentialExists(credentialId: string, versionId: string): Promise<boolean>

  // ── secret-env resolution ──
  credentialForResolution(
    organizationId: string,
    projectId: string,
    credentialId: string,
  ): Promise<{ state: string; activeVersionId: string | null } | null>
  credentialVersionForResolution(
    organizationId: string,
    projectId: string,
    credentialId: string,
    versionId: string,
  ): Promise<{ state: string; metadata: string; externalVaultPath: string | null; secretRef: string } | null>

  // ── work-item enqueue + resume ──
  insertWorkItem(row: WorkItemInsert): Promise<void>
  recentSessionWorkItems(
    projectId: string,
    sessionId: string,
    limit: number,
  ): Promise<{ state: string; payload: string; result: string | null }[]>

  // ── self-hosted stop: active work items + lease/runner accounting ──
  activeSessionWorkItems(
    projectId: string,
    sessionId: string,
  ): Promise<{ id: string; runnerId: string | null; leaseId: string | null }[]>
  cancelWorkItems(projectId: string, workItemIds: string[], errorJson: string, timestamp: string): Promise<void>
  cancelLeases(projectId: string, leaseIds: string[], timestamp: string): Promise<void>
  decrementRunnerLoad(projectId: string, runnerId: string, timestamp: string): Promise<void>

  // ── turn execution reads ──
  sessionEventStream(sessionId: string): Promise<{ type: string; payload: string }[]>

  // ── pending session sweep ──
  markExpiredPendingSessions(projectId: string, expiredBefore: string, timestamp: string): Promise<void>

  // ── approval decision ──
  findApproval(projectId: string, sessionId: string, approvalId: string): Promise<unknown>
  upsertApproval(row: SessionApprovalInsert, decidedAt: string): Promise<void>

  // ── watchdog: stalled cloud sessions + leaked sandboxes ──
  markStalledCloudSessions(threshold: string, timestamp: string): Promise<void>
  leakedSandboxSessions(
    terminalStates: string[],
    limit: number,
  ): Promise<{ id: string; sandboxId: string | null; metadata: string | null }[]>
  stampSandboxDestroyed(sessionId: string, metadataJson: string): Promise<void>

  // ── runner session channel (durable object) ──
  channelSession(
    projectId: string,
    sessionId: string,
  ): Promise<{ id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null>
  channelSessionState(
    projectId: string,
    sessionId: string,
  ): Promise<{ state: string; stateReason: string | null } | null>
  channelWorkItem(projectId: string, workItemId: string): Promise<WorkItemRow | null>
  channelActiveLease(state: {
    leaseId: string
    workItemId: string
    runnerId: string
    projectId: string
  }): Promise<{ expiresAt: string } | null>
  channelActiveChannel(state: {
    channelId: string
    sessionId: string
    workItemId: string
    leaseId: string
    runnerId: string
    projectId: string
  }): Promise<{ id: string } | null>
  touchChannel(channelId: string, timestamp: string): Promise<void>
  closeChannel(channelId: string, channelState: 'closed' | 'stale', reason: string, timestamp: string): Promise<void>
  requeueSessionForRunnerRecovery(projectId: string, sessionId: string, timestamp: string): Promise<void>

  // ── canonical event append ──
  appendCanonicalEvent(
    scope: { organizationId: string; projectId: string; sessionId: string },
    canonicalEvent: CanonicalAmaSessionEvent,
  ): Promise<string>
}

// --- sessions ---

// The session DTO that crosses the wire. Internal plumbing columns
// (durableObjectName, sandboxId, runtimeEndpointPath, organizationId,
// createdByUserId, piRuntimeId, piProcessId, modelConfig) never reach this
// record — the repo strips them. runtimeMetadata, hostingMode, runtime, and
// model are derived inside the repo from the stored snapshot + metadata so the
// http layer serializes by identity.
export interface SessionRuntimeMetadata {
  hostingMode: string
  runtime: string
  runtimeConfig: Record<string, unknown>
  provider: string
  model: string | null
  driver: string | null
  backend: string | null
  protocol: string | null
}

export interface SessionRecord {
  id: string
  projectId: string
  agentId: string
  agentVersionId: string
  agentSnapshot: Record<string, unknown>
  environmentId: string | null
  environmentVersionId: string | null
  environmentSnapshot: Record<string, unknown> | null
  title: string | null
  resourceRefs: Record<string, unknown>[]
  env: Record<string, string>
  secretEnv: Array<{ name: string; credentialRef: { credentialId: string; versionId?: string } }>
  runtimeMetadata: SessionRuntimeMetadata
  state: string
  stateReason: string | null
  metadata: Record<string, unknown>
  startedAt: string | null
  stoppedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionConnectionRecord {
  sessionId: string
  transport: string | null
  path: string | null
  state: string
  stateReason: string | null
}

export interface SessionMessageRecord {
  id: string
  sessionId: string
  type: 'prompt'
  content: string
  delivery: string
  state: string
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionEventRecord {
  id: string
  projectId: string
  sessionId: string
  sequence: number
  type: string
  visibility: string
  role: string | null
  parentEventId: string | null
  correlationId: string | null
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SessionApprovalRecord {
  id: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  relatedEventIds: string[]
  state: string
  reason: string | null
  result: Record<string, unknown> | null
  requestedAt: string
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionListQuery {
  projectId: string
  archived: boolean
  state?: string
  search?: string
  createdFrom?: string
  createdTo?: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface SessionEventQuery {
  type?: string
  visibility?: string
  createdFrom?: string
  createdTo?: string
  order: 'asc' | 'desc'
  cursor?: number
  limit: number
}

export interface SessionEventPage {
  rows: SessionEventRecord[]
  hasMore: boolean
}

export interface SessionMessageListQuery {
  projectId: string
  sessionId: string
  limit: number
  cursor: { createdAt: string; id: string } | null
}

export interface SessionMessageListPage {
  rows: SessionMessageRecord[]
  hasMore: boolean
}

export interface SessionListPage {
  rows: SessionRecord[]
  hasMore: boolean
}

// The raw session row the runtime usecases need to act on a session (stop,
// dispatch, decide). It carries the internal columns the DTO hides. The repo
// is the only place the row is read; the usecase passes it straight to the
// runtime usecases and never inspects the internal fields.
export interface SessionRuntimeRow {
  id: string
  projectId: string | null
  organizationId: string | null
  state: string
  archivedAt: string | null
  sandboxId: string | null
  metadata: Record<string, unknown>
}

// DB boundary for the sessions resource. The only place sessions,
// sessionEvents, sessionMessages, and sessionApprovals tables are read for the
// REST surface. Returns DTO records with internal columns stripped.
export interface SessionRepo {
  list(query: SessionListQuery): Promise<SessionListPage>
  find(projectId: string, sessionId: string): Promise<SessionRecord | null>
  // The raw row (with internal columns) for runtime operations. Used by write
  // paths that hand the session to the runtime gateway.
  findRuntimeRow(projectId: string, sessionId: string): Promise<SessionRuntimeRow | null>
  readConnection(projectId: string, sessionId: string): Promise<SessionConnectionRecord | null>

  updateFields(
    projectId: string,
    sessionId: string,
    fields: { title?: string; metadata?: Record<string, unknown> },
    updatedAt: string,
  ): Promise<SessionRecord | null>

  listMessages(query: SessionMessageListQuery): Promise<SessionMessageListPage>
  findMessage(projectId: string, sessionId: string, messageId: string): Promise<SessionMessageRecord | null>
  insertMessage(record: {
    organizationId: string
    projectId: string
    sessionId: string
    content: string
    delivery: string
    state: string
    createdAt: string
  }): Promise<SessionMessageRecord>

  queryEvents(sessionId: string, query: SessionEventQuery): Promise<SessionEventPage>
  insertEvents(
    scope: { organizationId: string; projectId: string; sessionId: string },
    events: Array<{ type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }>,
  ): Promise<number>

  listApprovals(projectId: string, sessionId: string): Promise<SessionApprovalRecord[]>
  findApproval(projectId: string, sessionId: string, approvalId: string): Promise<SessionApprovalRecord | null>

  // Event-ingest runner gate: resolves the active, unexpired lease a runner
  // identity holds for this session (work item leased to the same runner), or
  // null. The returned metadata (runner/lease/work-item ids, runtime, provider,
  // model) is stamped onto ingested events. Returns null when the runner holds
  // no qualifying lease.
  activeSessionLeaseForRunner(
    projectId: string,
    sessionId: string,
    runner: { runnerId: string | null; subject: string },
  ): Promise<{
    runnerId: string
    leaseId: string
    workItemId: string
    runtime?: string
    provider?: string
    model?: string
  } | null>
}

// Field-keyed validation error for session orchestration. The http layer maps
// it to a 400 with the same shape governance/agents produce.
export class SessionValidationError extends Error {
  readonly fields: Record<string, string>
  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'SessionValidationError'
    this.fields = fields
  }
}

// Error crossing the runtime-usecase boundary. The http layer maps status →
// response and echoes detail/fields. Mirrors the runtime layer's outcome shape
// so the runtime session usecases forward it without re-mapping.
export interface SessionRuntimeError {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

export type SessionRuntimeOutcome<T> = { ok: true; value: T } | { ok: false; error: SessionRuntimeError }

export type PromptDispatchResult =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: Record<string, unknown> }
  | { ok: true; delivery: string; state: string }

export interface SessionCreateOptions {
  title?: string
  metadata?: Record<string, unknown>
  resourceRefs?: Record<string, unknown>[]
  runtime: string
  runtimeConfig?: Record<string, unknown>
  env?: Record<string, string>
  secretEnv?: Array<{ name: string; credentialRef: { credentialId: string; versionId?: string } }>
  initialPrompt?: string
  providerAccessOverride?: boolean
}

export type { AgentToolAttachment, ConnectorCatalogTool, SecretMaterial }
