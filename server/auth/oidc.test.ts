import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import { getBearerClaims, OidcError } from './oidc'

describe('OIDC bearer claim resolution', () => {
  it('requires a configured runner client for deterministic runner tokens', async () => {
    await expect(
      getBearerClaims({ AMA_E2E_TEST_AUTH: 'true', OIDC_CLIENT_ID: 'ama-test' } as Env, 'e2e-runner:missing-client'),
    ).rejects.toBeInstanceOf(OidcError)
  })
})
