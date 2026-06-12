import type { AmaSessionEventType } from '@shared/session-events'
import { hc } from 'hono/client'
import type { AppType } from '../../server/app'
import { getAccessToken } from './oidc'
import { getSelectedProjectId } from './project-selection'

export interface AuthContext {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
  organization: { id: string; name: string }
  project: { id: string; name: string }
  roles: string[]
  permissions: string[]
}

export interface Project {
  id: string
  organizationId: string
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

export interface SecretRef {
  name: string
  ref: string
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
  secretRefs: SecretRef[]
  hostingMode: EnvironmentHostingMode
  networkPolicy: EnvironmentNetworkPolicy
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
  resourceLimits: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  metadata: Record<string, unknown>
  status: 'active' | 'archived'
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
  provider: string
  model: string
  systemPrompt: string | null
  skills: string[]
  role: string | null
  capabilityTags: string[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  allowedTools: string[]
  tools: AgentToolAttachment[]
  mcpConnectors: string[]
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
  skills: string[]
  role: string | null
  capabilityTags: string[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  allowedTools: string[]
  tools: AgentToolAttachment[]
  mcpConnectors: string[]
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

export interface SessionRuntimeMetadata {
  hostingMode: EnvironmentHostingMode
  runtime: RuntimeName
  runtimeConfig: Record<string, unknown>
  provider: string
  model: string
  driver: string | null
  backend: string | null
  protocol: string | null
}

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
  resourceRefs: SessionResourceRef[]
  vaultRefs: Record<string, unknown>[]
  durableObjectName: string
  sandboxId: string | null
  runtimeEndpointPath: string | null
  runtimeMetadata: SessionRuntimeMetadata
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
  provider: 'ama-managed' | 'cloudflare-secrets' | 'external-vault'
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
  tools: Array<{
    name: string
    description: string | null
    approvalMode: string
    inputSchema?: Record<string, unknown>
  }>
  metadata: Record<string, unknown>
  status: 'available' | 'unavailable'
  policyStatus: 'allowed' | 'blocked' | 'approval_required'
  connectionStatus: string
  createdAt: string
  updatedAt: string
}

export interface McpConnectorListOptions {
  search?: string
  category?: string
  trustLevel?: string
  capability?: string
}

export interface McpConnectInput {
  connectorId: string
  endpointUrl?: string
  credentialId?: string
  credentialVersionId?: string
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

export interface ProviderAccessRule {
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

export interface ProviderAccessRuleInput {
  providerId?: string
  modelId?: string
  teamId?: string
  effect: 'allow' | 'deny'
  reason?: string
  metadata?: Record<string, unknown>
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

export type ProviderInputType = 'workers-ai' | 'anthropic' | 'openai' | 'openai-compatible' | 'ollama' | 'other'

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
  provider?: string
  model?: string
  systemPrompt?: string
  skills?: string[]
  role?: string | null
  capabilityTags?: string[]
  handoffPolicy?: Record<string, unknown>
  memoryPolicy?: Record<string, unknown>
  allowedTools?: string[]
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
  vaultRefs?: Record<string, unknown>[]
}

export interface ProviderInput {
  type: ProviderInputType
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
  resourceType?: string
  resourceId?: string
  action?: string
  limit?: number
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
  listProjects: () => rpcRequest<ListResponse<Project>>(rpc.api.projects.$get()),
  createProject: (input: { name: string }) => rpcRequest<Project>(rpc.api.projects.$post({ json: input })),
  listAgents: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Agent>>(rpc.api.agents.$get(queryArg<typeof rpc.api.agents.$get>(options))),
  readAgent: (id: string) => rpcRequest<Agent>(rpc.api.agents[':agentId'].$get({ param: { agentId: id } })),
  createAgent: (input: AgentInput) =>
    rpcRequest<Agent>(rpc.api.agents.$post(jsonArg<typeof rpc.api.agents.$post>(input))),
  updateAgent: (id: string, input: Partial<AgentInput>) =>
    rpcRequest<Agent>(
      rpc.api.agents[':agentId'].$patch({
        param: { agentId: id },
        json: input as RpcJson<(typeof rpc.api.agents)[':agentId']['$patch']>,
      }),
    ),
  archiveAgent: (id: string) => rpcRequest<void>(rpc.api.agents[':agentId'].$delete({ param: { agentId: id } })),
  listAgentVersions: (id: string) =>
    rpcRequest<ListResponse<AgentVersion>>(rpc.api.agents[':agentId'].versions.$get({ param: { agentId: id } })),
  listEnvironments: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Environment>>(
      rpc.api.environments.$get(queryArg<typeof rpc.api.environments.$get>(options)),
    ),
  readEnvironment: (id: string) =>
    rpcRequest<Environment>(rpc.api.environments[':environmentId'].$get({ param: { environmentId: id } })),
  createEnvironment: (input: EnvironmentInput) => rpcRequest<Environment>(rpc.api.environments.$post({ json: input })),
  updateEnvironment: (id: string, input: Partial<EnvironmentInput>) =>
    rpcRequest<Environment>(
      rpc.api.environments[':environmentId'].$patch({ param: { environmentId: id }, json: input }),
    ),
  archiveEnvironment: (id: string) =>
    rpcRequest<void>(rpc.api.environments[':environmentId'].$delete({ param: { environmentId: id } })),
  listEnvironmentVersions: (id: string) =>
    rpcRequest<ListResponse<EnvironmentVersion>>(
      rpc.api.environments[':environmentId'].versions.$get({
        param: { environmentId: id },
      }),
    ),
  listSessions: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Session>>(rpc.api.sessions.$get(queryArg<typeof rpc.api.sessions.$get>(options))),
  createSession: (input: SessionInput) => rpcRequest<Session>(rpc.api.sessions.$post({ json: input })),
  readSession: (id: string) => rpcRequest<Session>(rpc.api.sessions[':sessionId'].$get({ param: { sessionId: id } })),
  reconnectSession: (id: string) =>
    rpcRequest<Session>(rpc.api.sessions[':sessionId'].reconnect.$get({ param: { sessionId: id } })),
  stopSession: (id: string) =>
    rpcRequest<Session>(rpc.api.sessions[':sessionId'].stop.$post({ param: { sessionId: id }, query: {} })),
  archiveSession: (id: string) =>
    rpcRequest<void>(rpc.api.sessions[':sessionId'].$delete({ param: { sessionId: id } })),
  listSessionEvents: (id: string, options: SessionEventListOptions = {}) =>
    rpcRequest<ListResponse<SessionEvent>>(
      rpc.api.sessions[':sessionId'].events.$get(
        paramQueryArg<(typeof rpc.api.sessions)[':sessionId']['events']['$get']>({ sessionId: id }, options),
      ),
    ),
  listProviders: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Provider>>(rpc.api.providers.$get(queryArg<typeof rpc.api.providers.$get>(options))),
  readProvider: (id: string) =>
    rpcRequest<Provider>(rpc.api.providers[':providerId'].$get({ param: { providerId: id } })),
  createProvider: (input: ProviderInput) =>
    rpcRequest<Provider>(rpc.api.providers.$post(jsonArg<typeof rpc.api.providers.$post>(input))),
  archiveProvider: (id: string) =>
    rpcRequest<void>(rpc.api.providers[':providerId'].$delete({ param: { providerId: id } })),
  listProviderModels: (id: string) =>
    rpcRequest<ListResponse<ProviderModel>>(
      rpc.api.providers[':providerId'].models.$get({ param: { providerId: id } }),
    ),
  listVaults: (options: ListOptions = {}) =>
    rpcRequest<ListResponse<Vault>>(rpc.api.vaults.$get(queryArg<typeof rpc.api.vaults.$get>(options))),
  readVault: (id: string) => rpcRequest<Vault>(rpc.api.vaults[':vaultId'].$get({ param: { vaultId: id } })),
  createVault: (input: VaultInput) => rpcRequest<Vault>(rpc.api.vaults.$post({ json: input })),
  archiveVault: (id: string) => rpcRequest<void>(rpc.api.vaults[':vaultId'].$delete({ param: { vaultId: id } })),
  listVaultCredentials: (id: string, options: ListOptions = {}) =>
    rpcRequest<ListResponse<VaultCredential>>(
      rpc.api.vaults[':vaultId'].credentials.$get(
        paramQueryArg<(typeof rpc.api.vaults)[':vaultId']['credentials']['$get']>({ vaultId: id }, options),
      ),
    ),
  createVaultCredential: (vaultId: string, input: VaultCredentialInput) =>
    rpcRequest<VaultCredential>(
      rpc.api.vaults[':vaultId'].credentials.$post({
        param: { vaultId },
        json: input as RpcJson<(typeof rpc.api.vaults)[':vaultId']['credentials']['$post']>,
      }),
    ),
  rotateVaultCredential: (vaultId: string, credentialId: string, secret: VaultCredentialSecretInput) =>
    rpcRequest<VaultCredential>(
      rpc.api.vaults[':vaultId'].credentials[':credentialId'].versions.$post({
        param: { vaultId, credentialId },
        json: secret as RpcJson<
          (typeof rpc.api.vaults)[':vaultId']['credentials'][':credentialId']['versions']['$post']
        >,
      }),
    ),
  revokeVaultCredential: (vaultId: string, credentialId: string, revokeReason?: string) =>
    rpcRequest<VaultCredential>(
      rpc.api.vaults[':vaultId'].credentials[':credentialId'].$patch({
        param: { vaultId, credentialId },
        json: { status: 'revoked', ...(revokeReason ? { revokeReason } : {}) },
      }),
    ),
  listMcpConnectors: (options: McpConnectorListOptions = {}) =>
    rpcRequest<ListResponse<McpConnector>>(
      rpc.api.mcp.connectors.$get(queryArg<typeof rpc.api.mcp.connectors.$get>(options)),
    ),
  readMcpConnector: (connectorId: string) =>
    rpcRequest<McpConnector>(rpc.api.mcp.connectors[':connectorId'].$get({ param: { connectorId } })),
  connectMcpConnector: (input: McpConnectInput) =>
    rpcRequest<McpConnection>(rpc.api.mcp.connections.$post(jsonArg<typeof rpc.api.mcp.connections.$post>(input))),
  listMcpConnections: () => rpcRequest<ListResponse<McpConnection>>(rpc.api.mcp.connections.$get({ query: {} })),
  disconnectMcpConnection: (id: string) =>
    rpcRequest<void>(
      rpc.api.mcp.connections[':connectionId'].$delete({
        param: { connectionId: id },
        query: { confirm: 'true' },
      }),
    ),
  listProviderAccessRules: () =>
    rpcRequest<ListResponse<ProviderAccessRule>>(rpc.api.governance['provider-access-rules'].$get()),
  createProviderAccessRule: (input: ProviderAccessRuleInput) =>
    rpcRequest<ProviderAccessRule>(
      rpc.api.governance['provider-access-rules'].$post(
        jsonArg<(typeof rpc.api.governance)['provider-access-rules']['$post']>(input),
      ),
    ),
  readGovernancePolicy: () => rpcRequest<GovernancePolicy>(rpc.api.governance.policy.$get()),
  updateGovernancePolicy: (input: Partial<GovernancePolicy>) =>
    rpcRequest<GovernancePolicy>(
      rpc.api.governance.policy.$put({ json: input as RpcJson<typeof rpc.api.governance.policy.$put> }),
    ),
  readUsageSummary: () => rpcRequest<UsageSummary>(rpc.api.usage.summary.$get({ query: {} })),
  listAuditRecords: (options: AuditRecordListOptions = {}) =>
    rpcRequest<ListResponse<AuditRecord>>(
      rpc.api['audit-records'].$get(queryArg<(typeof rpc.api)['audit-records']['$get']>(options)),
    ),
}
