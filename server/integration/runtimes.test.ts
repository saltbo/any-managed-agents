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
    await expect(res.json()).resolves.toEqual({
      data: [
        { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6', displayName: 'Kimi K2.6 (Workers AI)' },
        { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.7-code', displayName: 'Kimi K2.7 Code (Workers AI)' },
        { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (Workers AI)' },
      ],
    })
  })

  it('returns an empty catalog for self-hosted-only runtimes', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/runtimes/claude-code/models', authorization)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: [] })
  })
})
