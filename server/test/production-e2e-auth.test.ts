import { describe, expect, it } from 'vitest'
import { resolveProductionE2EAuth } from './production-e2e-auth'

describe('production e2e auth selection', () => {
  it('uses cookie auth first without parsing lower-precedence storage state', () => {
    const auth = resolveProductionE2EAuth({
      sessionCookie: '__Host-ama_session=cookie-secret',
      storageState: '{"cookies":',
      loginEmail: 'e2e@example.com',
      loginPassword: 'password-secret',
    })

    expect(auth.sessionCookie).toBe('__Host-ama_session=cookie-secret')
    expect(auth.storageState).toBeUndefined()
    expect(auth.hasPasswordLogin).toBe(true)
  })

  it('accepts secret-injected JSON storage state without a local file', () => {
    const auth = resolveProductionE2EAuth({
      storageState: JSON.stringify({
        cookies: [{ name: '__Host-ama_session', value: 'state-secret', domain: 'ama.tftt.cc', path: '/' }],
        origins: [],
      }),
    })

    expect(auth.storageState).toEqual({
      cookies: [{ name: '__Host-ama_session', value: 'state-secret', domain: 'ama.tftt.cc', path: '/' }],
      origins: [],
    })
  })

  it('accepts a storage-state file path for local operator runs', () => {
    const auth = resolveProductionE2EAuth({
      storageState: '.secrets/ama-storage-state.json',
    })

    expect(auth.storageState).toBe('.secrets/ama-storage-state.json')
  })

  it('reports invalid storage-state JSON without echoing the secret value', () => {
    expect(() =>
      resolveProductionE2EAuth({
        storageState: '{"cookies":[{"value":"do-not-print"}]',
      }),
    ).toThrow('AMA_E2E_STORAGE_STATE must be a file path or valid Playwright storage state JSON')
  })

  it('requires both email and password for password login', () => {
    expect(resolveProductionE2EAuth({ loginEmail: 'e2e@example.com' }).hasPasswordLogin).toBe(false)
    expect(
      resolveProductionE2EAuth({ loginEmail: 'e2e@example.com', loginPassword: 'password-secret' }).hasPasswordLogin,
    ).toBe(true)
  })
})
