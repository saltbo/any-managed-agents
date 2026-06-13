import type { AgentConfig, AgentToolAttachment } from '@server/domain/agent'
import type {
  ConnectionApprovalMode,
  ConnectionState,
  ToolAvailability,
  ToolCallState,
} from '@server/domain/connection'
import type { ConnectorAvailability, ConnectorCatalogEntry, ConnectorCatalogTool } from '@server/domain/connector'
import type { EnvironmentConfig } from '@server/domain/environment'
import type { CredentialStatus, DiscoveryTaskState, ModelAvailability, ProviderType } from '@server/domain/provider'
import type {
  CredentialState,
  SecretMaterial,
  SecretProvider,
  SecretReference,
  VaultScope,
  VersionState,
} from '@server/domain/vault'
import type { DiscoveredProviderModel } from '@server/providers/adapters'

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

// Effective-policy boundary. Agents need the merged tool policy that gates which
// tools an agent version may attach; connections need the merged MCP policy (to
// gate connector creation) and full MCP tool-call evaluation.
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
  modelCatalogState: string
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
  modelCatalogState: string
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

export type { AgentToolAttachment, ConnectorCatalogTool, SecretMaterial }
