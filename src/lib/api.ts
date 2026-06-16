import type { AmaSessionEventType } from '@shared/session-events'
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
  credentialRefs: CredentialRef[]
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
  credentialRefs: CredentialRef[]
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export type SessionState = 'pending' | 'running' | 'idle' | 'stopped' | 'error'

export interface SecretEnvEntry {
  name: string
  credentialRef: CredentialRef
}

export interface SessionRuntimeMetadata {
  hostingMode: EnvironmentHostingMode
  runtime: RuntimeName
  runtimeConfig: Record<string, unknown>
  provider: string
  model: string | null
  driver: string | null
  backend: string | null
  protocol: string | null
}

export interface SessionAgentSnapshot {
  id: string
  agentId: string
  projectId: string
  version: number
  instructions: string | null
  providerId: string
  model: string | null
  skills: string[]
  subagents: Record<string, unknown>[]
  role: string | null
  capabilityTags: string[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  tools: Record<string, unknown>[]
  mcpConnectors: string[]
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SessionEnvironmentSnapshot {
  id: string
  environmentId: string
  projectId: string
  version: number
  packages: EnvironmentPackage[]
  variables: Record<string, EnvironmentVariable>
  credentialRefs: CredentialRef[]
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface Session {
  id: string
  projectId: string
  agentId: string
  agentVersionId: string
  agentSnapshot: SessionAgentSnapshot
  environmentId: string | null
  environmentVersionId: string | null
  environmentSnapshot: SessionEnvironmentSnapshot | null
  title: string | null
  resourceRefs: SessionResourceRef[]
  env: Record<string, unknown>
  secretEnv: SecretEnvEntry[]
  runtimeMetadata: SessionRuntimeMetadata
  state: SessionState
  stateReason: string | null
  metadata: Record<string, unknown>
  startedAt: string | null
  stoppedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionConnection {
  sessionId: string
  transport: string | null
  path: string | null
  state: SessionState
  stateReason: string | null
}

export interface SessionMessage {
  id: string
  sessionId: string
  type: 'prompt'
  content: string
  delivery: 'live' | 'queued'
  state: 'accepted' | 'delivered' | 'failed'
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionApproval {
  id: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  relatedEventIds: string[]
  state: 'pending' | 'approved' | 'denied'
  reason: string | null
  result: Record<string, unknown> | null
  requestedAt: string
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionApprovalDecisionInput {
  decision: 'approve' | 'deny'
  reason?: string
  result?: Record<string, unknown>
}

export interface SessionEvent {
  id: string
  projectId: string
  sessionId: string
  sequence: number
  type: AmaSessionEventType
  visibility: 'runtime' | 'transcript' | 'debug' | 'audit'
  role: string | null
  parentEventId: string | null
  correlationId: string | null
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export type GitHubRepositoryResourceRef = {
  type: 'github_repository'
  owner: string
  repo: string
  ref?: string
  mountPath?: string
  credentialRef?: string
}

export type SessionResourceRef = GitHubRepositoryResourceRef | Record<string, unknown>

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

export interface VaultCredentialVersion {
  id: string
  credentialId: string
  vaultId: string
  projectId: string | null
  version: number
  provider: 'ama-managed' | 'cloudflare-secrets' | 'external-vault'
  secretRef: string
  externalVaultPath: string | null
  referenceName: string
  state: 'active' | 'superseded' | 'revoked'
  hasSecret: boolean
  metadata: Record<string, unknown>
  createdAt: string
  supersededAt: string | null
  revokedAt: string | null
}

export interface VaultCredential {
  id: string
  vaultId: string
  projectId: string | null
  name: string
  type: string
  connectorBinding: Record<string, unknown>
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

export interface CreateConnectionInput {
  connectorId: string
  endpointUrl?: string
  credentialRef?: CredentialRef
  approvalMode?: ConnectorTool['approvalMode']
  metadata?: Record<string, unknown>
}

export interface Connection {
  id: string
  projectId: string
  connectorId: string
  credentialRef: CredentialRef | null
  endpointUrl: string | null
  approvalMode: 'none' | 'per_call' | 'always_required' | 'project_policy'
  state: 'connected' | 'disabled' | 'disconnected' | 'error'
  lastError: Record<string, unknown> | null
  metadata: Record<string, unknown>
  connectedAt: string
  disconnectedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PolicyScope {
  level: 'organization' | 'team' | 'project'
  teamId?: string
}

export interface Policy {
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

export interface PolicyDecision {
  allowed: boolean
  category: string
  rule: string | null
  message: string
}

export interface EffectiveRule {
  providerId?: string
  modelId?: string
  effect: 'allow' | 'deny'
  reason?: string
}

export interface EffectiveAccessRule {
  id: string
  providerId: string
  modelId: string
  teamId: string | null
  effect: string
  reason: string | null
}

export interface EffectiveBudget {
  id: string
  scope: string
  providerId: string | null
  modelId: string | null
  limitType: string
  limitValue: number
  window: string
  enabled: boolean
  metadata: Record<string, unknown>
}

export interface EffectivePolicy {
  source: Record<string, unknown>
  sources: Record<string, unknown>[]
  providerRules: EffectiveRule[]
  modelRules: EffectiveRule[]
  accessRules: EffectiveAccessRule[]
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  budgets: EffectiveBudget[]
  decision?: PolicyDecision
}

export interface AccessRule {
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

export interface AccessRuleInput {
  providerId?: string
  modelId?: string
  teamId?: string
  effect: 'allow' | 'deny'
  reason?: string
  metadata?: Record<string, unknown>
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

export interface FederatedTenant {
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
  credentialRefs?: CredentialRef[]
  hostingMode?: EnvironmentHostingMode
  networkPolicy?: EnvironmentNetworkPolicy
  mcpPolicy?: Record<string, unknown>
  packageManagerPolicy?: Record<string, unknown>
  resourceLimits?: Record<string, unknown>
  runtimeConfig?: Record<string, unknown>
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

export interface SessionInput {
  agentId: string
  environmentId: string
  runtime: RuntimeName
  runtimeConfig?: Record<string, unknown>
  title?: string
  initialPrompt?: string
  metadata?: Record<string, unknown>
  resourceRefs?: SessionResourceRef[]
  env?: Record<string, string>
  secretEnv?: SecretEnvEntry[]
}

export interface VaultInput {
  name: string
  description?: string
  scope?: 'project' | 'organization'
}

export interface VaultCredentialSecretInput {
  provider?: 'ama-managed' | 'cloudflare-secrets' | 'external-vault'
  secretValue?: string
  externalVaultPath?: string
  referenceName?: string
  metadata?: Record<string, unknown>
}

export interface VaultCredentialInput {
  name: string
  type: string
  connectorBinding?: { connectorId?: string; name?: string }
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

export interface EffectivePolicyOptions {
  teamId?: string
  providerId?: string
  modelId?: string
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
  listSessions: (options: SessionListOptions = {}) =>
    rpcRequest<ListResponse<Session>>(v1.sessions.$get(queryArg<typeof v1.sessions.$get>(options))),
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
    rpcRequest<ListResponse<SessionEvent>>(
      v1.sessions[':sessionId'].events.$get(
        paramQueryArg<(typeof v1.sessions)[':sessionId']['events']['$get']>({ sessionId: id }, options),
      ),
    ),
  listSessionApprovals: (id: string) =>
    rpcRequest<ListResponse<SessionApproval>>(v1.sessions[':sessionId'].approvals.$get({ param: { sessionId: id } })),
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
  listConnectors: (options: ConnectorListOptions = {}) =>
    rpcRequest<ListResponse<Connector>>(v1.connectors.$get(queryArg<typeof v1.connectors.$get>(options))),
  readConnector: (connectorId: string) =>
    rpcRequest<Connector>(v1.connectors[':connectorId'].$get({ param: { connectorId } })),
  createConnection: (input: CreateConnectionInput) =>
    rpcRequest<Connection>(v1.connections.$post(jsonArg<typeof v1.connections.$post>(input))),
  listConnections: () => rpcRequest<ListResponse<Connection>>(v1.connections.$get({ query: {} })),
  disconnectConnection: (id: string) =>
    rpcRequest<Connection>(
      v1.connections[':connectionId'].$patch({
        param: { connectionId: id },
        json: { state: 'disconnected' },
      }),
    ),
  listAccessRules: () =>
    rpcRequest<ListResponse<AccessRule>>(v1['access-rules'].$get(queryArg<(typeof v1)['access-rules']['$get']>({}))),
  createAccessRule: (input: AccessRuleInput) =>
    rpcRequest<AccessRule>(v1['access-rules'].$post(jsonArg<(typeof v1)['access-rules']['$post']>(input))),
  listPolicies: () => rpcRequest<ListResponse<Policy>>(v1.policies.$get(queryArg<typeof v1.policies.$get>({}))),
  readEffectivePolicy: (options: EffectivePolicyOptions = {}) =>
    rpcRequest<EffectivePolicy>(
      v1['effective-policy'].$get(queryArg<(typeof v1)['effective-policy']['$get']>(options)),
    ),
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
  listFederatedTenants: () =>
    rpcRequest<ListResponse<FederatedTenant>>(
      v1.auth['federated-tenants'].$get(queryArg<(typeof v1.auth)['federated-tenants']['$get']>({})),
    ),
}
