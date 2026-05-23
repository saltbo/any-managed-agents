import { SELF } from 'cloudflare:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface TestClaims {
  sub: string
  email: string
  name: string
  org_id: string
  org_name: string
  roles: string[]
  permissions: string[]
}

let currentClaims: TestClaims
let malformedUserinfo: boolean
let currentNonce: string
let privateKey: CryptoKey
let publicJwk: JsonWebKey

function defaultClaims(): TestClaims {
  return {
    sub: 'user_123',
    email: 'user@example.com',
    name: 'Ada Lovelace',
    org_id: 'org_flare_123',
    org_name: 'Example Org',
    roles: ['owner'],
    permissions: ['agents:write', 'agents:read'],
  }
}

function mockFlareAuth() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())

      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: 'https://flareauth.test',
          authorization_endpoint: 'https://flareauth.test/oauth/authorize',
          token_endpoint: 'https://flareauth.test/oauth/token',
          userinfo_endpoint: 'https://flareauth.test/oauth/userinfo',
          jwks_uri: 'https://flareauth.test/oauth/jwks',
        })
      }

      if (url.pathname === '/oauth/jwks') {
        return Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })
      }

      if (url.pathname === '/oauth/token') {
        expect(init?.method).toBe('POST')
        const body = init?.body as URLSearchParams
        expect(body.get('grant_type')).toBe('authorization_code')
        expect(body.get('client_id')).toBe('ama-test')
        expect(body.get('code_verifier')).toBeTruthy()
        return Response.json({
          access_token: 'flareauth-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: await createIdToken(),
        })
      }

      if (url.pathname === '/oauth/userinfo') {
        expect(init?.headers).toMatchObject({ authorization: 'Bearer flareauth-access-token' })
        if (malformedUserinfo) {
          return new Response('{', { headers: { 'content-type': 'application/json' } })
        }
        return Response.json(currentClaims)
      }

      return new Response('not found', { status: 404 })
    }),
  )
}

async function createIdToken() {
  return new SignJWT({ nonce: currentNonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://flareauth.test')
    .setSubject(currentClaims.sub)
    .setAudience('ama-test')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

async function startLogin() {
  const loginRes = await SELF.fetch('https://example.com/api/auth/login?returnTo=/dashboard', {
    redirect: 'manual',
  })
  expect(loginRes.status).toBe(302)

  const loginCookie = loginRes.headers.get('set-cookie')
  expect(loginCookie).toContain('__Host-ama_oidc=')

  const location = loginRes.headers.get('location')
  expect(location).toBeTruthy()
  const authorizationUrl = new URL(location ?? '')
  const state = authorizationUrl.searchParams.get('state')
  currentNonce = authorizationUrl.searchParams.get('nonce') ?? ''
  expect(state).toBeTruthy()
  expect(currentNonce).toBeTruthy()
  return { loginCookie, state }
}

async function signIn(claims = defaultClaims()) {
  currentClaims = claims
  const { loginCookie, state } = await startLogin()

  const callbackRes = await SELF.fetch(`https://example.com/api/auth/callback?code=valid-code&state=${state}`, {
    headers: { cookie: cookiePair(loginCookie, '__Host-ama_oidc') },
    redirect: 'manual',
  })
  if (callbackRes.status !== 302) {
    throw new Error(await callbackRes.text())
  }
  expect(callbackRes.status).toBe(302)
  expect(callbackRes.headers.get('location')).toBe('/dashboard')

  const sessionCookie = callbackRes.headers.get('set-cookie')
  expect(sessionCookie).toContain('__Host-ama_session=')
  expect(sessionCookie).toContain('HttpOnly')
  expect(sessionCookie).toContain('Secure')
  expect(sessionCookie).toContain('SameSite=Lax')
  return cookiePair(sessionCookie, '__Host-ama_session')
}

function cookiePair(setCookie: string | null, name: string) {
  const match = setCookie?.match(new RegExp(`${name}=[^;,]*`))
  return match?.[0] ?? ''
}

describe('[CF] auth and tenancy', () => {
  beforeEach(async () => {
    const keyPair = await generateKeyPair('RS256')
    privateKey = keyPair.privateKey
    publicJwk = await exportJWK(keyPair.publicKey)
    currentClaims = defaultClaims()
    malformedUserinfo = false
    currentNonce = ''
    mockFlareAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates an httpOnly session and returns safe user/org/project context', async () => {
    const cookie = await signIn()

    const meRes = await SELF.fetch('https://example.com/api/auth/me', {
      headers: { cookie },
    })
    expect(meRes.status).toBe(200)
    await expect(meRes.json()).resolves.toMatchObject({
      user: {
        email: 'user@example.com',
        name: 'Ada Lovelace',
      },
      organization: {
        name: 'Example Org',
      },
      project: {
        name: 'Default project',
      },
      roles: ['owner'],
      permissions: ['agents:write', 'agents:read'],
    })
  })

  it('rejects protected APIs without a valid AMA session', async () => {
    const res = await SELF.fetch('https://example.com/api/agents')

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('returns a stable error envelope for invalid OIDC callbacks', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/callback?code=valid-code&state=wrong-state', {
      redirect: 'manual',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'oidc_error',
        message: 'Invalid OIDC callback',
      },
    })
  })

  it('delegates callback state validation to the OIDC client', async () => {
    const { loginCookie } = await startLogin()

    const res = await SELF.fetch('https://example.com/api/auth/callback?code=valid-code&state=wrong-state', {
      headers: { cookie: cookiePair(loginCookie, '__Host-ama_oidc') },
      redirect: 'manual',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'oidc_error',
        message: 'Invalid OIDC callback',
      },
    })
  })

  it('returns a stable error envelope for invalid FlareAuth callback claims', async () => {
    const { loginCookie, state } = await startLogin()
    currentClaims = { ...defaultClaims(), org_id: '' }

    const res = await SELF.fetch(`https://example.com/api/auth/callback?code=valid-code&state=${state}`, {
      headers: { cookie: cookiePair(loginCookie, '__Host-ama_oidc') },
      redirect: 'manual',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'oidc_error',
        message: 'Invalid OIDC callback',
      },
    })
  })

  it('returns a stable error envelope for malformed FlareAuth JSON responses', async () => {
    const { loginCookie, state } = await startLogin()
    malformedUserinfo = true

    const res = await SELF.fetch(`https://example.com/api/auth/callback?code=valid-code&state=${state}`, {
      headers: { cookie: cookiePair(loginCookie, '__Host-ama_oidc') },
      redirect: 'manual',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'oidc_error',
        message: 'Invalid OIDC callback',
      },
    })
  })

  it('clears and revokes the AMA session on logout', async () => {
    const cookie = await signIn()

    const logoutRes = await SELF.fetch('https://example.com/api/auth/logout', {
      method: 'POST',
      headers: { cookie },
    })
    expect(logoutRes.status).toBe(204)
    expect(logoutRes.headers.get('set-cookie')).toContain('__Host-ama_session=;')

    const meRes = await SELF.fetch('https://example.com/api/auth/me', {
      headers: { cookie },
    })
    expect(meRes.status).toBe(401)
  })

  it('scopes agent resources and runtime sessions to the signed-in project', async () => {
    const cookie = await signIn()

    const createRes = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Research assistant',
        model: '@cf/moonshotai/kimi-k2.6',
      }),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { id: string; projectId: string }
    expect(agent.projectId).toMatch(/^project_/)

    const listRes = await SELF.fetch('https://example.com/api/agents', {
      headers: { cookie },
    })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { data: Array<{ id: string; projectId: string }> }
    expect(listBody.data).toContainEqual(expect.objectContaining({ id: agent.id, projectId: agent.projectId }))
    expect(listBody.data.every((row) => row.projectId === agent.projectId)).toBe(true)

    const sessionRes = await SELF.fetch(`https://example.com/api/agents/${agent.id}/sessions`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { durableObjectName: string; agentUrl: string; projectId: string }
    expect(session.projectId).toBe(agent.projectId)
    expect(session.durableObjectName).toContain(`project_${agent.projectId}:session_`)
    expect(session.agentUrl).toBe(`/agents/managed-agent/${session.durableObjectName}`)

    const runtimeRes = await SELF.fetch(`https://example.com${session.agentUrl}/state`, {
      headers: { cookie },
    })
    expect(runtimeRes.status).toBe(200)
  })

  it('does not forward runtime requests across projects', async () => {
    const tenantACookie = await signIn(defaultClaims())
    const createRes = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: tenantACookie },
      body: JSON.stringify({ name: 'Tenant A agent' }),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { id: string }

    const sessionRes = await SELF.fetch(`https://example.com/api/agents/${agent.id}/sessions`, {
      method: 'POST',
      headers: { cookie: tenantACookie },
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { agentUrl: string }

    const tenantBCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })
    const runtimeRes = await SELF.fetch(`https://example.com${session.agentUrl}/state`, {
      headers: { cookie: tenantBCookie },
    })

    expect(runtimeRes.status).toBe(404)
    expect(await runtimeRes.json()).toMatchObject({
      error: {
        type: 'not_found',
      },
    })
  })
})
