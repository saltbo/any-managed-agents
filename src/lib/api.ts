import type { InferRequestType, InferResponseType } from 'hono/client'
import { hc } from 'hono/client'
import type { AppType } from '../../server/app'
import { getAccessToken } from './oidc'
import { getSelectedProjectId } from './project-selection'

export interface AuthUser {
  id: string
  email: string
  name: string | null
}

export interface AuthOrganization {
  id: string
  name: string
}

export interface AuthProject {
  id: string
  name: string
}

export interface AuthSession {
  user: AuthUser
  organization: AuthOrganization
  project: AuthProject
}

export interface AuthContext {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
  organization: { id: string; name: string }
  project: { id: string; name: string }
  roles: string[]
  permissions: string[]
}

export interface AuthMethod {
  type: 'oidc'
  issuer: string
  clientId: string
}

export interface AuthConfig {
  methods: AuthMethod[]
}

export interface PublicConfig {
  auth: {
    oidc: {
      issuer: string
      clientId: string
      scope: string
    } | null
  }
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface EnvironmentPackage {
  name: string
  version?: string
}

export interface EnvironmentVariable {
  description?: string
  required?: boolean
}

export interface CredentialRef {
  credentialId: string
  versionId?: string
}

export type EnvironmentHostingMode = 'cloud' | 'self_hosted'
export type RuntimeName = 'ama' | 'claude-code' | 'codex' | 'copilot'
export type EnvironmentNetworkPolicy =
  | { mode: 'unrestricted' }
  | { mode: 'restricted'; allowedHosts: string[] }
  | { mode: 'offline' }

export interface Environment {
  id: string
  projectId: string
  name: string
  description: string | null
  packages: EnvironmentPackage[]
  variables: Record<string, EnvironmentVariable>
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  metadata: Record<string, unknown>
  archivedAt: string | null
  currentVersionId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface TriggerSchedule {
  type: 'interval'
  intervalSeconds: number
  windowSeconds: number
}

export interface Trigger {
  id: string
  projectId: string
  type: 'scheduled' | 'http'
  agentId: string
  environmentId: string | null
  runtime: RuntimeName
  name: string
  promptTemplate: string
  env: Record<string, string>
  envFrom: EnvFromEntry[]
  volumes: Volume[]
  volumeMounts: VolumeMount[]
  schedule: TriggerSchedule | null
  enabled: boolean
  nextDueAt: string | null
  lastDispatchedAt: string | null
  lastRunId: string | null
  metadata: Record<string, unknown>
  createdByUserId: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TriggerRun {
  id: string
  projectId: string
  triggerId: string
  scheduledFor: string | null
  heartbeatAt: string | null
  triggeredAt: string
  state: 'claimed' | 'session_created' | 'failed'
  idempotencyKey: string
  sessionId: string | null
  correlationId: string
  errorMessage: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AgentToolAttachment {
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
  approvalMode: 'none' | 'per_call' | 'always_required' | 'project_policy'
  policyMetadata: Record<string, unknown>
}

export interface AgentToolAttachmentInput {
  name: string
  description?: string | null
  inputSchema?: Record<string, unknown>
  approvalMode?: AgentToolAttachment['approvalMode']
  policyMetadata?: Record<string, unknown>
}

export interface Agent {
  id: string
  projectId: string
  name: string
  description: string | null
  instructions: string | null
  providerId: string | null
  model: string | null
  skills: string[]
  subagents: Record<string, unknown>[]
  role: string | null
  capabilityTags: string[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  tools: AgentToolAttachment[]
  mcpConnectors: string[]
  metadata: Record<string, unknown>
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
  providerId: string | null
  model: string | null
  skills: string[]
  subagents: Record<string, unknown>[]
  role: string | null
  capabilityTags: string[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  tools: AgentToolAttachment[]
  mcpConnectors: string[]
  metadata: Record<string, unknown>
  createdAt: string
}

export interface AgentMemory {
  agentId: string
  projectId: string
  content: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface EnvironmentVersion {
  id: string
  environmentId: string
  projectId: string
  version: number
  packages: EnvironmentPackage[]
  variables: Record<string, EnvironmentVariable>
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

// A provider is now a global model vendor (anthropic, openai, …); the catalog is
// shared across all projects and refreshed by the scheduled discovery job.
export interface Provider {
  id: string
  slug: string
  displayName: string
  enabled: boolean
  metadata: Record<string, unknown>
  modelCatalogState: string
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

export interface CatalogRefreshResult {
  outcome: 'succeeded' | 'failed'
  discoveredCount: number
  vendors: number
  category?: string
}

export interface Vault {
  id: string
  projectId: string | null
  name: string
  description: string | null
  scope: 'project' | 'organization'
  metadata: Record<string, unknown>
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryStore {
  id: string
  projectId: string
  name: string
  description: string | null
  metadata: Record<string, unknown>
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryStoreMemory {
  id: string
  storeId: string
  projectId: string
  path: string
  content: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface VaultCredentialVersion {
  id: string
  credentialId: string
  vaultId: string
  projectId: string | null
  version: number
  provider: 'ama'
  secretRef: string
  referenceName: string
  state: 'active' | 'superseded' | 'revoked'
  hasSecret: boolean
  dataKeys: string[]
  metadata: Record<string, unknown>
  createdAt: string
  supersededAt: string | null
  revokedAt: string | null
}

export type CredentialType =
  | 'opaque'
  | 'ama.dev/basic-auth'
  | 'ama.dev/ssh-auth'
  | 'ama.dev/tls'
  | 'ama.dev/private-key-jwk'
  | 'ama.dev/oauth-token'

export interface VaultCredential {
  id: string
  vaultId: string
  projectId: string | null
  name: string
  type: CredentialType
  metadata: Record<string, unknown>
  state: 'active' | 'revoked'
  activeVersionId: string | null
  activeVersion: VaultCredentialVersion | null
  revokedAt: string | null
  revokedByUserId: string | null
  revokeReason: string | null
  createdAt: string
  updatedAt: string
}

export interface ConnectorTool {
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
  approvalMode: 'none' | 'per_call' | 'always_required' | 'project_policy'
  policyMetadata: Record<string, unknown>
}

export interface Connector {
  id: string
  name: string
  description: string
  category: string
  trustLevel: string
  capabilities: string[]
  supportedAuthModes: string[]
  setupRequirements: string[]
  tools: ConnectorTool[]
  metadata: Record<string, unknown>
  availability: 'available' | 'unavailable'
  createdAt: string
  updatedAt: string
}

export interface ConnectorListOptions {
  search?: string
  category?: string
  trustLevel?: string
  capability?: string
}

export interface Budget {
  id: string
  scope: 'project' | 'provider' | 'model'
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

export interface UsageSummaryTotals {
  records: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
}

export interface UsageSummaryGroup extends UsageSummaryTotals {
  key: Record<string, string | null>
}

export interface UsageSummary {
  groupBy: 'provider' | 'model' | 'agent'
  totals: UsageSummaryTotals
  groups: UsageSummaryGroup[]
}

export interface UsageRecord {
  id: string
  projectId: string
  agentId: string | null
  agentVersionId: string | null
  sessionId: string | null
  sessionEventId: string | null
  correlationId: string | null
  providerId: string | null
  providerType: string
  modelId: string
  state: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
  usageType: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface AuditRecord {
  id: string
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
}

export interface ListResponse<T> {
  data: T[]
  pagination: ListPagination
}

export interface ListOptions {
  archived?: boolean
  search?: string
  createdFrom?: string
  createdTo?: string
  limit?: number
  cursor?: string
}

export interface SessionListOptions extends ListOptions {
  state?: string
  labelSelector?: string
}

export interface TriggerListOptions extends ListOptions {
  enabled?: boolean
}

export interface VaultCredentialListOptions {
  search?: string
  state?: string
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
  hostingMode?: EnvironmentHostingMode
  networkPolicy?: EnvironmentNetworkPolicy
  mcpPolicy?: Record<string, unknown>
  packageManagerPolicy?: Record<string, unknown>
  resourceLimits?: Record<string, unknown>
  runtimeConfig?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface TriggerInput {
  type?: Trigger['type']
  agentId?: string
  environmentId?: string
  runtime?: RuntimeName
  name?: string
  promptTemplate?: string
  env?: Record<string, string>
  envFrom?: EnvFromEntry[]
  volumes?: Volume[]
  volumeMounts?: VolumeMount[]
  schedule?: Partial<Omit<TriggerSchedule, 'type'>> | null
  nextDueAt?: string
  metadata?: Record<string, unknown>
}

export interface CreateTriggerInput {
  type?: Trigger['type']
  agentId: string
  environmentId?: string
  runtime: RuntimeName
  name: string
  promptTemplate: string
  schedule?: { type: 'interval'; intervalSeconds: number } | null
  enabled?: boolean
  env?: Record<string, string>
  envFrom?: EnvFromEntry[]
  volumes?: Volume[]
  volumeMounts?: VolumeMount[]
  nextDueAt?: string
  metadata?: Record<string, unknown>
}

export interface AgentInput {
  name: string
  description?: string
  instructions?: string
  providerId?: string
  model?: string | null
  skills?: string[]
  subagents?: Record<string, unknown>[]
  role?: string | null
  capabilityTags?: string[]
  handoffPolicy?: Record<string, unknown>
  memoryPolicy?: Record<string, unknown>
  tools?: AgentToolAttachmentInput[]
  mcpConnectors?: string[]
  metadata?: Record<string, unknown>
}

export interface VaultInput {
  name: string
  description?: string
  scope?: 'project' | 'organization'
}

export interface MemoryStoreInput {
  name: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface MemoryStoreMemoryInput {
  path: string
  content: string
  metadata?: Record<string, unknown>
}

export interface VaultCredentialSecretInput {
  stringData: Record<string, string>
  referenceName?: string
  metadata?: Record<string, unknown>
}

export interface VaultCredentialInput {
  name: string
  type: CredentialType
  metadata?: Record<string, unknown>
  secret: VaultCredentialSecretInput
}

export interface AuditRecordListOptions {
  actorId?: string
  projectId?: string
  resourceType?: string
  resourceId?: string
  action?: string
  outcome?: string
  from?: string
  to?: string
  limit?: number
  cursor?: string
}

export interface UsageSummaryOptions {
  groupBy?: string
  from?: string
  to?: string
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

const rpc = hc<AppType>('/', {
  init: { credentials: 'include' },
  headers: async () => {
    const token = await getAccessToken()
    const projectId = getSelectedProjectId()
    return {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(projectId ? { 'x-ama-project-id': projectId } : {}),
      'x-ama-client': 'web-rpc',
    }
  },
})

const v1 = rpc.api.v1

type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never
type JsonListResponse<T> = Extract<T, { data: unknown[] }>
type SessionsRpc = typeof v1.sessions
type SessionRpc = SessionsRpc[':sessionId']

export type SessionListResponse = InferResponseType<SessionsRpc['$get'], 200>
export type Session = InferResponseType<SessionRpc['$get'], 200>
export type SessionConnection = InferResponseType<SessionRpc['connection']['$get'], 200>
export type SessionMessage = InferResponseType<SessionRpc['messages']['$post'], 201>
export type SessionEventListResponse = JsonListResponse<InferResponseType<SessionRpc['events']['$get'], 200>>
export type SessionEvent = ArrayItem<SessionEventListResponse['data']>
export type SessionApprovalListResponse = InferResponseType<SessionRpc['approvals']['$get'], 200>
export type SessionApproval = ArrayItem<SessionApprovalListResponse['data']>
export type SessionInput = InferRequestType<SessionsRpc['$post']>['json']
export type SessionApprovalDecisionInput = InferRequestType<SessionRpc['approvals'][':approvalId']['$patch']>['json']
export type SessionState = Session['status']['phase']
export type SessionPlacement = NonNullable<Session['status']['placement']>
export type SessionAgentSnapshot = Session['status']['bindings']['agent']['snapshot']
export type SessionEnvironmentSnapshot = NonNullable<Session['status']['bindings']['environment']['snapshot']>
export type EnvFromEntry = ArrayItem<Session['spec']['envFrom']>
export type Volume = ArrayItem<Session['spec']['volumes']>
export type VolumeMount = ArrayItem<Session['spec']['volumeMounts']>
export type GitRepositoryVolume = Extract<Volume, { type: 'git_repository' }>
export type MemoryStoreVolume = Extract<Volume, { type: 'memory' }>
export type MemoryStoreAccess = MemoryStoreVolume['access']

type RpcResponse = Pick<Response, 'headers' | 'json' | 'ok' | 'status' | 'statusText' | 'text'>
type RpcArg<T> = T extends (args: infer A, ...rest: never[]) => unknown ? A : never
type RpcJson<T> = RpcArg<T> extends { json: infer J } ? J : never
type RpcQuery<T> = RpcArg<T> extends { query: infer Q } ? Q : never

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

function queryArg<T>(options: object = {}) {
  return { query: queryOptions(options) as RpcQuery<T> } as RpcArg<T>
}

function paramQueryArg<T>(param: RpcArg<T> extends { param: infer P } ? P : never, options: object = {}) {
  return { param, query: queryOptions(options) as RpcQuery<T> } as RpcArg<T>
}

function jsonArg<T>(json: RpcJson<T>) {
  return { json } as RpcArg<T>
}

export const api = {
  readConfigz: () => rpcRequest<PublicConfig>(v1.configz.$get()),
  readAuthConfig: (organization?: string) =>
    rpcRequest<AuthConfig>(v1.auth.config.$get({ query: organization ? { organization } : {} })),
  readCurrentSession: () => rpcRequest<AuthSession>(v1.auth.sessions.current.$get()),
  deleteCurrentSession: () => rpcRequest<void>(v1.auth.sessions.current.$delete()),
  listProjects: () => rpcRequest<ListResponse<Project>>(v1.projects.$get({ query: {} })),
  createProject: (input: { name: string }) => rpcRequest<Project>(v1.projects.$post({ json: input })),
  listAgents: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Agent>>(v1.agents.$get(queryArg<typeof v1.agents.$get>(options))),
  readAgent: (id: string) => rpcRequest<Agent>(v1.agents[':agentId'].$get({ param: { agentId: id } })),
  createAgent: (input: AgentInput) => rpcRequest<Agent>(v1.agents.$post(jsonArg<typeof v1.agents.$post>(input))),
  updateAgent: (id: string, input: Partial<AgentInput> & { archived?: boolean }) =>
    rpcRequest<Agent>(
      v1.agents[':agentId'].$patch({
        param: { agentId: id },
        json: input as RpcJson<(typeof v1.agents)[':agentId']['$patch']>,
      }),
    ),
  archiveAgent: (id: string) =>
    rpcRequest<Agent>(v1.agents[':agentId'].$patch({ param: { agentId: id }, json: { archived: true } })),
  listAgentVersions: (id: string) =>
    rpcRequest<ListResponse<AgentVersion>>(v1.agents[':agentId'].versions.$get({ param: { agentId: id } })),
  readAgentMemory: (id: string) =>
    rpcRequest<AgentMemory>(v1.agents[':agentId'].memory.$get({ param: { agentId: id } })),
  replaceAgentMemory: (id: string, input: { content: string; metadata?: Record<string, unknown> }) =>
    rpcRequest<AgentMemory>(v1.agents[':agentId'].memory.$put({ param: { agentId: id }, json: input })),
  listEnvironments: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Environment>>(v1.environments.$get(queryArg<typeof v1.environments.$get>(options))),
  readEnvironment: (id: string) =>
    rpcRequest<Environment>(v1.environments[':environmentId'].$get({ param: { environmentId: id } })),
  createEnvironment: (input: EnvironmentInput) => rpcRequest<Environment>(v1.environments.$post({ json: input })),
  updateEnvironment: (id: string, input: Partial<EnvironmentInput> & { archived?: boolean }) =>
    rpcRequest<Environment>(
      v1.environments[':environmentId'].$patch({
        param: { environmentId: id },
        json: input as RpcJson<(typeof v1.environments)[':environmentId']['$patch']>,
      }),
    ),
  archiveEnvironment: (id: string) =>
    rpcRequest<Environment>(
      v1.environments[':environmentId'].$patch({ param: { environmentId: id }, json: { archived: true } }),
    ),
  listEnvironmentVersions: (id: string) =>
    rpcRequest<ListResponse<EnvironmentVersion>>(
      v1.environments[':environmentId'].versions.$get({ param: { environmentId: id } }),
    ),
  listTriggers: (options: TriggerListOptions = {}) =>
    rpcRequest<ListResponse<Trigger>>(v1.triggers.$get(queryArg<typeof v1.triggers.$get>(options))),
  createTrigger: (input: CreateTriggerInput) =>
    rpcRequest<Trigger>(v1.triggers.$post(jsonArg<typeof v1.triggers.$post>(input))),
  readTrigger: (id: string) => rpcRequest<Trigger>(v1.triggers[':triggerId'].$get({ param: { triggerId: id } })),
  updateTrigger: (id: string, input: Partial<TriggerInput> & { enabled?: boolean; archived?: boolean }) =>
    rpcRequest<Trigger>(
      v1.triggers[':triggerId'].$patch({
        param: { triggerId: id },
        json: input as RpcJson<(typeof v1.triggers)[':triggerId']['$patch']>,
      }),
    ),
  deleteTrigger: (id: string) => rpcRequest<void>(v1.triggers[':triggerId'].$delete({ param: { triggerId: id } })),
  listTriggerRuns: (id: string, options: ListOptions = {}) =>
    rpcRequest<ListResponse<TriggerRun>>(
      v1.triggers[':triggerId'].runs.$get(
        paramQueryArg<(typeof v1.triggers)[':triggerId']['runs']['$get']>({ triggerId: id }, options),
      ),
    ),
  listSessions: (options: SessionListOptions = {}) =>
    rpcRequest<SessionListResponse>(v1.sessions.$get(queryArg<typeof v1.sessions.$get>(options))),
  createSession: (input: SessionInput) =>
    rpcRequest<Session>(v1.sessions.$post(jsonArg<typeof v1.sessions.$post>(input))),
  readSession: (id: string) => rpcRequest<Session>(v1.sessions[':sessionId'].$get({ param: { sessionId: id } })),
  readSessionConnection: (id: string) =>
    rpcRequest<SessionConnection>(v1.sessions[':sessionId'].connection.$get({ param: { sessionId: id } })),
  stopSession: (id: string) =>
    rpcRequest<Session>(v1.sessions[':sessionId'].$patch({ param: { sessionId: id }, json: { state: 'stopped' } })),
  archiveSession: (id: string) =>
    rpcRequest<Session>(v1.sessions[':sessionId'].$patch({ param: { sessionId: id }, json: { archived: true } })),
  sendSessionMessage: (id: string, content: string) =>
    rpcRequest<SessionMessage>(
      v1.sessions[':sessionId'].messages.$post({ param: { sessionId: id }, json: { type: 'prompt', content } }),
    ),
  listSessionEvents: (id: string, options: SessionEventListOptions = {}) =>
    rpcRequest<SessionEventListResponse>(
      v1.sessions[':sessionId'].events.$get(
        paramQueryArg<(typeof v1.sessions)[':sessionId']['events']['$get']>({ sessionId: id }, options),
      ),
    ),
  listSessionApprovals: (id: string) =>
    rpcRequest<SessionApprovalListResponse>(v1.sessions[':sessionId'].approvals.$get({ param: { sessionId: id } })),
  decideSessionApproval: (id: string, approvalId: string, input: SessionApprovalDecisionInput) =>
    rpcRequest<SessionApproval>(
      v1.sessions[':sessionId'].approvals[':approvalId'].$patch({
        param: { sessionId: id, approvalId },
        json: input,
      }),
    ),
  listProviders: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Provider>>(v1.providers.$get(queryArg<typeof v1.providers.$get>(options))),
  listModels: () => rpcRequest<ListResponse<ProviderModel>>(v1.providers.models.$get()),
  readProvider: (id: string) => rpcRequest<Provider>(v1.providers[':providerId'].$get({ param: { providerId: id } })),
  listProviderModels: (id: string) =>
    rpcRequest<ListResponse<ProviderModel>>(v1.providers[':providerId'].models.$get({ param: { providerId: id } })),
  refreshCatalog: () => rpcRequest<CatalogRefreshResult>(v1.providers.refresh.$post()),
  listVaults: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Vault>>(v1.vaults.$get(queryArg<typeof v1.vaults.$get>(options))),
  readVault: (id: string) => rpcRequest<Vault>(v1.vaults[':vaultId'].$get({ param: { vaultId: id } })),
  createVault: (input: VaultInput) => rpcRequest<Vault>(v1.vaults.$post({ json: input })),
  archiveVault: (id: string) =>
    rpcRequest<Vault>(v1.vaults[':vaultId'].$patch({ param: { vaultId: id }, json: { archived: true } })),
  listVaultCredentials: (id: string, options: VaultCredentialListOptions = {}) =>
    rpcRequest<ListResponse<VaultCredential>>(
      v1.vaults[':vaultId'].credentials.$get(
        paramQueryArg<(typeof v1.vaults)[':vaultId']['credentials']['$get']>({ vaultId: id }, options),
      ),
    ),
  createVaultCredential: (vaultId: string, input: VaultCredentialInput) =>
    rpcRequest<VaultCredential>(
      v1.vaults[':vaultId'].credentials.$post({
        param: { vaultId },
        json: input as RpcJson<(typeof v1.vaults)[':vaultId']['credentials']['$post']>,
      }),
    ),
  rotateVaultCredential: (vaultId: string, credentialId: string, secret: VaultCredentialSecretInput) =>
    rpcRequest<VaultCredentialVersion>(
      v1.vaults[':vaultId'].credentials[':credentialId'].versions.$post({
        param: { vaultId, credentialId },
        json: secret as RpcJson<(typeof v1.vaults)[':vaultId']['credentials'][':credentialId']['versions']['$post']>,
      }),
    ),
  revokeVaultCredential: (vaultId: string, credentialId: string, revokeReason?: string) =>
    rpcRequest<VaultCredential>(
      v1.vaults[':vaultId'].credentials[':credentialId'].$patch({
        param: { vaultId, credentialId },
        json: { state: 'revoked', ...(revokeReason ? { revokeReason } : {}) },
      }),
    ),
  listMemoryStores: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<MemoryStore>>(
      v1['memory-stores'].$get(queryArg<(typeof v1)['memory-stores']['$get']>(options)),
    ),
  readMemoryStore: (id: string) =>
    rpcRequest<MemoryStore>(v1['memory-stores'][':storeId'].$get({ param: { storeId: id } })),
  createMemoryStore: (input: MemoryStoreInput) => rpcRequest<MemoryStore>(v1['memory-stores'].$post({ json: input })),
  updateMemoryStore: (id: string, input: Partial<MemoryStoreInput> & { archived?: boolean }) =>
    rpcRequest<MemoryStore>(
      v1['memory-stores'][':storeId'].$patch({
        param: { storeId: id },
        json: input as RpcJson<(typeof v1)['memory-stores'][':storeId']['$patch']>,
      }),
    ),
  archiveMemoryStore: (id: string) =>
    rpcRequest<MemoryStore>(
      v1['memory-stores'][':storeId'].$patch({ param: { storeId: id }, json: { archived: true } }),
    ),
  listMemoryStoreMemories: (storeId: string, options: ListOptions = {}) =>
    rpcRequest<ListResponse<MemoryStoreMemory>>(
      v1['memory-stores'][':storeId'].memories.$get(
        paramQueryArg<(typeof v1)['memory-stores'][':storeId']['memories']['$get']>({ storeId }, options),
      ),
    ),
  createMemoryStoreMemory: (storeId: string, input: MemoryStoreMemoryInput) =>
    rpcRequest<MemoryStoreMemory>(
      v1['memory-stores'][':storeId'].memories.$post({
        param: { storeId },
        json: input as RpcJson<(typeof v1)['memory-stores'][':storeId']['memories']['$post']>,
      }),
    ),
  updateMemoryStoreMemory: (storeId: string, memoryId: string, input: Partial<MemoryStoreMemoryInput>) =>
    rpcRequest<MemoryStoreMemory>(
      v1['memory-stores'][':storeId'].memories[':memoryId'].$patch({
        param: { storeId, memoryId },
        json: input as RpcJson<(typeof v1)['memory-stores'][':storeId']['memories'][':memoryId']['$patch']>,
      }),
    ),
  deleteMemoryStoreMemory: (storeId: string, memoryId: string) =>
    rpcRequest<void>(v1['memory-stores'][':storeId'].memories[':memoryId'].$delete({ param: { storeId, memoryId } })),
  listConnectors: (options: ConnectorListOptions = {}) =>
    rpcRequest<ListResponse<Connector>>(v1.connectors.$get(queryArg<typeof v1.connectors.$get>(options))),
  readConnector: (connectorId: string) =>
    rpcRequest<Connector>(v1.connectors[':connectorId'].$get({ param: { connectorId } })),
  listBudgets: () => rpcRequest<ListResponse<Budget>>(v1.budgets.$get(queryArg<typeof v1.budgets.$get>({}))),
  readUsageSummary: (options: UsageSummaryOptions = {}) =>
    rpcRequest<UsageSummary>(v1['usage-summary'].$get(queryArg<(typeof v1)['usage-summary']['$get']>(options))),
  listUsageRecords: (options: Record<string, unknown> = {}) =>
    rpcRequest<ListResponse<UsageRecord>>(
      v1['usage-records'].$get(queryArg<(typeof v1)['usage-records']['$get']>(options)),
    ),
  listAuditRecords: (options: AuditRecordListOptions = {}) =>
    rpcRequest<ListResponse<AuditRecord>>(
      v1['audit-records'].$get(queryArg<(typeof v1)['audit-records']['$get']>(options)),
    ),
  readAuditRecord: (id: string) =>
    rpcRequest<AuditRecord>(v1['audit-records'][':recordId'].$get({ param: { recordId: id } })),
}
