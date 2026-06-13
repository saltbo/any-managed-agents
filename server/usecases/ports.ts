import type { AgentConfig, AgentToolAttachment } from '@server/domain/agent'
import type { EnvironmentConfig } from '@server/domain/environment'
import type { CredentialStatus, DiscoveryTaskState, ModelAvailability, ProviderType } from '@server/domain/provider'
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

// Effective-policy boundary. Agents only need the merged tool policy that gates
// which tools an agent version may attach.
export interface PolicyPort {
  resolveToolPolicy(auth: AuthScope): Promise<Record<string, unknown>>
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

export type { AgentToolAttachment }
