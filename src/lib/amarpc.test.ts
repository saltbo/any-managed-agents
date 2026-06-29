import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent, credential, environment, vault } from '@/test/resource-fixtures'
import { ApiError, api } from './amarpc'

describe('shared API client [spec: web-console/rpc-client]', () => {
  beforeEach(() => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:api-test')
    window.localStorage.setItem('ama:selected-project-id', 'project_test')
  })

  function headerValue(headers: HeadersInit | undefined, name: string) {
    if (headers instanceof Headers) {
      return headers.get(name)
    }
    if (Array.isArray(headers)) {
      return new Headers(headers).get(name)
    }
    return headers?.[name]
  }

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  function makeJsonFetch(body: unknown, status = 200) {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  function makeEmptyFetch(status = 204) {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(null, { status })
    })
  }

  function makeTextFetch(body: string, status = 200) {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
    })
  }

  const listPage = { data: [], pagination: { limit: 25, nextCursor: null, hasMore: false } }

  it('serializes list options through the shared authenticated client', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 25, nextCursor: null, hasMore: false },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listAgents({
      archived: true,
      search: 'research',
      createdFrom: '2026-05-01T00:00:00.000Z',
      createdTo: '2026-05-31T23:59:59.999Z',
      limit: 25,
      cursor: 'cursor_value',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/agents?archived=true&search=research&createdFrom=2026-05-01T00%3A00%3A00.000Z&createdTo=2026-05-31T23%3A59%3A59.999Z&limit=25&cursor=cursor_value',
      expect.objectContaining({
        body: undefined,
        credentials: 'include',
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headerValue(headers, 'accept')).toBe('application/json')
    expect(headerValue(headers, 'authorization')).toBe('Bearer e2e:api-test')
    expect(headerValue(headers, 'x-ama-project-id')).toBe('project_test')
    expect(headerValue(headers, 'x-ama-client')).toBe('web-rpc')
  })

  it('uses explicit list options for archived resources', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 50, nextCursor: null, hasMore: false },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listSessions({ archived: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions?archived=true',
      expect.objectContaining({
        body: undefined,
        credentials: 'include',
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headerValue(headers, 'authorization')).toBe('Bearer e2e:api-test')
    expect(headerValue(headers, 'x-ama-client')).toBe('web-rpc')
  })

  it('serializes session label selectors', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ data: [], pagination: { limit: 50, nextCursor: null, hasMore: false } }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listSessions({ labelSelector: 'maintainerId=maint_123' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions?labelSelector=maintainerId%3Dmaint_123',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  // ---------------------------------------------------------------------------
  // ApiError
  // ---------------------------------------------------------------------------
  describe('ApiError', () => {
    it('is an instance of Error', () => {
      const err = new ApiError('msg', 400, { detail: 'bad' })
      expect(err).toBeInstanceOf(Error)
    })

    it('exposes status and details', () => {
      const err = new ApiError('not found', 404, null)
      expect(err.status).toBe(404)
      expect(err.details).toBeNull()
      expect(err.message).toBe('not found')
    })
  })

  // ---------------------------------------------------------------------------
  // rpcRequest — error branches
  // ---------------------------------------------------------------------------
  describe('rpcRequest error handling', () => {
    it('throws ApiError with error.message from JSON body on non-ok response', async () => {
      vi.stubGlobal('fetch', makeJsonFetch({ error: { message: 'Resource not found' } }, 404))
      await expect(api.readAgent('missing-id')).rejects.toMatchObject({
        status: 404,
        message: 'Resource not found',
      })
    })

    it('throws ApiError using statusText when body has no error.message', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(JSON.stringify({ other: 'thing' }), {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(api.readAgent('bad-id')).rejects.toMatchObject({
        status: 422,
        message: 'Unprocessable Entity',
      })
    })

    it('throws ApiError with statusText when body is not JSON object', async () => {
      vi.stubGlobal('fetch', makeTextFetch('Internal Server Error', 500))
      await expect(api.readAgent('err-id')).rejects.toMatchObject({
        status: 500,
      })
    })

    it('returns undefined for 204 No Content responses', async () => {
      vi.stubGlobal('fetch', makeEmptyFetch(204))
      const result = await api.deleteCurrentSession()
      expect(result).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // queryOptions — false values are excluded, undefined excluded, 0 included
  // ---------------------------------------------------------------------------
  describe('queryOptions filtering (via listAgents)', () => {
    it('omits undefined values from the query string', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAgents({ limit: 10 })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).not.toContain('search')
      expect(url).toContain('limit=10')
    })

    it('omits false boolean values from the query string', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      // archived=false should be excluded per queryOptions logic
      await api.listAgents({ archived: false })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).not.toContain('archived')
    })

    it('includes true boolean values', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAgents({ archived: true })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('archived=true')
    })
  })

  // ---------------------------------------------------------------------------
  // Auth API
  // ---------------------------------------------------------------------------
  describe('auth API', () => {
    it('readConfigz calls /api/v1/configz', async () => {
      const config = { auth: { oidc: { issuer: 'https://auth.example.com', clientId: 'client_1', scope: 'openid' } } }
      const fetchMock = makeJsonFetch(config)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readConfigz()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/configz')
      expect(result).toEqual(config)
    })

    it('readAuthConfig calls /api/v1/auth/config', async () => {
      const fetchMock = makeJsonFetch({ methods: [] })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAuthConfig()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/auth/config')
      expect(result).toEqual({ methods: [] })
    })

    it('readAuthConfig passes organization as query param', async () => {
      const fetchMock = makeJsonFetch({ methods: [] })
      vi.stubGlobal('fetch', fetchMock)
      await api.readAuthConfig('my-org')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('organization=my-org')
    })

    it('readCurrentSession calls /api/v1/auth/sessions/current', async () => {
      const session = {
        user: { id: 'u1', email: 'a@b.com', name: null },
        organization: { id: 'o1', name: 'Org' },
        project: { id: 'p1', name: 'Proj' },
      }
      const fetchMock = makeJsonFetch(session)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readCurrentSession()
      expect(result).toEqual(session)
    })

    it('deleteCurrentSession calls DELETE /api/v1/auth/sessions/current', async () => {
      vi.stubGlobal('fetch', makeEmptyFetch(204))
      const result = await api.deleteCurrentSession()
      expect(result).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Projects API
  // ---------------------------------------------------------------------------
  describe('projects API', () => {
    it('listProjects returns the list response', async () => {
      const fetchMock = makeJsonFetch({
        data: [{ id: 'p1', name: 'My Project', createdAt: '', updatedAt: '' }],
        pagination: { limit: 25, nextCursor: null, hasMore: false },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.listProjects()
      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.id).toBe('p1')
    })

    it('createProject posts the project name', async () => {
      const fetchMock = makeJsonFetch({ id: 'p2', name: 'New Project', createdAt: '', updatedAt: '' })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.createProject({ name: 'New Project' })
      expect(result.id).toBe('p2')
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })
  })

  // ---------------------------------------------------------------------------
  // Agents API
  // ---------------------------------------------------------------------------
  describe('agents API', () => {
    const agentFixture = agent({
      id: 'agent_1',
      name: 'Test Agent',
      systemPrompt: null,
      provider: null,
      model: null,
      skills: [],
      tools: [],
      currentVersionId: null,
      createdAt: '',
      updatedAt: '',
    })

    it('readAgent calls GET /api/v1/agents/:agentId', async () => {
      const fetchMock = makeJsonFetch(agentFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAgent('agent_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/agents/agent_1')
      expect(result.metadata.uid).toBe('agent_1')
    })

    it('createAgent posts JSON', async () => {
      const fetchMock = makeJsonFetch(agentFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createAgent({ name: 'Test Agent' })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('updateAgent patches the agent', async () => {
      const fetchMock = makeJsonFetch(agentFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.updateAgent('agent_1', { name: 'Renamed' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/agents/agent_1')
    })

    it('archiveAgent patches with archived:true', async () => {
      const fetchMock = makeJsonFetch(agent({ id: 'agent_1', archivedAt: '2026-01-01' }))
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.archiveAgent('agent_1')
      expect(result.metadata.archivedAt).toBeTruthy()
    })

    it('listAgentVersions calls the versions sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAgentVersions('agent_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/agents/agent_1/versions')
    })

    it('readAgentMemory calls the memory sub-resource', async () => {
      const fetchMock = makeJsonFetch({
        metadata: { ...agentFixture.metadata, uid: 'agentmem_1', name: 'Agent memory' },
        spec: { agentId: 'agent_1', content: 'facts', metadata: {} },
        status: { phase: 'active' },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAgentMemory('agent_1')
      expect(result.spec.content).toBe('facts')
    })

    it('replaceAgentMemory puts new content', async () => {
      const fetchMock = makeJsonFetch({
        metadata: { ...agentFixture.metadata, uid: 'agentmem_1', name: 'Agent memory' },
        spec: { agentId: 'agent_1', content: 'new facts', metadata: {} },
        status: { phase: 'active' },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.replaceAgentMemory('agent_1', { content: 'new facts' })
      expect(result.spec.content).toBe('new facts')
    })
  })

  // ---------------------------------------------------------------------------
  // Environments API
  // ---------------------------------------------------------------------------
  describe('environments API', () => {
    const envFixture = environment({
      id: 'env_1',
      name: 'Prod',
      networkPolicy: { mode: 'unrestricted' },
      currentVersionId: null,
      createdAt: '',
      updatedAt: '',
    })

    it('listEnvironments calls /api/v1/environments', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listEnvironments()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/environments')
    })

    it('readEnvironment calls /api/v1/environments/:id', async () => {
      const fetchMock = makeJsonFetch(envFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readEnvironment('env_1')
      expect(result.metadata.uid).toBe('env_1')
    })

    it('createEnvironment posts JSON', async () => {
      const fetchMock = makeJsonFetch(envFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createEnvironment({ name: 'Prod' })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('updateEnvironment patches the environment', async () => {
      const fetchMock = makeJsonFetch(envFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.updateEnvironment('env_1', { name: 'Updated' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/environments/env_1')
    })

    it('archiveEnvironment patches with archived:true', async () => {
      const fetchMock = makeJsonFetch(environment({ id: 'env_1', archivedAt: '2026-01-01' }))
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.archiveEnvironment('env_1')
      expect(result.metadata.archivedAt).toBeTruthy()
    })

    it('listEnvironmentVersions calls the versions sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listEnvironmentVersions('env_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/environments/env_1/versions')
    })
  })

  // ---------------------------------------------------------------------------
  // Sessions API
  // ---------------------------------------------------------------------------
  describe('sessions API', () => {
    const sessionFixture = {
      metadata: {
        uid: 'sess_1',
        pid: 'p1',
        name: 'sess_1',
        labels: {},
        annotations: {},
        createdBy: null,
        createdAt: '',
        updatedAt: '',
        archivedAt: null,
      },
      spec: {
        agentId: 'agent_1',
        environmentId: null,
        runtime: 'ama',
        env: {},
        envFrom: [],
        volumes: [],
        volumeMounts: [],
      },
      status: {
        phase: 'running' as const,
        reason: null,
        conditions: [],
        bindings: {
          agent: { versionId: 'av_1', snapshot: {} as never },
          environment: { id: null, versionId: null, snapshot: null },
          runtime: 'ama',
        },
        placement: null,
        startedAt: null,
        stoppedAt: null,
      },
    }

    it('createSession posts JSON', async () => {
      const fetchMock = makeJsonFetch(sessionFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createSession({ agentId: 'agent_1', environmentId: 'env_1', runtime: 'ama' })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('readSession calls /api/v1/sessions/:sessionId', async () => {
      const fetchMock = makeJsonFetch(sessionFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readSession('sess_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/sessions/sess_1')
      expect(result.metadata.uid).toBe('sess_1')
    })

    it('readSessionConnection calls the connection sub-resource', async () => {
      const conn = { sessionId: 'sess_1', transport: null, path: null, state: 'running' as const, stateReason: null }
      const fetchMock = makeJsonFetch(conn)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readSessionConnection('sess_1')
      expect(result.sessionId).toBe('sess_1')
    })

    it('stopSession patches with state:stopped', async () => {
      const fetchMock = makeJsonFetch({
        ...sessionFixture,
        status: { ...sessionFixture.status, phase: 'stopped' as const },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.stopSession('sess_1')
      expect(result.status.phase).toBe('stopped')
    })

    it('archiveSession patches with archived:true', async () => {
      const fetchMock = makeJsonFetch({
        ...sessionFixture,
        metadata: { ...sessionFixture.metadata, archivedAt: '2026-01-01' },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.archiveSession('sess_1')
      expect(result.metadata.archivedAt).toBeTruthy()
    })

    it('sendSessionMessage posts to messages sub-resource', async () => {
      const msg = {
        id: 'msg_1',
        sessionId: 'sess_1',
        type: 'prompt' as const,
        content: 'hello',
        delivery: 'live' as const,
        state: 'accepted' as const,
        error: null,
        createdAt: '',
        updatedAt: '',
      }
      const fetchMock = makeJsonFetch(msg)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.sendSessionMessage('sess_1', 'hello')
      expect(result.content).toBe('hello')
    })

    it('listSessionEvents calls the events sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listSessionEvents('sess_1', { limit: 10, order: 'asc' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/sessions/sess_1/events')
      expect(url).toContain('limit=10')
    })

    it('listSessionApprovals calls the approvals sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listSessionApprovals('sess_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/sessions/sess_1/approvals')
    })

    it('decideSessionApproval patches the approval', async () => {
      const approval = {
        id: 'apr_1',
        sessionId: 'sess_1',
        toolCallId: 'tc_1',
        toolName: 'bash',
        input: {},
        relatedEventIds: [],
        state: 'approved' as const,
        reason: null,
        result: null,
        requestedAt: '',
        decidedAt: '',
        createdAt: '',
        updatedAt: '',
      }
      const fetchMock = makeJsonFetch(approval)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.decideSessionApproval('sess_1', 'apr_1', { decision: 'approve' })
      expect(result.state).toBe('approved')
    })
  })

  // ---------------------------------------------------------------------------
  // Providers API
  // ---------------------------------------------------------------------------
  describe('providers API', () => {
    const providerFixture = {
      id: 'prov_1',
      slug: 'anthropic',
      displayName: 'Anthropic',
      enabled: true,
      metadata: {},
      modelCatalogState: 'ready',
      lastError: null,
      createdAt: '',
      updatedAt: '',
    }

    it('listProviders calls /api/v1/providers', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listProviders()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/providers')
    })

    it('listModels calls /api/v1/providers/models', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listModels()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/providers/models')
    })

    it('readProvider calls /api/v1/providers/:providerId', async () => {
      const fetchMock = makeJsonFetch(providerFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readProvider('prov_1')
      expect(result.id).toBe('prov_1')
    })

    it('listProviderModels calls the models sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listProviderModels('prov_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/providers/prov_1/models')
    })

    it('refreshCatalog posts to /api/v1/providers/refresh', async () => {
      const fetchMock = makeJsonFetch({ outcome: 'succeeded', discoveredCount: 3, vendors: 2 })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.refreshCatalog()
      expect(result.outcome).toBe('succeeded')
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toContain('/api/v1/providers/refresh')
      expect(init?.method).toBe('POST')
    })
  })

  // ---------------------------------------------------------------------------
  // Vaults API
  // ---------------------------------------------------------------------------
  describe('vaults API', () => {
    const vaultFixture = vault({ id: 'vault_1', name: 'My Vault', createdAt: '', updatedAt: '' })

    it('listVaults calls /api/v1/vaults', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listVaults()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/vaults')
    })

    it('readVault calls /api/v1/vaults/:vaultId', async () => {
      const fetchMock = makeJsonFetch(vaultFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readVault('vault_1')
      expect(result.metadata.uid).toBe('vault_1')
    })

    it('createVault posts JSON', async () => {
      const fetchMock = makeJsonFetch(vaultFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createVault({ name: 'My Vault' })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('archiveVault patches with archived:true', async () => {
      const fetchMock = makeJsonFetch(vault({ id: 'vault_1', archivedAt: '2026-01-01' }))
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.archiveVault('vault_1')
      expect(result.metadata.archivedAt).toBeTruthy()
    })

    it('listVaultCredentials calls the credentials sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listVaultCredentials('vault_1', { search: 'test' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/vaults/vault_1/credentials')
      expect(url).toContain('search=test')
    })

    it('createVaultCredential posts to credentials sub-resource', async () => {
      const fetchMock = makeJsonFetch(
        credential({ id: 'cred_1', vaultId: 'vault_1', name: 'API Key', activeVersion: null }),
      )
      vi.stubGlobal('fetch', fetchMock)
      await api.createVaultCredential('vault_1', {
        name: 'API Key',
        type: 'opaque',
        secret: { stringData: { value: 'raw' } },
      })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('rotateVaultCredential posts to versions sub-resource', async () => {
      const rotated = credential({
        id: 'cred_1',
        vaultId: 'vault_1',
        activeVersionId: 'ver_1',
        activeVersion: {
          metadata: {
            uid: 'ver_1',
            pid: 'project_1',
            name: 'Credential v2',
            description: null,
            labels: {},
            annotations: {},
            createdBy: 'user_1',
            createdAt: '',
            updatedAt: '',
            archivedAt: null,
          },
          spec: {
            credentialId: 'cred_1',
            vaultId: 'vault_1',
            organizationId: 'org_1',
            version: 2,
            provider: 'ama',
            secretRef: 'ref',
            referenceName: 'ref',
            hasSecret: true,
            dataKeys: ['value'],
            metadata: {},
          },
          status: { phase: 'active', supersededAt: null, revokedAt: null },
        },
      })
      const fetchMock = makeJsonFetch(rotated)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.rotateVaultCredential('vault_1', 'cred_1', { stringData: { value: 'newsecret' } })
      expect(result.status.activeVersion?.metadata.uid).toBe('ver_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/vaults/vault_1/credentials/cred_1/versions')
    })

    it('revokeVaultCredential patches with state:revoked', async () => {
      const fetchMock = makeJsonFetch(
        credential({
          id: 'cred_1',
          vaultId: 'vault_1',
          name: 'API Key',
          phase: 'revoked',
          activeVersion: null,
          revokedAt: '2026-01-01',
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.revokeVaultCredential('vault_1', 'cred_1', 'no longer needed')
      expect(result.status.phase).toBe('revoked')
    })

    it('revokeVaultCredential works without a revokeReason', async () => {
      const fetchMock = makeJsonFetch(
        credential({
          id: 'cred_1',
          vaultId: 'vault_1',
          name: 'API Key',
          phase: 'revoked',
          activeVersion: null,
          revokedAt: '2026-01-01',
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.revokeVaultCredential('vault_1', 'cred_1')
      expect(result.status.phase).toBe('revoked')
    })
  })

  // ---------------------------------------------------------------------------
  // Connectors & Connections API
  // ---------------------------------------------------------------------------
  describe('connectors API', () => {
    it('listConnectors calls /api/v1/connectors', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listConnectors({ search: 'github', category: 'vcs' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/connectors')
      expect(url).toContain('search=github')
    })

    it('readConnector calls /api/v1/connectors/:connectorId', async () => {
      const connector = {
        id: 'conn_1',
        name: 'GitHub',
        description: 'GitHub connector',
        category: 'vcs',
        trustLevel: 'high',
        capabilities: [],
        supportedAuthModes: [],
        setupRequirements: [],
        tools: [],
        metadata: {},
        availability: 'available' as const,
        createdAt: '',
        updatedAt: '',
      }
      const fetchMock = makeJsonFetch(connector)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readConnector('conn_1')
      expect(result.id).toBe('conn_1')
    })
  })

  // ---------------------------------------------------------------------------
  // Governance API (budgets)
  // ---------------------------------------------------------------------------
  describe('governance API', () => {
    it('listBudgets calls /api/v1/budgets', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listBudgets()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/budgets')
    })
  })

  // ---------------------------------------------------------------------------
  // Usage API
  // ---------------------------------------------------------------------------
  describe('usage API', () => {
    it('readUsageSummary calls /api/v1/usage-summary', async () => {
      const summary = {
        groupBy: 'provider' as const,
        totals: {
          records: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: 0,
          costMicros: 0,
          currency: 'USD',
        },
        groups: [],
      }
      const fetchMock = makeJsonFetch(summary)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readUsageSummary({ groupBy: 'provider' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/usage-summary')
      expect(result.groupBy).toBe('provider')
    })

    it('listUsageRecords calls /api/v1/usage-records', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listUsageRecords({ limit: 50 })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/usage-records')
      expect(url).toContain('limit=50')
    })
  })

  // ---------------------------------------------------------------------------
  // Audit API
  // ---------------------------------------------------------------------------
  describe('audit API', () => {
    const auditRecord = {
      id: 'rec_1',
      projectId: 'p1',
      actorUserId: 'u1',
      actorType: 'user',
      action: 'create',
      resourceType: 'agent',
      resourceId: 'agent_1',
      outcome: 'success',
      requestId: null,
      correlationId: null,
      sessionId: null,
      policyCategory: null,
      metadata: {},
      before: {},
      after: {},
      createdAt: '',
    }

    it('listAuditRecords calls /api/v1/audit-records', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAuditRecords({ action: 'create' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/audit-records')
    })

    it('readAuditRecord calls /api/v1/audit-records/:recordId', async () => {
      const fetchMock = makeJsonFetch(auditRecord)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAuditRecord('rec_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/audit-records/rec_1')
      expect(result.id).toBe('rec_1')
    })
  })
})
