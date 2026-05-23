import { SELF } from 'cloudflare:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, vi } from 'vitest'

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
let currentNonce = ''
let privateKey: CryptoKey
let publicJwk: JsonWebKey

export function defaultClaims(): TestClaims {
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

export async function setupFlareAuth() {
  const keyPair = await generateKeyPair('RS256')
  privateKey = keyPair.privateKey
  publicJwk = await exportJWK(keyPair.publicKey)
  currentClaims = defaultClaims()
  currentNonce = ''

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
        const body = init?.body as URLSearchParams
        expect(body.get('grant_type')).toBe('authorization_code')
        return Response.json({
          access_token: 'flareauth-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: await createIdToken(),
        })
      }

      if (url.pathname === '/oauth/userinfo') {
        return Response.json(currentClaims)
      }

      return new Response('not found', { status: 404 })
    }),
  )
}

export async function signIn(claims = defaultClaims()) {
  currentClaims = claims
  const loginRes = await SELF.fetch('https://example.com/api/auth/login?returnTo=/dashboard', { redirect: 'manual' })
  expect(loginRes.status).toBe(302)

  const loginCookie = loginRes.headers.get('set-cookie')
  const location = loginRes.headers.get('location')
  expect(location).toBeTruthy()

  const authorizationUrl = new URL(location ?? '')
  const state = authorizationUrl.searchParams.get('state')
  currentNonce = authorizationUrl.searchParams.get('nonce') ?? ''
  expect(state).toBeTruthy()
  expect(currentNonce).toBeTruthy()

  const callbackRes = await SELF.fetch(`https://example.com/api/auth/callback?code=valid-code&state=${state}`, {
    headers: { cookie: cookiePair(loginCookie, '__Host-ama_oidc') },
    redirect: 'manual',
  })
  if (callbackRes.status !== 302) {
    throw new Error(await callbackRes.text())
  }

  return cookiePair(callbackRes.headers.get('set-cookie'), '__Host-ama_session')
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

function cookiePair(setCookie: string | null, name: string) {
  const match = setCookie?.match(new RegExp(`${name}=[^;,]*`))
  return match?.[0] ?? ''
}
