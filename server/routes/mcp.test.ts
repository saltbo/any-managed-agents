import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, setupOidcProvider, signIn } from '../test/auth'

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

async function createCredential(authorization: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'MCP credentials' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }

  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'GitHub token',
      type: 'api_key',
      connectorBinding: { connectorId: 'github', name: 'token' },
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-github-token' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  return (await credentialRes.json()) as {
    id: string
    activeVersionId: string
    activeVersion: { id: string; secretRef: string }
  }
}

async function createOrganizationCredential(authorization: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Organization MCP credentials', scope: 'organization' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }

  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Organization GitHub token',
      type: 'api_key',
      connectorBinding: { connectorId: 'github', name: 'token' },
      secret: { provider: 'cloudflare-secrets', secretValue: 'org-github-token' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  return (await credentialRes.json()) as { id: string }
}

async function createSession(authorization: string, allowedTools = ['mcp:github.repo.read']) {
  const environmentRes = await jsonFetch('/api/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'MCP session environment' }),
  })
  expect(environmentRes.status).toBe(201)
  const environment = (await environmentRes.json()) as { id: string }

  const agentRes = await jsonFetch('/api/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'MCP agent', allowedTools }),
  })
  expect(agentRes.status).toBe(201)
  const agent = (await agentRes.json()) as { id: string }
  const sessionRes = await jsonFetch('/api/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
  })
  expect(sessionRes.status).toBe(201)
  return (await sessionRes.json()) as { id: string }
}

async function signInUser(suffix: string) {
  return await signIn({
    ...defaultClaims(),
    sub: `user_mcp_${suffix}`,
    email: `mcp-${suffix}@example.com`,
    org_id: `org_flare_mcp_${suffix}`,
    org_name: `MCP ${suffix} Org`,
  })
}

describe('[CF] MCP catalog, connections, policy, and runtime integration', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists, filters, and reads connector catalog metadata without requiring credentials', async () => {
    const authorization = await signInUser('catalog')

    const listRes = await jsonFetch(
      '/api/mcp/connectors?search=GitHub&category=development&capability=repositories',
      authorization,
    )
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ connectorId: string; name: string; policyStatus: string; connectionStatus: string }>
    }
    expect(list.data).toContainEqual(
      expect.objectContaining({
        connectorId: 'github',
        name: 'GitHub',
        policyStatus: 'allowed',
        connectionStatus: 'not_connected',
      }),
    )
    expect(JSON.stringify(list)).not.toContain('raw-github-token')

    const detailRes = await jsonFetch('/api/mcp/connectors/github', authorization)
    expect(detailRes.status).toBe(200)
    await expect(detailRes.json()).resolves.toMatchObject({
      connectorId: 'github',
      tools: [expect.objectContaining({ name: 'repo.read' })],
    })

    const missingRes = await jsonFetch('/api/mcp/connectors/unknown', authorization)
    expect(missingRes.status).toBe(404)

    const invalidCursorRes = await jsonFetch('/api/mcp/connectors?cursor=not-a-valid-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
  })

  it('marks allow-list excluded connectors blocked and rejects connecting them', async () => {
    const authorization = await signInUser('catalog_allow_list')

    const policyRes = await jsonFetch('/api/governance/policy', authorization, {
      method: 'PUT',
      body: JSON.stringify({ mcpPolicy: { allowedConnectors: ['linear'] } }),
    })
    expect(policyRes.status).toBe(200)

    const listRes = await jsonFetch('/api/mcp/connectors?search=GitHub', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ connectorId: string; policyStatus: string }> }
    expect(list.data).toContainEqual(expect.objectContaining({ connectorId: 'github', policyStatus: 'blocked' }))

    const detailRes = await jsonFetch('/api/mcp/connectors/github', authorization)
    expect(detailRes.status).toBe(200)
    await expect(detailRes.json()).resolves.toMatchObject({
      connectorId: 'github',
      policyStatus: 'blocked',
    })

    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
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

  it('connects, upserts, lists tools, disconnects, audits, and never accepts raw credential values', async () => {
    const authorization = await signInUser('connections')
    const credential = await createCredential(authorization)

    const rawCredentialRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', secretValue: 'raw-github-token' }),
    })
    expect(rawCredentialRes.status).toBe(400)

    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({
        connectorId: 'github',
        credentialId: credential.id,
        credentialVersionId: credential.activeVersionId,
        metadata: { owner: 'platform' },
      }),
    })
    expect(connectRes.status).toBe(201)
    const connection = (await connectRes.json()) as {
      id: string
      connectorId: string
      hasCredential: boolean
      status: string
    }
    expect(connection).toMatchObject({
      connectorId: 'github',
      hasCredential: true,
      status: 'connected',
    })
    expect(JSON.stringify(connection)).not.toContain(credential.id)
    expect(JSON.stringify(connection)).not.toContain(credential.activeVersionId)
    expect(JSON.stringify(connection)).not.toContain(credential.activeVersion.secretRef)
    expect(JSON.stringify(connection)).not.toContain('raw-github-token')

    const upsertRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', approvalMode: 'none' }),
    })
    expect(upsertRes.status).toBe(200)
    await expect(upsertRes.json()).resolves.toMatchObject({ id: connection.id, approvalMode: 'none' })

    const toolsRes = await jsonFetch(`/api/mcp/connections/${connection.id}/tools`, authorization)
    expect(toolsRes.status).toBe(200)
    await expect(toolsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ connectorId: 'github', name: 'repo.read' })],
    })

    const readRes = await jsonFetch(`/api/mcp/connections/${connection.id}`, authorization)
    expect(readRes.status).toBe(200)
    const readConnection = await readRes.json()
    expect(readConnection).toMatchObject({ id: connection.id, hasCredential: true })
    expect(JSON.stringify(readConnection)).not.toContain(credential.id)
    expect(JSON.stringify(readConnection)).not.toContain(credential.activeVersionId)

    const clearCredentialRes = await jsonFetch(`/api/mcp/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ credentialId: null, credentialVersionId: null }),
    })
    expect(clearCredentialRes.status).toBe(400)

    const patchRes = await jsonFetch(`/api/mcp/connections/${connection.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ endpointUrl: 'https://mcp.example.test/github', status: 'disabled' }),
    })
    expect(patchRes.status).toBe(200)
    const patchedConnection = await patchRes.json()
    expect(patchedConnection).toMatchObject({
      id: connection.id,
      endpointUrl: 'https://mcp.example.test/github',
      status: 'disabled',
    })
    expect(JSON.stringify(patchedConnection)).not.toContain(credential.id)

    const invalidCursorRes = await jsonFetch('/api/mcp/connections?cursor=not-a-valid-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)

    const reconnectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github' }),
    })
    expect(reconnectRes.status).toBe(200)

    const disconnectRes = await jsonFetch(`/api/mcp/connections/${connection.id}?confirm=true`, authorization, {
      method: 'DELETE',
    })
    expect(disconnectRes.status).toBe(204)

    const auditRes = await jsonFetch('/api/audit-records?action=mcp_connection.disconnect', authorization)
    expect(auditRes.status).toBe(200)
    const audit = await auditRes.json()
    expect(JSON.stringify(audit)).not.toContain('raw-github-token')
    expect(JSON.stringify(audit)).not.toContain(credential.id)
    expect(JSON.stringify(audit)).not.toContain(credential.activeVersionId)
    expect(JSON.stringify(audit)).not.toContain(credential.activeVersion.secretRef)
    expect(JSON.stringify(audit)).toContain('mcp_connection.disconnect')
  })

  it('enforces tenant scoping for project connections', async () => {
    const authorization = await signInUser('tenant')
    const credential = await createCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const connection = (await connectRes.json()) as { id: string }

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_other_mcp',
      email: 'other-mcp@example.com',
      org_id: 'org_flare_other_mcp',
      org_name: 'Other MCP Org',
    })
    const otherListRes = await jsonFetch('/api/mcp/connections', otherCookie)
    expect(otherListRes.status).toBe(200)
    await expect(otherListRes.json()).resolves.toMatchObject({ data: [] })

    const otherReadRes = await jsonFetch(`/api/mcp/connections/${connection.id}`, otherCookie)
    expect(otherReadRes.status).toBe(404)
  })

  it('blocks unapproved runtime MCP calls and records policy events', async () => {
    const authorization = await signInUser('runtime_block')
    const session = await createSession(authorization)

    const runtimeRes = await jsonFetch(
      `/runtime/sessions/${session.id}/mcp/github/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(runtimeRes.status).toBe(403)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      error: { type: 'policy_denied', details: { category: 'mcp', resourceId: 'github' } },
    })

    const eventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    await expect(eventsRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          type: 'policy.decision',
          payload: expect.objectContaining({
            allowed: false,
            category: 'mcp',
            resourceType: 'mcp_connector',
            resourceId: 'github',
            ruleId: 'github',
            operation: 'mcp_tool_call',
          }),
          metadata: expect.objectContaining({ source: 'policy', sourceEventType: 'policy_denied' }),
        }),
      ],
    })

    const auditRes = await jsonFetch('/api/audit-records?action=runtime_mcp_tool.call', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          action: 'runtime_mcp_tool.call',
          outcome: 'denied',
          metadata: expect.objectContaining({ connectorId: 'github' }),
        }),
      ],
    })
  })

  it('accepts approved runtime MCP calls after policy evaluation', async () => {
    const authorization = await signInUser('runtime_allow_proxy')
    const credential = await createCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const session = await createSession(authorization)

    const runtimeRes = await jsonFetch(
      `/runtime/sessions/${session.id}/mcp/github/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(runtimeRes.status).toBe(200)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      runtime: 'ama-cloud',
      path: '/mcp/github/tools/repo.read/calls',
    })
  })

  it('blocks runtime MCP calls for unknown tools even when the connector is allowed', async () => {
    const authorization = await signInUser('runtime_unknown_tool')
    const credential = await createCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const session = await createSession(authorization, ['mcp:github'])

    const runtimeRes = await jsonFetch(
      `/runtime/sessions/${session.id}/mcp/github/tools/repo.delete/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(runtimeRes.status).toBe(403)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'MCP tool is not available for this connector.',
        details: { category: 'tool', resourceId: 'repo.delete' },
      },
    })
  })

  it('returns approval-required without executing MCP tool calls', async () => {
    const authorization = await signInUser('approval_required')
    const credential = await createCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const connection = (await connectRes.json()) as { id: string }
    const session = await createSession(authorization)

    const policyRes = await jsonFetch('/api/governance/policy', authorization, {
      method: 'PUT',
      body: JSON.stringify({ mcpPolicy: { requireApprovalConnectors: ['github'] } }),
    })
    expect(policyRes.status).toBe(200)

    const callRes = await jsonFetch(`/api/mcp/connections/${connection.id}/tools/repo.read/calls`, authorization, {
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

  it('allows approved tool calls, respects rotated and revoked credentials, and normalizes MCP errors', async () => {
    const authorization = await signInUser('runtime_allow')
    const credential = await createCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const connection = (await connectRes.json()) as { id: string }
    const session = await createSession(authorization)

    const callRes = await jsonFetch(`/api/mcp/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(200)
    await expect(callRes.json()).resolves.toMatchObject({
      status: 'success',
      connectorId: 'github',
      toolName: 'repo.read',
    })

    const vaultIdRes = await jsonFetch('/api/vaults', authorization)
    const vaultList = (await vaultIdRes.json()) as { data: Array<{ id: string }> }
    const vaultId = vaultList.data[0]?.id
    expect(vaultId).toBeTruthy()
    const rotateRes = await jsonFetch(`/api/vaults/${vaultId}/credentials/${credential.id}/versions`, authorization, {
      method: 'POST',
      body: JSON.stringify({ provider: 'cloudflare-secrets', secretValue: 'rotated-github-token' }),
    })
    expect(rotateRes.status).toBe(201)

    const rotatedCallRes = await jsonFetch(
      `/api/mcp/connections/${connection.id}/tools/repo.read/calls`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
      },
    )
    expect(rotatedCallRes.status).toBe(200)

    const errorRes = await jsonFetch(`/api/mcp/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        input: { simulateError: { type: 'timeout', token: 'raw-token' } },
      }),
    })
    expect(errorRes.status).toBe(502)
    const normalized = await errorRes.json()
    expect(normalized).toMatchObject({ error: { type: 'mcp_error', details: { mcpError: { type: 'mcp_timeout' } } } })
    expect(JSON.stringify(normalized)).not.toContain('raw-token')

    const revokeRes = await jsonFetch(`/api/vaults/${vaultId}/credentials/${credential.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'revoked', revokeReason: 'No longer approved.' }),
    })
    expect(revokeRes.status).toBe(200)

    const revokedCallRes = await jsonFetch(
      `/api/mcp/connections/${connection.id}/tools/repo.read/calls`,
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

  it('applies environment MCP connector restrictions during tool calls', async () => {
    const authorization = await signInUser('environment')
    const credential = await createCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const connection = (await connectRes.json()) as { id: string }
    const linearConnectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'linear', credentialId: credential.id }),
    })
    expect(linearConnectRes.status).toBe(201)

    const environmentRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Linear-only workspace',
        mcpPolicy: { allowedConnectors: ['linear'] },
      }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string }

    const agentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Environment MCP agent',
        allowedTools: ['mcp:github.repo.read'],
      }),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { id: string }
    const sessionRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { id: string }

    const callRes = await jsonFetch(`/api/mcp/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(403)
    await expect(callRes.json()).resolves.toMatchObject({
      error: { type: 'policy_denied', message: 'Environment does not allow this MCP connector.' },
    })
  })

  it('allows organization-scoped vault credentials for project MCP calls', async () => {
    const authorization = await signInUser('org_credential')
    const credential = await createOrganizationCredential(authorization)
    const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
      method: 'POST',
      body: JSON.stringify({ connectorId: 'github', credentialId: credential.id }),
    })
    expect(connectRes.status).toBe(201)
    const connection = (await connectRes.json()) as { id: string; hasCredential: boolean }
    expect(connection.hasCredential).toBe(true)

    const session = await createSession(authorization)
    const callRes = await jsonFetch(`/api/mcp/connections/${connection.id}/tools/repo.read/calls`, authorization, {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, input: { repo: 'saltbo/any-managed-agents' } }),
    })
    expect(callRes.status).toBe(200)
  })
})
