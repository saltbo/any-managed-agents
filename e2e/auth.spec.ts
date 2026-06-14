import { expect, test } from './fixtures'

// [spec: auth/e2e-sign-in] Complete sign in across the real stack.
// The unauthenticated `request` fixture drives the OIDC callback endpoint
// directly (POST /auth/sessions), which the AMA_E2E_TEST_AUTH harness accepts.
test.describe('auth sign-in [spec: auth/e2e-sign-in]', () => {
  test('completes the OIDC callback: httpOnly session + resolved org/project/user', async ({ request }) => {
    const runId = `auth-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const res = await request.post('/api/v1/auth/sessions', { data: { accessToken: `e2e:${runId}` } })

    expect(res.status()).toBe(201)

    // AMA_SESSION_SECRET is configured in the e2e env — the cookie is always set.
    const setCookie = res.headers()['set-cookie'] ?? ''
    expect(setCookie).toContain('ama_session=')
    expect(setCookie.toLowerCase()).toContain('httponly')

    const body = await res.json()
    expect(body.user?.id).toBeTruthy()
    expect(body.user?.email).toBeTruthy()
    expect(body.organization?.id).toBeTruthy()
    expect(body.project?.id).toBeTruthy()
  })

  test('invalid OIDC callbacks return the standard oidc_error envelope', async ({ request }) => {
    const res = await request.post('/api/v1/auth/sessions', {
      data: { accessToken: 'invalid-token-that-cannot-be-validated' },
    })

    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error?.type).toBe('oidc_error')
    expect(body.error?.message).toBeTruthy()
  })
})
