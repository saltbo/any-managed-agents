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
})
