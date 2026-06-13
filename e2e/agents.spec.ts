import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: agents/api-crud] Create, read, update, version, archive, and list agents over the API.
test('creates an agent and round-trips it through read and list [spec: agents/api-crud]', async ({ api, runId }) => {
  // Create
  const createRes = await api.post('/api/v1/agents', {
    data: {
      name: `${runId} happy-path agent`,
      instructions: 'Answer with citations.',
      skills: ['ama@research'],
      role: 'maintainer',
      capabilityTags: ['issue-triage'],
      metadata: { owner: 'e2e' },
    },
  })
  expect(createRes.status(), 'POST /api/v1/agents').toBe(201)

  const created = (await createRes.json()) as Json
  expect(typeof created.id).toBe('string')
  expect((created.id as string).length).toBeGreaterThan(0)
  expect(typeof created.currentVersionId).toBe('string')
  expect((created.currentVersionId as string).length).toBeGreaterThan(0)
  expect(created.version).toBe(1)
  expect(created.archivedAt).toBeNull()

  const agentId = created.id as string

  // Read back
  const readRes = await api.get(`/api/v1/agents/${agentId}`)
  expect(readRes.status(), `GET /api/v1/agents/${agentId}`).toBe(200)

  const read = (await readRes.json()) as Json
  expect(read.id).toBe(agentId)
  expect(read.name).toBe(`${runId} happy-path agent`)
  expect(read.instructions).toBe('Answer with citations.')
  expect(read.skills).toEqual(['ama@research'])
  expect(read.role).toBe('maintainer')
  expect(read.capabilityTags).toEqual(['issue-triage'])
  expect(read.version).toBe(1)
  expect(read.archivedAt).toBeNull()
  expect(read.currentVersionId).toBe(created.currentVersionId)

  // List includes the new agent
  const listRes = await api.get('/api/v1/agents')
  expect(listRes.status(), 'GET /api/v1/agents').toBe(200)

  const list = (await listRes.json()) as { data: Json[]; pagination: Json }
  expect(Array.isArray(list.data)).toBe(true)
  expect(list.data.some((a) => a.id === agentId)).toBe(true)
  expect(typeof list.pagination.hasMore).toBe('boolean')
})
