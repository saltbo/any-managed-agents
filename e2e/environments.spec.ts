import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: environments/api-crud] Manage project environments through the API.
test('creates an environment and round-trips it through read and list [spec: environments/api-crud]', async ({
  api,
  runId,
}) => {
  // Create
  const createRes = await api.post('/api/v1/environments', {
    data: {
      name: `${runId} happy-path env`,
      description: 'E2E happy-path environment.',
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: { NODE_ENV: { description: 'Runtime mode' } },
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      resourceLimits: { memoryMb: 512 },
      runtimeConfig: { image: 'ama-pi-runtime' },
      metadata: { owner: 'e2e' },
    },
  })
  expect(createRes.status(), 'POST /api/v1/environments').toBe(201)

  const created = (await createRes.json()) as Json
  expect(typeof created.id).toBe('string')
  expect((created.id as string).length).toBeGreaterThan(0)
  expect(typeof created.currentVersionId).toBe('string')
  expect((created.currentVersionId as string).length).toBeGreaterThan(0)
  expect(created.version).toBe(1)
  expect(created.archivedAt).toBeNull()

  const environmentId = created.id as string

  // Read back — assert runtimeConfig round-trips
  const readRes = await api.get(`/api/v1/environments/${environmentId}`)
  expect(readRes.status(), `GET /api/v1/environments/${environmentId}`).toBe(200)

  const read = (await readRes.json()) as Json
  expect(read.id).toBe(environmentId)
  expect(read.name).toBe(`${runId} happy-path env`)
  expect(read.description).toBe('E2E happy-path environment.')
  expect(read.version).toBe(1)
  expect(read.archivedAt).toBeNull()
  expect(read.currentVersionId).toBe(created.currentVersionId)
  expect(read.hostingMode).toBe('cloud')

  const runtimeConfig = read.runtimeConfig as Json
  expect(runtimeConfig.image).toBe('ama-pi-runtime')

  const networkPolicy = read.networkPolicy as Json
  expect(networkPolicy.mode).toBe('restricted')
  expect(networkPolicy.allowedHosts as string[]).toContain('registry.npmjs.org')

  // List includes the new environment
  const listRes = await api.get('/api/v1/environments')
  expect(listRes.status(), 'GET /api/v1/environments').toBe(200)

  const list = (await listRes.json()) as { data: Json[]; pagination: Json }
  expect(Array.isArray(list.data)).toBe(true)
  expect(list.data.some((e) => e.id === environmentId)).toBe(true)
  expect(typeof list.pagination.hasMore).toBe('boolean')
})
