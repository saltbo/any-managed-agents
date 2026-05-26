import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFlareAuth, signIn } from '../test/auth'

describe('[CF] auth and tenancy', () => {
  beforeEach(async () => {
    await setupFlareAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns browser OIDC configuration without creating an AMA session', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/config')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      authority: 'https://flareauth.test',
      clientId: 'ama-test',
      redirectUri: 'https://example.com/auth/callback',
      postLogoutRedirectUri: 'https://example.com/',
      scope: 'openid email profile',
    })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('returns FlareAuth-backed user/org/project context from a bearer token', async () => {
    const authorization = await signIn()
    const meRes = await SELF.fetch('https://example.com/api/auth/me', { headers: { authorization } })
    expect(meRes.status).toBe(200)
    await expect(meRes.json()).resolves.toMatchObject({
      user: {
        email: expect.stringMatching(/@example\.com|@e2e\.example\.com/),
      },
      organization: {
        id: expect.stringMatching(/^org_/),
      },
      project: {
        name: 'Default project',
      },
      roles: ['owner'],
      permissions: ['*'],
    })
  })

  it('rejects protected APIs without a bearer token', async () => {
    const res = await SELF.fetch('https://example.com/api/agents')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
        details: { reason: 'missing_or_invalid_bearer_token' },
      },
    })
  })

  it('scopes agent resources and runtime sessions to the FlareAuth organization project', async () => {
    const authorization = await signIn()
    const createRes = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({ name: 'Research assistant', model: '@cf/moonshotai/kimi-k2.6' }),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { id: string; projectId: string }

    const environmentRes = await SELF.fetch('https://example.com/api/environments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({ name: 'Runtime environment' }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string }

    const sessionRes = await SELF.fetch('https://example.com/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as {
      durableObjectName: string
      runtimeEndpointPath: string
      projectId: string
    }
    expect(session.projectId).toBe(agent.projectId)
    expect(session.durableObjectName).toContain(`project_${agent.projectId}:session_`)

    const runtimeRes = await SELF.fetch(`https://example.com${session.runtimeEndpointPath}`, {
      method: 'POST',
      headers: { authorization },
    })
    expect(runtimeRes.status).toBe(200)
  })

  it('does not forward runtime requests across projects', async () => {
    const tenantA = await signIn({
      sub: 'user_a',
      email: 'a@example.com',
      name: 'A',
      org_id: 'org_a',
      org_name: 'Org A',
      roles: ['owner'],
      permissions: ['*'],
    })
    const agentRes = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: tenantA },
      body: JSON.stringify({ name: 'Tenant A agent' }),
    })
    const agent = (await agentRes.json()) as { id: string }
    const environmentRes = await SELF.fetch('https://example.com/api/environments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: tenantA },
      body: JSON.stringify({ name: 'Tenant A environment' }),
    })
    const environment = (await environmentRes.json()) as { id: string }
    const sessionRes = await SELF.fetch('https://example.com/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: tenantA },
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const session = (await sessionRes.json()) as { runtimeEndpointPath: string }

    const tenantB = await signIn({
      sub: 'user_b',
      email: 'b@example.com',
      name: 'B',
      org_id: 'org_b',
      org_name: 'Org B',
      roles: ['owner'],
      permissions: ['*'],
    })
    const runtimeRes = await SELF.fetch(`https://example.com${session.runtimeEndpointPath}`, {
      method: 'POST',
      headers: { authorization: tenantB },
    })
    expect(runtimeRes.status).toBe(404)
  })
})
