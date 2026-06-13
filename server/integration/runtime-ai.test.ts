import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] POST /api/v1/runtime/workers-ai/v1/chat/completions', () => {
  it('rejects sandbox proxy requests without the runtime proxy token', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/runtime/workers-ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: '@cf/moonshotai/kimi-k2.6', messages: [] }),
    })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Runtime Workers AI proxy authentication failed',
      },
    })
  })
})
