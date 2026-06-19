import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { getBearerClaims, OidcError, organizationIdForClaims } from './oidc'

// Drives the real (non-e2e) claim path: userinfo fails, so getBearerClaims falls
// back to token introspection. Stubbing global fetch is the unit-suite pattern
// (see server/integration/auth.ts). OIDC_USE_SERVICE_BINDING='false' routes
// oidcFetch through global fetch instead of the OIDC_PROVIDER service binding.
const realPathEnv = {
  OIDC_ISSUER: 'https://id.test/api/auth',
  OIDC_CLIENT_ID: 'ama',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_USE_SERVICE_BINDING: 'false',
} as Env

function stubIntrospection(introspect: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith('/oauth2/introspect')) {
        return Response.json(introspect)
      }
      // userinfo (and everything else) fails so the introspection fallback runs.
      return new Response('unauthorized', { status: 401 })
    }),
  )
}

describe('[spec: auth/oidc-claims] OIDC bearer claim resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires a configured runner client for deterministic runner tokens', async () => {
    await expect(
      getBearerClaims({ AMA_E2E_TEST_AUTH: 'true', OIDC_CLIENT_ID: 'ama-test' } as Env, 'e2e-runner:missing-client'),
    ).rejects.toBeInstanceOf(OidcError)
  })

  it('rejects a token whose introspection has a client_id but no user subject', async () => {
    // A pure client_credentials token: active, identifies the calling app, but
    // names no user. It must fail closed, never become a `client:` tenant.
    stubIntrospection({ active: true, client_id: 'client_ak' })
    await expect(getBearerClaims(realPathEnv, 'client-credentials-token')).rejects.toBeInstanceOf(OidcError)
  })

  it('resolves a real user subject and never fabricates a client: identity', async () => {
    stubIntrospection({ active: true, sub: 'user_real', client_id: 'client_ak' })
    const claims = await getBearerClaims(realPathEnv, 'user-token')
    expect(claims.sub).toBe('user_real')
    // No org claim → personal-workspace tenant key, derived from the user sub.
    expect(organizationIdForClaims(claims)).toBe('user:user_real')
    // The client_id is passed through for audit but never elevated to a tenant.
    expect(JSON.stringify(claims)).not.toContain('client:')
  })

  it('binds a runner token from introspection (client_id = OIDC_RUNNER_CLIENT_ID) without calling userinfo', async () => {
    // A self-hosted runner's device-login token: userinfo would resolve the user
    // but drop client_id, so the runner row would bind to a null client and every
    // heartbeat would 403. Introspection reports client_id, so the runner path
    // must resolve from it directly and skip userinfo entirely.
    const runnerEnv = { ...realPathEnv, OIDC_RUNNER_CLIENT_ID: 'client_runner' } as Env
    let userinfoCalled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith('/oauth2/introspect')) {
          return Response.json({
            active: true,
            sub: 'user_runner',
            client_id: 'client_runner',
            scope: 'openid profile email offline_access',
          })
        }
        if (url.pathname.endsWith('/oauth2/userinfo')) {
          userinfoCalled = true
          return new Response('unauthorized', { status: 401 })
        }
        return new Response('not found', { status: 404 })
      }),
    )
    const claims = await getBearerClaims(runnerEnv, 'runner-device-token')
    expect(claims.sub).toBe('user_runner')
    expect(claims.client_id).toBe('client_runner')
    expect(claims.roles).toContain('runner')
    expect(userinfoCalled).toBe(false)
  })
})
