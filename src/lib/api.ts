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
  defaultEnvironmentId: string | null
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
  defaultEnvironmentId: string | null
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

export type SessionStatus = 'pending' | 'running' | 'idle' | 'stopped' | 'error' | 'archived'

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
  durableObjectName: string
  sandboxId: string | null
  piRuntimeId: string | null
  piProcessId: string | null
  runtimeEndpointPath: string
  agentUrl: string
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
  type: 'message' | 'tool' | 'sandbox' | 'policy' | 'usage' | 'error' | 'lifecycle'
  visibility: 'transcript' | 'debug' | 'audit'
  role: string | null
  parentEventId: string | null
  correlationId: string | null
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ListPagination {
  limit: number
  nextCursor: string | null
  hasMore: boolean
  firstId: string | null
  lastId: string | null
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
  afterSequence?: number
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
  defaultEnvironmentId?: string | null
  metadata?: Record<string, unknown>
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

function listOptions(options: ListOptions | boolean = {}) {
  return typeof options === 'boolean' ? { includeArchived: options } : options
}

export const api = {
  me: () => request<AuthContext>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  listAgents: (options: ListOptions | boolean = {}) =>
    request<ListResponse<Agent>>(`/api/agents${queryString(listOptions(options))}`),
  createAgent: (input: AgentInput) => request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(input) }),
  updateAgent: (id: string, input: Partial<AgentInput>) =>
    request<Agent>(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  archiveAgent: (id: string) => request<void>(`/api/agents/${id}`, { method: 'DELETE' }),
  listAgentVersions: (id: string) => request<ListResponse<AgentVersion>>(`/api/agents/${id}/versions`),
  startAgentSession: (id: string) => request<Session>(`/api/agents/${id}/sessions`, { method: 'POST' }),
  listEnvironments: (options: ListOptions | boolean = {}) =>
    request<ListResponse<Environment>>(`/api/environments${queryString(listOptions(options))}`),
  createEnvironment: (input: EnvironmentInput) =>
    request<Environment>('/api/environments', { method: 'POST', body: JSON.stringify(input) }),
  updateEnvironment: (id: string, input: Partial<EnvironmentInput>) =>
    request<Environment>(`/api/environments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  archiveEnvironment: (id: string) => request<void>(`/api/environments/${id}`, { method: 'DELETE' }),
  listEnvironmentVersions: (id: string) =>
    request<ListResponse<EnvironmentVersion>>(`/api/environments/${id}/versions`),
  listSessions: (options: ListOptions | boolean = {}) =>
    request<ListResponse<Session>>(`/api/sessions${queryString(listOptions(options))}`),
  createSession: (agentId: string) =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ agentId }) }),
  readSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  stopSession: (id: string) => request<Session>(`/api/sessions/${id}/stop`, { method: 'POST' }),
  archiveSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  listSessionEvents: (id: string, options: SessionEventListOptions = {}) =>
    request<ListResponse<SessionEvent>>(`/api/sessions/${id}/events${queryString(options)}`),
  sendRuntimeTask: (session: Session, message: string) =>
    request<{ accepted?: boolean }>(session.runtimeEndpointPath, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', message }),
    }),
  readRuntimeEvents: async (session: Session, timeoutMs = 60_000) => {
    const response = await fetch(session.runtimeEndpointPath, { credentials: 'include' })
    if (!response.ok || !response.body) {
      throw new ApiError(response.statusText, response.status, await response.text())
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let transcript = ''
    const startedAt = Date.now()
    try {
      while (Date.now() - startedAt < timeoutMs) {
        const result = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value?: undefined }>((resolve) => setTimeout(() => resolve({ done: true }), 5000)),
        ])
        if (result.done) {
          break
        }
        transcript += decoder.decode(result.value, { stream: true })
        if (transcript.includes('"type":"agent_end"') || transcript.includes('"type":"bridge_exit"')) {
          break
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
    return transcript
  },
}
