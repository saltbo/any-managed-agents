import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] ManagedAgent routing', () => {
  it('rejects SDK Agent requests without an AMA session', async () => {
    const res = await SELF.fetch('https://example.com/agents/managed-agent/cf-runtime-test/state')

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'authentication_required',
      },
    })
  })
})
