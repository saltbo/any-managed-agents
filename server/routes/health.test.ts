import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { healthResponse } from './health'

describe('[CF] GET /api/health', () => {
  it('returns the Worker health response', async () => {
    const res = await SELF.fetch('https://example.com/api/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: 'ok',
      name: 'Any Managed Agents',
      runtime: 'cloudflare-workers',
      oidcIssuer: 'https://oidc.test',
      runnerClientId: 'ama-runner-test',
      runnerScopes: 'openid profile email offline_access ama:runner',
    })
  })

  it('does not publish runner device-login metadata without a dedicated runner client', () => {
    expect(
      healthResponse({
        OIDC_ISSUER: 'https://oidc.test/',
        OIDC_RUNNER_SCOPES: 'openid profile email offline_access ama:runner',
      }),
    ).toMatchObject({
      oidcIssuer: 'https://oidc.test',
      runnerClientId: null,
      runnerScopes: null,
    })
  })
})
