import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] GET /api/health', () => {
  it('returns the Worker health response', async () => {
    const res = await SELF.fetch('https://example.com/api/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: 'ok',
      name: 'Any Managed Agents',
      runtime: 'cloudflare-workers',
    })
  })
})
