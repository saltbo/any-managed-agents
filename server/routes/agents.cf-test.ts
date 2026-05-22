import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] /api/agents', () => {
  it('returns the stable error envelope for validation failures', async () => {
    const res = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'validation_error',
        message: 'Invalid request',
      },
    })
  })

  it('persists agent definitions and creates sessions through D1', async () => {
    const createRes = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Research assistant',
        model: '@cf/meta/llama-3.1-8b-instruct',
        systemPrompt: 'Answer with citations.',
      }),
    })

    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { id: string; name: string }
    expect(agent.id).toMatch(/^agent_/)
    expect(agent.name).toBe('Research assistant')

    const listRes = await SELF.fetch('https://example.com/api/agents')
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(listBody.data.some((row) => row.id === agent.id)).toBe(true)

    const sessionRes = await SELF.fetch(`https://example.com/api/agents/${agent.id}/sessions`, {
      method: 'POST',
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { id: string; agentUrl: string }
    expect(session.id).toMatch(/^session_/)
    expect(session.agentUrl).toBe(`/agents/managed-agent/${session.id}`)
  })
})
