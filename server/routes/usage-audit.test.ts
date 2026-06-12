import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usageRecords } from '../db/schema'
import { setupOidcProvider, signIn } from '../test/auth'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

async function authContext(authorization: string) {
  const res = await jsonFetch('/api/projects', authorization)
  expect(res.status).toBe(200)
  const projects = (await res.json()) as { data: Array<{ id: string; organizationId: string }> }
  const project = projects.data[0]
  if (!project) throw new Error('expected a default project')
  return project
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function usageRow(project: { id: string; organizationId: string }, values: Partial<typeof usageRecords.$inferInsert>) {
  return {
    id: newId('usage'),
    organizationId: project.organizationId,
    projectId: project.id,
    agentId: 'agent_alpha',
    agentVersionId: 'agentver_alpha',
    sessionId: 'session_alpha',
    sessionEventId: newId('event'),
    correlationId: newId('corr'),
    providerId: 'workers-ai',
    providerType: 'workers-ai',
    modelId: '@cf/model-a',
    status: 'success',
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    durationMs: 100,
    costMicros: 25,
    currency: 'USD',
    usageType: 'model',
    metadata: '{}',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...values,
  }
}

describe('[CF] usage export and audit record detail', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exports grouped usage summaries as JSON honoring summary filters', async () => {
    const authorization = await signIn()
    const project = await authContext(authorization)
    const db = drizzle(env.DB)
    await db
      .insert(usageRecords)
      .values([
        usageRow(project, {}),
        usageRow(project, { sessionId: 'session_beta', totalTokens: 2, promptTokens: 2, completionTokens: 0 }),
        usageRow(project, { providerType: 'sandbox', modelId: 'sandbox.exec', usageType: 'tool' }),
      ])

    const res = await jsonFetch('/api/usage/export?provider=workers-ai&groupBy=provider,model,session', authorization)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const exported = (await res.json()) as {
      totals: { records: number; totalTokens: number }
      groups: Array<{ key: Record<string, string>; records: number; costMicros: number; currency: string }>
    }
    expect(exported.totals).toMatchObject({ records: 2, totalTokens: 17 })
    expect(exported.groups).toEqual([
      expect.objectContaining({
        key: { provider: 'workers-ai', model: '@cf/model-a', session: 'session_alpha' },
        records: 1,
        costMicros: 25,
        currency: 'USD',
      }),
      expect.objectContaining({
        key: { provider: 'workers-ai', model: '@cf/model-a', session: 'session_beta' },
        records: 1,
      }),
    ])
  })

  it('exports grouped usage summaries as CSV rows', async () => {
    const authorization = await signIn()
    const project = await authContext(authorization)
    const db = drizzle(env.DB)
    await db.insert(usageRecords).values([usageRow(project, {})])

    const res = await jsonFetch('/api/usage/export?groupBy=provider,model&format=csv', authorization)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('usage-export.csv')
    const lines = (await res.text()).split('\n')
    expect(lines[0]).toBe(
      'provider,model,records,promptTokens,completionTokens,totalTokens,durationMs,costMicros,currency',
    )
    expect(lines[1]).toBe('workers-ai,@cf/model-a,1,10,5,15,100,25,USD')
  })

  it('reads a single audit record scoped to the organization and 404s unknown ids', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'openai',
        displayName: 'OpenAI Audit Detail',
        metadata: { apiKey: 'top-secret-credential' },
      }),
    })
    expect(createRes.status).toBe(201)

    const listRes = await jsonFetch('/api/audit-records?action=provider.create', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    const recordId = list.data[0]?.id
    expect(recordId).toBeTruthy()

    const readRes = await jsonFetch(`/api/audit-records/${recordId}`, authorization)
    expect(readRes.status).toBe(200)
    const record = (await readRes.json()) as { id: string; action: string; after: Record<string, unknown> }
    expect(record.id).toBe(recordId)
    expect(record.action).toBe('provider.create')
    expect(JSON.stringify(record)).not.toContain('top-secret-credential')

    const missingRes = await jsonFetch('/api/audit-records/audit_does_not_exist', authorization)
    expect(missingRes.status).toBe(404)
  })
})
