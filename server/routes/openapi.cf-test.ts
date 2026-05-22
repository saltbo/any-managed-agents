import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('[CF] OpenAPI documentation', () => {
  it('publishes the generated control-plane OpenAPI document', async () => {
    const res = await SELF.fetch('https://example.com/api/openapi.json')

    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      paths: Record<string, unknown>
      components?: { schemas?: Record<string, unknown> }
    }

    expect(doc.openapi).toBe('3.0.0')
    expect(doc.paths).toHaveProperty('/api/health')
    expect(doc.paths).toHaveProperty('/api/agents')
    expect(doc.paths).toHaveProperty('/api/agents/{agentId}/sessions')
    expect(doc.components?.schemas).toHaveProperty('CreateAgentRequest')
    expect(doc.components?.schemas).toHaveProperty('Agent')
    expect(doc.components?.schemas).toHaveProperty('Session')
  })

  it('serves interactive API docs', async () => {
    const res = await SELF.fetch('https://example.com/api/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('/api/openapi.json')
  })
})
