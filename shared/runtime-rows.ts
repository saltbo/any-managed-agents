// Plain row shapes for the runtime orchestration store, mirroring the drizzle
// $inferSelect/$inferInsert types of the corresponding tables. They live in
// shared/ (the contract leaf) so usecases/ports can describe the
// SessionOrchestrationStore boundary without importing drizzle or the schema,
// while the adapter's real drizzle rows stay structurally assignable to these.
//
// Nullability mirrors the schema: a column is required when notNull (or the
// primary key) and `| null` otherwise. JSON columns are stored as text and so
// type as `string` at this boundary (the store parses them).

export interface SessionRow {
  id: string
  agentId: string
  organizationId: string | null
  createdByUserId: string | null
  agentVersionId: string | null
  agentSnapshot: string | null
  environmentId: string | null
  environmentVersionId: string | null
  environmentSnapshot: string | null
  title: string | null
  resourceRefs: string
  env: string
  secretEnv: string
  projectId: string
  durableObjectName: string
  sandboxId: string | null
  piRuntimeId: string | null
  piProcessId: string | null
  runtimeEndpointPath: string | null
  modelProvider: string | null
  modelConfig: string | null
  state: string
  stateReason: string | null
  activeTurnId: string | null
  turnLeaseExpiresAt: string | null
  continuationDepth: number
  metadata: string
  startedAt: string | null
  stoppedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

// The insert/update accept shapes mirror $inferInsert: notNull-without-default
// columns are required, notNull-with-default + nullable columns are optional.
export interface SessionInsert {
  id: string
  agentId: string
  organizationId?: string | null
  createdByUserId?: string | null
  agentVersionId?: string | null
  agentSnapshot?: string | null
  environmentId?: string | null
  environmentVersionId?: string | null
  environmentSnapshot?: string | null
  title?: string | null
  resourceRefs?: string
  env?: string
  secretEnv?: string
  projectId: string
  durableObjectName: string
  sandboxId?: string | null
  piRuntimeId?: string | null
  piProcessId?: string | null
  runtimeEndpointPath?: string | null
  modelProvider?: string | null
  modelConfig?: string | null
  state: string
  stateReason?: string | null
  activeTurnId?: string | null
  turnLeaseExpiresAt?: string | null
  continuationDepth?: number
  metadata?: string
  startedAt?: string | null
  stoppedAt?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type SessionUpdate = Partial<SessionInsert>

export interface AgentRow {
  id: string
  projectId: string
  name: string
  description: string | null
  instructions: string | null
  providerId: string | null
  model: string | null
  skills: string
  subagents: string
  role: string | null
  capabilityTags: string
  handoffPolicy: string
  memoryPolicy: string
  tools: string
  mcpConnectors: string
  metadata: string
  archivedAt: string | null
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentVersionRow {
  id: string
  agentId: string
  projectId: string
  version: number
  instructions: string | null
  providerId: string | null
  model: string | null
  skills: string
  subagents: string
  role: string | null
  capabilityTags: string
  handoffPolicy: string
  memoryPolicy: string
  tools: string
  mcpConnectors: string
  metadata: string
  createdAt: string
}

export interface EnvironmentRow {
  id: string
  projectId: string
  name: string
  description: string | null
  packages: string
  variables: string
  credentialRefs: string
  hostingMode: string
  networkPolicy: string
  mcpPolicy: string
  packageManagerPolicy: string
  resourceLimits: string
  runtimeConfig: string
  metadata: string
  archivedAt: string | null
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
}

export interface EnvironmentVersionRow {
  id: string
  environmentId: string
  projectId: string
  version: number
  packages: string
  variables: string
  credentialRefs: string
  hostingMode: string
  networkPolicy: string
  mcpPolicy: string
  packageManagerPolicy: string
  resourceLimits: string
  runtimeConfig: string
  metadata: string
  createdAt: string
}

export interface WorkItemRow {
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
  payload: string
  result: string | null
  error: string | null
  availableAt: string
  createdAt: string
  updatedAt: string
}

export interface WorkItemInsert {
  id: string
  organizationId: string
  projectId: string
  sessionId?: string | null
  environmentId?: string | null
  runnerId?: string | null
  leaseId?: string | null
  type: string
  state?: string
  priority?: number
  attempts?: number
  maxAttempts?: number
  payload: string
  result?: string | null
  error?: string | null
  availableAt: string
  createdAt: string
  updatedAt: string
}

export interface ConnectionRow {
  id: string
  organizationId: string
  projectId: string
  connectorId: string
  credentialId: string | null
  credentialVersionId: string | null
  endpointUrl: string | null
  approvalMode: string
  state: string
  lastError: string | null
  metadata: string
  connectedAt: string
  disconnectedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ConnectionToolRow {
  id: string
  connectionId: string
  organizationId: string
  projectId: string
  connectorId: string
  name: string
  description: string | null
  inputSchema: string
  approvalMode: string
  policyMetadata: string
  availability: string
  createdAt: string
  updatedAt: string
}

export interface SessionApprovalInsert {
  id: string
  organizationId: string
  projectId: string
  sessionId: string
  toolCallId: string
  toolName: string
  input?: string
  relatedEventIds?: string
  state?: string
  reason?: string | null
  result?: string | null
  decidedByUserId?: string | null
  decidedAt?: string | null
  requestedAt: string
  createdAt: string
  updatedAt: string
}

// The default-or-named provider connection projection for runtime dispatch.
export interface ProviderConfigRow {
  id: string
  type: string
  baseUrl: string | null
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
}
