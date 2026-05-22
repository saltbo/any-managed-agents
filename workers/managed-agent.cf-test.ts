import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] ManagedAgent routing', () => {
  it('routes SDK Agent requests to a Durable Object instance', async () => {
    const res = await SELF.fetch('https://example.com/agents/managed-agent/cf-runtime-test/state')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      state: {
        status: 'idle',
      },
    })
  })
})
