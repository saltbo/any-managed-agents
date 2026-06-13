import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: mcp/catalog] The MCP connector catalogue is a happy read — no
// live MCP server is needed; connecting to one is exercised at cheaper layers.
test('lists the MCP connector catalogue and reads a connector by id [spec: mcp/catalog]', async ({ api }) => {
  const listRes = await api.get('/api/v1/connectors')
  expect(listRes.status(), 'GET /api/v1/connectors').toBe(200)
  const list = (await listRes.json()) as { data: Json[]; pagination: Json }
  expect(Array.isArray(list.data)).toBe(true)
  expect(list.pagination).toBeTruthy()

  const github = list.data.find((row) => row.id === 'github')
  expect(github, 'the seeded github connector is in the catalogue').toBeTruthy()

  const detailRes = await api.get('/api/v1/connectors/github')
  expect(detailRes.status(), 'GET /api/v1/connectors/github').toBe(200)
  const detail = (await detailRes.json()) as Json
  expect(detail.id).toBe('github')
})
