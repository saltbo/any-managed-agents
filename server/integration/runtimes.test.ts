import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectAuthRequired, setupOidcProvider, signIn } from './auth'

async function jsonFetch(path: string, authorization: string | null, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
      ...init.headers,
    },
  })
}

describe('[CF] v1 runtime models', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const res = await jsonFetch('/api/v1/runtimes/ama/models', null)
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('lists the ama cloud models with their display names', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/runtimes/ama/models', authorization)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: Array<{ provider: string; model: string; displayName?: string }> }
    // Default (data[0]) is the proven working model; every entry is a concrete WAI model with a label.
    expect(json.data[0]).toEqual({
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.7-code',
      displayName: 'Kimi K2.7 Code (Workers AI)',
    })
    expect(json.data.length).toBeGreaterThanOrEqual(3)
    expect(json.data.every((m) => m.provider === 'workers-ai' && m.model.startsWith('@cf/') && !!m.displayName)).toBe(true)
  })

  it('returns an empty catalog for self-hosted-only runtimes', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/runtimes/claude-code/models', authorization)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: [] })
  })
})
