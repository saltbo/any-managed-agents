export interface AuthContext {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
  organization: { id: string; name: string }
  project: { id: string; name: string }
  roles: string[]
  permissions: string[]
}

export interface EnvironmentPackage {
  name: string
  version?: string
}

export interface EnvironmentVariable {
  description?: string
  required?: boolean
}

export interface SecretRef {
  name: string
  ref: string
}

export interface Environment {
  id: string
  projectId: string
  name: string
  description: string | null
  packages: EnvironmentPackage[]
  variables: Record<string, EnvironmentVariable>
  secretRefs: SecretRef[]
  networkPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeImage: Record<string, unknown>
  metadata: Record<string, unknown>
  status: 'active' | 'archived'
  archivedAt: string | null
  currentVersionId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  projectId: string
  name: string
  description: string | null
  instructions: string | null
  provider: string
  model: string
  systemPrompt: string | null
  allowedTools: string[]
  mcpConnectors: string[]
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
  status: 'active' | 'archived'
  archivedAt: string | null
  currentVersionId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface AgentVersion {
  id: string
  agentId: string
  projectId: string
  version: number
  instructions: string | null
  provider: string
  model: string
  systemPrompt: string | null
  allowedTools: string[]
  mcpConnectors: string[]
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface EnvironmentVersion
  extends Omit<
    Environment,
    'name' | 'description' | 'status' | 'archivedAt' | 'currentVersionId' | 'version' | 'updatedAt'
  > {
  environmentId: string
  version: number
}

export type SessionStatus = 'pending' | 'running' | 'idle' | 'stopped' | 'error' | 'archived' | 'requires-action'

export interface Session {
  id: string
  organizationId: string
  projectId: string
  agentId: string
  agentVersionId: string
  agentSnapshot: AgentVersion
  environmentId: string | null
  environmentVersionId: string | null
  environmentSnapshot: EnvironmentVersion | null
  title: string | null
  resourceRefs: Record<string, unknown>[]
  vaultRefs: Record<string, unknown>[]
  durableObjectName: string
  sandboxId: string | null
  piRuntimeId: string | null
  piProcessId: string | null
  runtimeEndpointPath: string
  modelProvider: string
  modelConfig: Record<string, unknown>
  status: SessionStatus
  statusReason: string | null
  metadata: Record<string, unknown>
  startedAt: string | null
  stoppedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionEvent {
  id: string
  organizationId: string
  projectId: string
  sessionId: string
  sequence: number
  type: string
  visibility: 'runtime' | 'transcript' | 'debug' | 'audit'
  role: string | null
  parentEventId: string | null
  correlationId: string | null
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface Provider {
  id: string
  projectId: string
  type: string
  displayName: string
  baseUrl: string | null
  isDefault: boolean
  status: 'active' | 'disabled' | 'deleted'
  hasCredential: boolean
  credentialStatus: 'not_required' | 'configured' | 'missing'
  metadata: Record<string, unknown>
  rateLimits: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
  modelCatalogStatus: string
  lastError: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ProviderModel {
  id: string
  providerId: string
  modelId: string
  displayName: string
  capabilities: string[]
  contextWindow: number | null
  pricing: Record<string, unknown>
  availability: 'available' | 'unavailable' | 'disabled'
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Vault {
  id: string
  organizationId: string
  projectId: string | null
  name: string
  description: string | null
  scope: 'project' | 'organization'
  metadata: Record<string, unknown>
  status: 'active' | 'archived'
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VaultCredentialVersion {
  id: string
  credentialId: string
  vaultId: string
  organizationId: string
  projectId: string | null
  version: number
  provider: 'cloudflare-secrets' | 'external-vault'
  secretRef: string
  externalVaultPath: string | null
  referenceName: string
  status: 'active' | 'superseded' | 'revoked' | 'deleted'
  hasSecret: boolean
  metadata: Record<string, unknown>
  createdAt: string
  supersededAt: string | null
  revokedAt: string | null
  deletedAt: string | null
}

export interface VaultCredential {
  id: string
  vaultId: string
  organizationId: string
  projectId: string | null
  name: string
  type: string
  connectorBinding: Record<string, unknown>
  metadata: Record<string, unknown>
  status: 'active' | 'revoked'
  activeVersionId: string | null
  activeVersion: VaultCredentialVersion | null
  revokedAt: string | null
  revokedByUserId: string | null
  revokeReason: string | null
  createdAt: string
  updatedAt: string
}

export interface McpConnector {
  id: string
  connectorId: string
  name: string
  description: string
  category: string
  trustLevel: string
  capabilities: string[]
  supportedAuthModes: string[]
  setupRequirements: string[]
  tools: Array<{ name: string; description: string | null; approvalMode: string }>
  metadata: Record<string, unknown>
  status: 'available' | 'unavailable'
  policyStatus: 'allowed' | 'blocked' | 'approval_required'
  connectionStatus: string
  createdAt: string
  updatedAt: string
}

export interface McpConnection {
  id: string
  organizationId: string
  projectId: string
  connectorId: string
  hasCredential: boolean
  endpointUrl: string | null
  approvalMode: string
  status: 'connected' | 'disabled' | 'disconnected' | 'error'
  lastError: Record<string, unknown> | null
  metadata: Record<string, unknown>
  connectedAt: string
  disconnectedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GovernancePolicy {
  id: string
  organizationId: string
  projectId: string
  scope: 'project'
  providerRules: Array<Record<string, unknown>>
  modelRules: Array<Record<string, unknown>>
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface UsageSummaryGroup {
  key: Record<string, unknown>
  records: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
}

export interface UsageSummary {
  totals: UsageSummaryGroup
  groups: UsageSummaryGroup[]
}

export interface AuditRecord {
  id: string
  organizationId: string
  projectId: string | null
  actorUserId: string | null
  actorType: string
  action: string
  resourceType: string
  resourceId: string | null
  outcome: string
  requestId: string | null
  correlationId: string | null
  sessionId: string | null
  policyCategory: string | null
  metadata: Record<string, unknown>
  before: Record<string, unknown>
  after: Record<string, unknown>
  createdAt: string
}

export interface ListPagination {
  limit: number
  nextCursor: string | null
  hasMore: boolean
  firstId: string | null
  lastId: string | null
  firstSequence?: number | null
  lastSequence?: number | null
}

export interface ListResponse<T> {
  data: T[]
  pagination: ListPagination
}

export interface ListOptions {
  includeArchived?: boolean
  search?: string
  status?: string
  createdFrom?: string
  createdTo?: string
  limit?: number
  cursor?: string
}

export interface SessionEventListOptions {
  cursor?: number
  order?: 'asc' | 'desc'
  limit?: number
  type?: SessionEvent['type']
  visibility?: SessionEvent['visibility']
  createdFrom?: string
  createdTo?: string
}

export interface EnvironmentInput {
  name: string
  description?: string
  packages?: EnvironmentPackage[]
  variables?: Record<string, EnvironmentVariable>
  secretRefs?: SecretRef[]
  networkPolicy?: Record<string, unknown>
  mcpPolicy?: Record<string, unknown>
  packageManagerPolicy?: Record<string, unknown>
  resourceLimits?: Record<string, unknown>
  runtimeImage?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface AgentInput {
  name: string
  description?: string
  instructions?: string
  provider?: string
  model?: string
  systemPrompt?: string
  allowedTools?: string[]
  mcpConnectors?: string[]
  sandboxPolicy?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface SessionInput {
  agentId: string
  environmentId: string
  title?: string
  metadata?: Record<string, unknown>
  resourceRefs?: Record<string, unknown>[]
  vaultRefs?: Record<string, unknown>[]
}

export interface ProviderInput {
  type: string
  displayName: string
  baseUrl?: string
  isDefault?: boolean
  credentialSecretRef?: string
}

export interface VaultInput {
  name: string
  description?: string
  scope?: 'project' | 'organization'
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText
    throw new ApiError(message, response.status, body)
  }
  return body as T
}

function queryString(options: object = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options as Record<string, string | number | boolean | undefined>)) {
    if (value !== undefined && value !== false) {
      params.set(key, String(value))
    }
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const api = {
  me: () => request<AuthContext>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  listAgents: (options: ListOptions = {}) => request<ListResponse<Agent>>(`/api/agents${queryString(options)}`),
  readAgent: (id: string) => request<Agent>(`/api/agents/${id}`),
  createAgent: (input: AgentInput) => request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(input) }),
  updateAgent: (id: string, input: Partial<AgentInput>) =>
    request<Agent>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  archiveAgent: (id: string) => request<void>(`/api/agents/${id}`, { method: 'DELETE' }),
  listAgentVersions: (id: string) => request<ListResponse<AgentVersion>>(`/api/agents/${id}/versions`),
  listEnvironments: (options: ListOptions = {}) =>
    request<ListResponse<Environment>>(`/api/environments${queryString(options)}`),
  readEnvironment: (id: string) => request<Environment>(`/api/environments/${id}`),
  createEnvironment: (input: EnvironmentInput) =>
    request<Environment>('/api/environments', { method: 'POST', body: JSON.stringify(input) }),
  updateEnvironment: (id: string, input: Partial<EnvironmentInput>) =>
    request<Environment>(`/api/environments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  archiveEnvironment: (id: string) => request<void>(`/api/environments/${id}`, { method: 'DELETE' }),
  listEnvironmentVersions: (id: string) =>
    request<ListResponse<EnvironmentVersion>>(`/api/environments/${id}/versions`),
  listSessions: (options: ListOptions = {}) => request<ListResponse<Session>>(`/api/sessions${queryString(options)}`),
  createSession: (input: SessionInput) =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify(input) }),
  readSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  reconnectSession: (id: string) => request<Session>(`/api/sessions/${id}/reconnect`),
  stopSession: (id: string) => request<Session>(`/api/sessions/${id}/stop`, { method: 'POST' }),
  archiveSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  listSessionEvents: (id: string, options: SessionEventListOptions = {}) =>
    request<ListResponse<SessionEvent>>(`/api/sessions/${id}/events${queryString(options)}`),
  listProviders: (options: ListOptions = {}) =>
    request<ListResponse<Provider>>(`/api/providers${queryString(options)}`),
  readProvider: (id: string) => request<Provider>(`/api/providers/${id}`),
  createProvider: (input: ProviderInput) =>
    request<Provider>('/api/providers', { method: 'POST', body: JSON.stringify(input) }),
  archiveProvider: (id: string) => request<void>(`/api/providers/${id}`, { method: 'DELETE' }),
  listProviderModels: (id: string) => request<ListResponse<ProviderModel>>(`/api/providers/${id}/models`),
  listVaults: (options: ListOptions = {}) => request<ListResponse<Vault>>(`/api/vaults${queryString(options)}`),
  readVault: (id: string) => request<Vault>(`/api/vaults/${id}`),
  createVault: (input: VaultInput) => request<Vault>('/api/vaults', { method: 'POST', body: JSON.stringify(input) }),
  archiveVault: (id: string) => request<void>(`/api/vaults/${id}`, { method: 'DELETE' }),
  listVaultCredentials: (id: string, options: ListOptions = {}) =>
    request<ListResponse<VaultCredential>>(`/api/vaults/${id}/credentials${queryString(options)}`),
  listMcpConnectors: () => request<ListResponse<McpConnector>>('/api/mcp/connectors'),
  listMcpConnections: () => request<ListResponse<McpConnection>>('/api/mcp/connections'),
  disconnectMcpConnection: (id: string) =>
    request<void>(`/api/mcp/connections/${id}?confirm=true`, { method: 'DELETE' }),
  readGovernancePolicy: () => request<GovernancePolicy>('/api/governance/policy'),
  updateGovernancePolicy: (input: Partial<GovernancePolicy>) =>
    request<GovernancePolicy>('/api/governance/policy', { method: 'PUT', body: JSON.stringify(input) }),
  readUsageSummary: () => request<UsageSummary>('/api/usage/summary'),
  listAuditRecords: () => request<ListResponse<AuditRecord>>('/api/audit-records'),
}
