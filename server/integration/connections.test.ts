import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, seedPlatformProvider, setupOidcProvider, signIn } from './auth'
import { seedPolicy } from './policy-seed'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

const MCP_FIXTURE_ENDPOINT = 'https://mcp.fixture.test/mcp'

interface McpFixtureCall {
  method: string
  toolName?: string
  authorization: string | null
}

// Streamable-HTTP MCP server stub on the worker's outbound fetch. The MCP
// client in the route under test performs real JSON-RPC initialize/list/call
// round trips against it. Cloudflare secrets-store writes stay stubbed the
// same way setupOidcProvider does.
function stubMcpFixture(options: {
  acceptedToken: () => string
  failure?: () => 'network' | null
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}) {
  const calls: McpFixtureCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.hostname === 'api.cloudflare.com' && url.pathname.includes('/secrets_store/stores/')) {
        if (init?.method === 'POST') {
          const secrets = JSON.parse(String(init.body)) as Array<{ name: string }>
          return Response.json({ success: true, result: secrets.map((secret) => ({ id: `secret_${secret.name}` })) })
        }
        if (init?.method === 'DELETE') {
          return Response.json({ success: true, result: null })
        }
      }
      if (url.hostname !== 'mcp.fixture.test') {
        return new Response('not found', { status: 404 })
      }
      if (options.failure?.() === 'network') {
        throw new TypeError('fetch failed: raw-connection-refused-detail')
      }
      if ((init?.method ?? 'GET') !== 'POST') {
        return new Response('method not allowed', { status: 405 })
      }
      const headers = new Headers(init?.headers as HeadersInit)
      const authorization = headers.get('authorization')
      const body = JSON.parse(String(init?.body)) as {
        id?: number | string
        method: string
        params?: { name?: string; protocolVersion?: string }
      }
      calls.push({ method: body.method, ...(body.params?.name ? { toolName: body.params.name } : {}), authorization })
      if (authorization !== `Bearer ${options.acceptedToken()}`) {
        return new Response('raw-fixture-unauthorized-detail', { status: 401 })
      }
      const respond = (result: unknown) => Response.json({ jsonrpc: '2.0', id: body.id ?? null, result })
      if (body.method === 'initialize') {
        return respond({
          protocolVersion: body.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'mcp-fixture', version: '1.0.0' },
        })
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      if (body.method === 'tools/list') {
        return respond({
          tools: options.tools ?? [
            {
              name: 'repo.read',
              description: 'Read repository metadata and files.',
              inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
            },
          ],
        })
      }
      if (body.method === 'tools/call') {
        return respond({
          content: [{ type: 'text', text: `fixture:${body.params?.name}` }],
          structuredContent: { ok: true },
        })
      }
      return Response.json({
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: { code: -32601, message: 'raw-fixture-method-missing' },
      })
    }),
  )
  return calls
}

async function createCredential(authorization: string, scope?: 'organization') {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Connection credentials', ...(scope ? { scope } : {}) }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }

  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'GitHub token',
      type: 'api_key',
      connectorBinding: { connectorId: 'github', name: 'token' },
      secret: {
        provider: 'cloudflare-secrets',
        secretValue: scope === 'organization' ? 'org-github-token' : 'raw-github-token',
      },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as {
    id: string
    activeVersionId: string
    activeVersion: { id: string; secretRef: string }
  }
  return { vaultId: vault.id, ...credential }
}

async function createSession(authorization: string, tools = ['mcp:github.repo.read']) {
  const environmentRes = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Connection session environment' }),
  })
  expect(environmentRes.status).toBe(201)
  const environment = (await environmentRes.json()) as { id: string }

  const agentRes = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Connection agent',
      tools: tools.map((name) => ({ name })),
      providerId: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
    }),
  })
  expect(agentRes.status).toBe(201)
  const agent = (await agentRes.json()) as { id: string }
  const sessionRes = await jsonFetch('/api/v1/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
  })
  expect(sessionRes.status).toBe(201)
  return (await sessionRes.json()) as { id: string }
}

async function setProjectMcpPolicy(authorization: string, mcpPolicy: Record<string, unknown>) {
  await seedPolicy({ authorization, scope: { level: 'project' }, mcpPolicy })
}

async function connectGithub(
  authorization: string,
  credential: { id: string; activeVersionId?: string },
  overrides: Record<string, unknown> = {},
) {
  const connectRes = await jsonFetch('/api/v1/connections', authorization, {
    method: 'POST',
    body: JSON.stringify({
      connectorId: 'github',
      credentialRef: { credentialId: credential.id },
      ...overrides,
    }),
  })
  expect(connectRes.status).toBe(201)
  return (await connectRes.json()) as {
    id: string
    connectorId: string
    state: string
    credentialRef: { credentialId: string; versionId?: string } | null
  }
}

async function signInUser(suffix: string) {
  return await signIn({
    ...defaultClaims(),
    sub: `user_connections_${suffix}`,
    email: `connections-${suffix}@example.com`,
    org_id: `org_flare_connections_${suffix}`,
    org_name: `Connections ${suffix} Org`,
  })
}

describe('[CF] Connections, tools, policy, and tool call execution [spec: mcp/connect]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects connecting connectors excluded by the project allow list [spec: mcp/policy-enforcement]', async () => {
    const authorization = await signInUser('allow_list')
    await setProjectMcpPolicy(authorization, { allowedConnectors: ['linear'] })

    const connectRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github' }),
    })
    expect(connectRes.status).toBe(403)
    await expect(connectRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'MCP connector is blocked by governance policy.',
        details: { category: 'mcp', resourceType: 'mcp_connector', resourceId: 'github' },
      },
    })
  })

  it('creates once, conflicts on duplicates, updates via PATCH, and audits without leaking secrets [spec: mcp/connection-lifecycle]', async () => {
    const authorization = await signInUser('lifecycle')
    const credential = await createCredential(authorization)

    const rawCredentialRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', secretValue: 'raw-github-token' }),
    })
    expect(rawCredentialRes.status).toBe(400)

    const missingCredentialRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github' }),
    })
    expect(missingCredentialRes.status).toBe(400)

    const unknownConnectorRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'unknown' }),
    })
    expect(unknownConnectorRes.status).toBe(404)

    const connectRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({
        connectorId: 'github',
        credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
        metadata: { owner: 'platform' },
      }),
    })
    expect(connectRes.status).toBe(201)
    expect(connectRes.headers.get('Location')).toMatch(/^\/api\/v1\/connections\/conn_/)
    const connection = (await connectRes.json()) as Record<string, unknown> & { id: string }
    expect(connection).toMatchObject({
      connectorId: 'github',
      state: 'connected',
      credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
      disconnectedAt: null,
    })
    expect(connection).not.toHaveProperty('organizationId')
    expect(connection).not.toHaveProperty('hasCredential')
    expect(connection).not.toHaveProperty('credentialSecretRef')
    expect(connection).not.toHaveProperty('status')
    expect(JSON.stringify(connection)).not.toContain(credential.activeVersion.secretRef)
    expect(JSON.stringify(connection)).not.toContain('raw-github-token')

    // POST creates only: a second connection for the same connector conflicts
    // with the project+connector unique index.
    const duplicateRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialRef: { credentialId: credential.id } }),
    })
    expect(duplicateRes.status).toBe(409)
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', details: { connectorId: 'github', connectionId: connection.id } },
    })

    const toolsRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools`, authorization)
    expect(toolsRes.status).toBe(200)
    const tools = (await toolsRes.json()) as { data: Array<Record<string, unknown>> }
    expect(tools.data).toEqual([
      expect.objectContaining({ connectorId: 'github', name: 'repo.read', availability: 'available' }),
    ])
    expect(tools.data[0]).not.toHaveProperty('status')

    const readRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: connection.id,
      credentialRef: { credentialId: credential.id },
    })

    // Clearing the credential on a connector that requires one is rejected.
    const clearCredentialRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ credentialRef: null }),
    })
    expect(clearCredentialRes.status).toBe(400)

    const patchRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ endpointUrl: 'https://mcp.example.test/github', state: 'disabled' }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: connection.id,
      endpointUrl: 'https://mcp.example.test/github',
      state: 'disabled',
    })

    const disabledToolsRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools`, authorization)
    expect(disabledToolsRes.status).toBe(409)

    const invalidCursorRes = await jsonFetch('/api/v1/connections?cursor=not-a-valid-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)

    // Disconnect is a PATCH state transition, not a DELETE: the resource stays
    // addressable and can be reconnected.
    const disconnectRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'disconnected' }),
    })
    expect(disconnectRes.status).toBe(200)
    const disconnected = (await disconnectRes.json()) as { state: string; disconnectedAt: string | null }
    expect(disconnected.state).toBe('disconnected')
    expect(disconnected.disconnectedAt).not.toBeNull()

    const afterDisconnectRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization)
    expect(afterDisconnectRes.status).toBe(200)

    const reconnectRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'connected' }),
    })
    expect(reconnectRes.status).toBe(200)
    await expect(reconnectRes.json()).resolves.toMatchObject({ state: 'connected', disconnectedAt: null })

    const listRes = await jsonFetch('/api/v1/connections?state=connected', authorization)
    expect(listRes.status).toBe(200)
    await expect(listRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: connection.id, state: 'connected' })],
    })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=connection.update', authorization)
    expect(auditRes.status).toBe(200)
    const audit = await auditRes.json()
    expect(JSON.stringify(audit)).toContain('connection.update')
    expect(JSON.stringify(audit)).not.toContain('raw-github-token')
    expect(JSON.stringify(audit)).not.toContain(credential.activeVersion.secretRef)
  })

  it('enforces tenant scoping for project connections [spec: mcp/tenancy]', async () => {
    const authorization = await signInUser('tenant')
    const credential = await createCredential(authorization)
    const connection = await connectGithub(authorization, credential)

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_other_connections',
      email: 'other-connections@example.com',
      org_id: 'org_flare_other_connections',
      org_name: 'Other Connections Org',
    })
    const otherListRes = await jsonFetch('/api/v1/connections', otherCookie)
    expect(otherListRes.status).toBe(200)
    await expect(otherListRes.json()).resolves.toMatchObject({ data: [] })

    const otherReadRes = await jsonFetch(`/api/v1/connections/${connection.id}`, otherCookie)
    expect(otherReadRes.status).toBe(404)
  })

  it('returns approval-required without executing tool calls', async () => {
    const authorization = await signInUser('approval_required')
    const credential = await createCredential(authorization)
    const connection = await connectGithub(authorization, credential)
    const session = await createSession(authorization)

    await setProjectMcpPolicy(authorization, { requireApprovalConnectors: ['github'] })

    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(409)
    await expect(callRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'MCP tool call requires approval before execution.',
        details: { category: 'approval', ruleId: 'mcpPolicy.requireApproval' },
      },
    })
  })

  it('blocks tool calls when the project policy denies the connector and records the decision', async () => {
    const authorization = await signInUser('call_blocked')
    const credential = await createCredential(authorization)
    const connection = await connectGithub(authorization, credential)
    const session = await createSession(authorization)

    await setProjectMcpPolicy(authorization, { blockedConnectors: ['github'] })

    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(403)
    await expect(callRes.json()).resolves.toMatchObject({
      error: { type: 'policy_denied', details: { category: 'mcp', resourceId: 'github' } },
    })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${session.id}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }
    expect(events.data).toContainEqual(
      expect.objectContaining({
        type: 'policy.decision',
        payload: expect.objectContaining({
          allowed: false,
          operation: 'mcp_tool_call',
          connectorId: 'github',
          toolName: 'repo.read',
        }),
      }),
    )

    const auditRes = await jsonFetch('/api/v1/audit-records?action=connection_tool.call', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          action: 'connection_tool.call',
          outcome: 'denied',
          metadata: expect.objectContaining({ connectorId: 'github' }),
        }),
      ],
    })
  })

  it('executes tool calls as addressable 201 resources and honors rotated and revoked credentials [spec: mcp/tool-call] [spec: mcp/credential-refresh]', async () => {
    const authorization = await signInUser('call_execute')
    const credential = await createCredential(authorization)
    let acceptedToken = 'raw-github-token'
    const fixtureCalls = stubMcpFixture({ acceptedToken: () => acceptedToken })
    const connection = await connectGithub(authorization, credential, { endpointUrl: MCP_FIXTURE_ENDPOINT })
    const session = await createSession(authorization)

    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(201)
    const call = (await callRes.json()) as Record<string, unknown> & { id: string }
    expect(call).toMatchObject({
      connectionId: connection.id,
      connectorId: 'github',
      toolName: 'repo.read',
      sessionId: session.id,
      state: 'success',
      input: { repo: 'saltbo/any-managed-agents' },
      output: { content: [{ type: 'text', text: 'fixture:repo.read' }], structuredContent: { ok: true } },
      error: null,
    })
    expect(typeof call.durationMs).toBe('number')
    const location = callRes.headers.get('Location')
    expect(location).toBe(`/api/v1/connections/${connection.id}/tools/repo.read/calls/${call.id}`)
    expect(fixtureCalls.find((entry) => entry.method === 'tools/call')).toMatchObject({
      toolName: 'repo.read',
      authorization: 'Bearer raw-github-token',
    })

    // The created call is addressable afterwards.
    const readCallRes = await jsonFetch(location as string, authorization)
    expect(readCallRes.status).toBe(200)
    await expect(readCallRes.json()).resolves.toMatchObject({ id: call.id, state: 'success' })

    const listCallsRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization)
    expect(listCallsRes.status).toBe(200)
    await expect(listCallsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: call.id })],
    })

    // Rotated credentials take effect without reconnecting.
    const rotateRes = await jsonFetch(
      `/api/v1/vaults/${credential.vaultId}/credentials/${credential.id}/versions`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ provider: 'cloudflare-secrets', secretValue: 'rotated-github-token' }),
      },
    )
    expect(rotateRes.status).toBe(201)
    acceptedToken = 'rotated-github-token'

    const rotatedCallRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(rotatedCallRes.status).toBe(201)
    expect(fixtureCalls.filter((entry) => entry.method === 'tools/call').at(-1)).toMatchObject({
      authorization: 'Bearer rotated-github-token',
    })

    // Upstream auth failures still create the call resource; the error is
    // normalized and raw connector detail never leaks.
    acceptedToken = 'token-the-connection-does-not-hold'
    const errorCallRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(errorCallRes.status).toBe(201)
    const errorCall = (await errorCallRes.json()) as Record<string, unknown> & { id: string }
    expect(errorCall).toMatchObject({
      state: 'error',
      output: null,
      error: { type: 'mcp_unauthorized' },
    })
    expect(JSON.stringify(errorCall)).not.toContain('raw-fixture-unauthorized-detail')
    expect(JSON.stringify(errorCall)).not.toContain('rotated-github-token')
    const errorReadRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls/${errorCall.id}`,
      authorization,
    )
    expect(errorReadRes.status).toBe(200)
    await expect(errorReadRes.json()).resolves.toMatchObject({ id: errorCall.id, state: 'error' })
    acceptedToken = 'rotated-github-token'

    // Revoked credentials deny before execution: no call resource is created.
    const revokeRes = await jsonFetch(
      `/api/v1/vaults/${credential.vaultId}/credentials/${credential.id}`,
      authorization,
      {
        method: 'PATCH',
        body: JSON.stringify({ state: 'revoked', revokeReason: 'No longer approved.' }),
      },
    )
    expect(revokeRes.status).toBe(200)

    const revokedCallRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(revokedCallRes.status).toBe(403)
    await expect(revokedCallRes.json()).resolves.toMatchObject({
      error: { type: 'policy_denied', message: 'MCP connector credential is revoked or unavailable.' },
    })
  })

  it('lists tools from the live MCP server and rejects calls on connections without endpoints [spec: mcp/tools]', async () => {
    const authorization = await signInUser('live_tools')
    const credential = await createCredential(authorization)
    const fixtureCalls = stubMcpFixture({
      acceptedToken: () => 'raw-github-token',
      tools: [
        {
          name: 'echo',
          description: 'Echo text back.',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
      ],
    })
    const connection = await connectGithub(authorization, credential)
    const session = await createSession(authorization)

    // Without an endpoint the connection serves catalog metadata and cannot
    // execute calls.
    const catalogToolsRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools`, authorization)
    expect(catalogToolsRes.status).toBe(200)
    await expect(catalogToolsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ name: 'repo.read' })],
    })
    const noEndpointCallRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(noEndpointCallRes.status).toBe(409)
    await expect(noEndpointCallRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Connection endpoint is not configured.' },
    })
    expect(fixtureCalls).toHaveLength(0)

    const patchRes = await jsonFetch(`/api/v1/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ endpointUrl: MCP_FIXTURE_ENDPOINT }),
    })
    expect(patchRes.status).toBe(200)

    const liveToolsRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools`, authorization)
    expect(liveToolsRes.status).toBe(200)
    const liveTools = (await liveToolsRes.json()) as { data: Array<{ name: string; inputSchema: unknown }> }
    expect(liveTools.data).toEqual([
      expect.objectContaining({
        name: 'echo',
        description: 'Echo text back.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        availability: 'available',
      }),
    ])
    expect(fixtureCalls.find((entry) => entry.method === 'tools/list')).toMatchObject({
      authorization: 'Bearer raw-github-token',
    })

    // Calls against tools the connection does not hold are not addressable.
    const unknownToolCallRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(unknownToolCallRes.status).toBe(404)
  })

  it('records canonical session events for tool calls and normalizes transport failures', async () => {
    const authorization = await signInUser('call_events')
    const credential = await createCredential(authorization)
    let failure: 'network' | null = null
    stubMcpFixture({ acceptedToken: () => 'raw-github-token', failure: () => failure })
    const connection = await connectGithub(authorization, credential, { endpointUrl: MCP_FIXTURE_ENDPOINT })
    const session = await createSession(authorization)

    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(201)

    failure = 'network'
    const failedCallRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(failedCallRes.status).toBe(201)
    const failedBody = (await failedCallRes.json()) as Record<string, unknown>
    expect(failedBody).toMatchObject({ state: 'error', error: { type: 'mcp_network_error' } })
    expect(JSON.stringify(failedBody)).not.toContain('raw-connection-refused-detail')

    const eventsRes = await jsonFetch(`/api/v1/sessions/${session.id}/events?limit=50`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{
        id: string
        type: string
        parentEventId: string | null
        correlationId: string | null
        payload: Record<string, unknown>
      }>
    }
    const policyEvents = events.data.filter((event) => event.type === 'policy.decision')
    expect(policyEvents.length).toBeGreaterThanOrEqual(2)
    expect(policyEvents[0]?.payload).toMatchObject({ allowed: true, operation: 'mcp_tool_call', toolName: 'repo.read' })
    const startEvents = events.data.filter((event) => event.type === 'tool_execution_start')
    const endEvents = events.data.filter((event) => event.type === 'tool_execution_end')
    expect(startEvents).toHaveLength(2)
    expect(endEvents).toHaveLength(2)
    const successEnd = endEvents.find((event) => event.payload.isError === false)
    const failureEnd = endEvents.find((event) => event.payload.isError === true)
    expect(successEnd?.payload).toMatchObject({ toolName: 'repo.read', connectorId: 'github' })
    expect(typeof successEnd?.payload.durationMs).toBe('number')
    expect(failureEnd?.payload).toMatchObject({ error: { type: 'mcp_network_error' } })
    for (const endEvent of endEvents) {
      const pairedStart = startEvents.find((startEvent) => startEvent.id === endEvent.parentEventId)
      expect(pairedStart).toBeTruthy()
      expect(pairedStart?.correlationId).toBe(endEvent.correlationId)
    }
    expect(JSON.stringify(events)).not.toContain('raw-github-token')
    expect(JSON.stringify(events)).not.toContain('raw-connection-refused-detail')
  })

  it('applies environment MCP connector restrictions during tool calls', async () => {
    const authorization = await signInUser('environment')
    const credential = await createCredential(authorization)
    const connection = await connectGithub(authorization, credential)
    const linearConnectRes = await jsonFetch('/api/v1/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'linear', credentialRef: { credentialId: credential.id } }),
    })
    expect(linearConnectRes.status).toBe(201)

    const environmentRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Linear-only workspace',
        mcpPolicy: { allowedConnectors: ['linear'] },
      }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string }

    const agentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Environment connection agent',
        tools: [{ name: 'mcp:github.repo.read' }],
        providerId: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
      }),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { id: string }
    const sessionRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { id: string }

    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(403)
    await expect(callRes.json()).resolves.toMatchObject({
      error: { type: 'policy_denied', message: 'Environment does not allow this MCP connector.' },
    })
  })

  it('allows organization-scoped vault credentials for project tool calls', async () => {
    const authorization = await signInUser('org_credential')
    const credential = await createCredential(authorization, 'organization')
    const fixtureCalls = stubMcpFixture({ acceptedToken: () => 'org-github-token' })
    const connection = await connectGithub(authorization, credential, { endpointUrl: MCP_FIXTURE_ENDPOINT })
    expect(connection.credentialRef).toMatchObject({ credentialId: credential.id })

    const session = await createSession(authorization)
    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(201)
    await expect(callRes.json()).resolves.toMatchObject({ state: 'success' })
    expect(fixtureCalls.find((entry) => entry.method === 'tools/call')).toMatchObject({
      authorization: 'Bearer org-github-token',
    })
  })

  it('scopes tool call reads to the connection, tool, and tenant', async () => {
    const authorization = await signInUser('call_scoping')
    const credential = await createCredential(authorization)
    stubMcpFixture({ acceptedToken: () => 'raw-github-token' })
    const connection = await connectGithub(authorization, credential, { endpointUrl: MCP_FIXTURE_ENDPOINT })
    const session = await createSession(authorization)

    const callRes = await jsonFetch(`/api/v1/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(201)
    const call = (await callRes.json()) as { id: string }

    const wrongToolRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/other.tool/calls/${call.id}`,
      authorization,
    )
    expect(wrongToolRes.status).toBe(404)

    const unknownCallRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls/call_unknown`,
      authorization,
    )
    expect(unknownCallRes.status).toBe(404)

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_other_call_scope',
      email: 'other-call-scope@example.com',
      org_id: 'org_flare_other_call_scope',
      org_name: 'Other Call Scope Org',
    })
    const crossTenantRes = await jsonFetch(
      `/api/v1/connections/${connection.id}/tools/repo.read/calls/${call.id}`,
      otherCookie,
    )
    expect(crossTenantRes.status).toBe(404)
  })
})
