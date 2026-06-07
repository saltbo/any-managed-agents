import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupOidcProvider, signIn } from '../test/auth'

describe('[CF] auth and tenancy', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not expose AMA auth helper routes', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/config')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        type: 'not_found',
        message: 'Not found',
      },
    })
  })

  it('lists organization projects from a bearer token without an auth context endpoint', async () => {
    const authorization = await signIn()
    const projectsRes = await SELF.fetch('https://example.com/api/projects', { headers: { authorization } })
    expect(projectsRes.status).toBe(200)
    await expect(projectsRes.json()).resolves.toMatchObject({
      data: [
        {
          organizationId: expect.stringMatching(/^org_/),
          name: 'Default project',
        },
      ],
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

  it('treats rejected OIDC provider bearer tokens as authentication failures', async () => {
    const res = await SELF.fetch('https://example.com/api/projects', {
      headers: { authorization: 'Bearer invalid-token' },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
        details: { reason: 'missing_or_invalid_bearer_token' },
      },
    })
  })

  it('scopes agent resources and runtime sessions to the OIDC provider organization project', async () => {
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
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
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
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
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
