import { hc } from 'hono/client'

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

type RpcMethod = (args?: unknown) => Promise<RpcResponse>
type RpcMethodName = '$delete' | '$get' | '$patch' | '$post' | '$put'
type RpcNode = Record<string, unknown>

const rpc = hc('/', {
  init: { credentials: 'include' },
  headers: () => ({
    accept: 'application/json',
    'x-ama-client': 'web-rpc',
  }),
}) as unknown as { api: RpcNode }

type RpcResponse = Pick<Response, 'headers' | 'json' | 'ok' | 'status' | 'statusText' | 'text'>

async function rpcRequest<T>(responsePromise: Promise<RpcResponse>) {
  const response = await responsePromise
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

function queryOptions(options: object = {}) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(options as Record<string, string | number | boolean | undefined>)) {
    if (value !== undefined && value !== false) {
      query[key] = String(value)
    }
  }
  return query
}

function queryArgs(options: object = {}) {
  const query = queryOptions(options)
  return Object.keys(query).length > 0 ? { query } : undefined
}

function rpcRoute(...segments: string[]) {
  return segments.reduce<unknown>((node, segment) => (node as Record<string, unknown>)[segment], rpc) as RpcNode
}

function rpcCall(method: RpcMethodName, segments: string[], args?: unknown) {
  return (rpcRoute(...segments)[method] as RpcMethod satisfies RpcMethod)(args)
}

function rpcGet<T>(segments: string[], args?: unknown) {
  return rpcRequest<T>(rpcCall('$get', segments, args))
}

function rpcPost<T>(segments: string[], args?: unknown) {
  return rpcRequest<T>(rpcCall('$post', segments, args))
}

function rpcPatch<T>(segments: string[], args?: unknown) {
  return rpcRequest<T>(rpcCall('$patch', segments, args))
}

function rpcPut<T>(segments: string[], args?: unknown) {
  return rpcRequest<T>(rpcCall('$put', segments, args))
}

function rpcDelete<T>(segments: string[], args?: unknown) {
  return rpcRequest<T>(rpcCall('$delete', segments, args))
}

export const api = {
  me: () => rpcGet<AuthContext>(['api', 'auth', 'me']),
  logout: () => rpcPost<void>(['api', 'auth', 'logout']),
  listAgents: (options: ListOptions = {}) => rpcGet<ListResponse<Agent>>(['api', 'agents'], queryArgs(options)),
  readAgent: (id: string) => rpcGet<Agent>(['api', 'agents', ':agentId'], { param: { agentId: id } }),
  createAgent: (input: AgentInput) => rpcPost<Agent>(['api', 'agents'], { json: input }),
  updateAgent: (id: string, input: Partial<AgentInput>) =>
    rpcPatch<Agent>(['api', 'agents', ':agentId'], { param: { agentId: id }, json: input }),
  archiveAgent: (id: string) => rpcDelete<void>(['api', 'agents', ':agentId'], { param: { agentId: id } }),
  listAgentVersions: (id: string) =>
    rpcGet<ListResponse<AgentVersion>>(['api', 'agents', ':agentId', 'versions'], { param: { agentId: id } }),
  listEnvironments: (options: ListOptions = {}) =>
    rpcGet<ListResponse<Environment>>(['api', 'environments'], queryArgs(options)),
  readEnvironment: (id: string) =>
    rpcGet<Environment>(['api', 'environments', ':environmentId'], { param: { environmentId: id } }),
  createEnvironment: (input: EnvironmentInput) => rpcPost<Environment>(['api', 'environments'], { json: input }),
  updateEnvironment: (id: string, input: Partial<EnvironmentInput>) =>
    rpcPatch<Environment>(['api', 'environments', ':environmentId'], { param: { environmentId: id }, json: input }),
  archiveEnvironment: (id: string) =>
    rpcDelete<void>(['api', 'environments', ':environmentId'], { param: { environmentId: id } }),
  listEnvironmentVersions: (id: string) =>
    rpcGet<ListResponse<EnvironmentVersion>>(['api', 'environments', ':environmentId', 'versions'], {
      param: { environmentId: id },
    }),
  listSessions: (options: ListOptions = {}) => rpcGet<ListResponse<Session>>(['api', 'sessions'], queryArgs(options)),
  createSession: (input: SessionInput) => rpcPost<Session>(['api', 'sessions'], { json: input }),
  readSession: (id: string) => rpcGet<Session>(['api', 'sessions', ':sessionId'], { param: { sessionId: id } }),
  reconnectSession: (id: string) =>
    rpcGet<Session>(['api', 'sessions', ':sessionId', 'reconnect'], { param: { sessionId: id } }),
  stopSession: (id: string) =>
    rpcPost<Session>(['api', 'sessions', ':sessionId', 'stop'], { param: { sessionId: id } }),
  archiveSession: (id: string) => rpcDelete<void>(['api', 'sessions', ':sessionId'], { param: { sessionId: id } }),
  listSessionEvents: (id: string, options: SessionEventListOptions = {}) =>
    rpcGet<ListResponse<SessionEvent>>(['api', 'sessions', ':sessionId', 'events'], {
      param: { sessionId: id },
      ...(queryArgs(options) ?? {}),
    }),
  listProviders: (options: ListOptions = {}) =>
    rpcGet<ListResponse<Provider>>(['api', 'providers'], queryArgs(options)),
  readProvider: (id: string) => rpcGet<Provider>(['api', 'providers', ':providerId'], { param: { providerId: id } }),
  createProvider: (input: ProviderInput) => rpcPost<Provider>(['api', 'providers'], { json: input }),
  archiveProvider: (id: string) => rpcDelete<void>(['api', 'providers', ':providerId'], { param: { providerId: id } }),
  listProviderModels: (id: string) =>
    rpcGet<ListResponse<ProviderModel>>(['api', 'providers', ':providerId', 'models'], { param: { providerId: id } }),
  listVaults: (options: ListOptions = {}) => rpcGet<ListResponse<Vault>>(['api', 'vaults'], queryArgs(options)),
  readVault: (id: string) => rpcGet<Vault>(['api', 'vaults', ':vaultId'], { param: { vaultId: id } }),
  createVault: (input: VaultInput) => rpcPost<Vault>(['api', 'vaults'], { json: input }),
  archiveVault: (id: string) => rpcDelete<void>(['api', 'vaults', ':vaultId'], { param: { vaultId: id } }),
  listVaultCredentials: (id: string, options: ListOptions = {}) =>
    rpcGet<ListResponse<VaultCredential>>(['api', 'vaults', ':vaultId', 'credentials'], {
      param: { vaultId: id },
      ...(queryArgs(options) ?? {}),
    }),
  listMcpConnectors: () => rpcGet<ListResponse<McpConnector>>(['api', 'mcp', 'connectors']),
  listMcpConnections: () => rpcGet<ListResponse<McpConnection>>(['api', 'mcp', 'connections']),
  disconnectMcpConnection: (id: string) =>
    rpcDelete<void>(['api', 'mcp', 'connections', ':connectionId'], {
      param: { connectionId: id },
      query: { confirm: 'true' },
    }),
  readGovernancePolicy: () => rpcGet<GovernancePolicy>(['api', 'governance', 'policy']),
  updateGovernancePolicy: (input: Partial<GovernancePolicy>) =>
    rpcPut<GovernancePolicy>(['api', 'governance', 'policy'], { json: input }),
  readUsageSummary: () => rpcGet<UsageSummary>(['api', 'usage', 'summary']),
  listAuditRecords: () => rpcGet<ListResponse<AuditRecord>>(['api', 'audit-records']),
}
