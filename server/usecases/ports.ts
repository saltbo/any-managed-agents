import type { AgentConfig, AgentToolAttachment } from '@server/domain/agent'

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

export type { AgentToolAttachment }
