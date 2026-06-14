import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: providers/api-crud]
test('creates a provider and lists it back [spec: providers/api-crud]', async ({ api, runId }) => {
  const createRes = await api.post('/api/v1/providers', {
    data: {
      type: 'openai-compatible',
      displayName: `${runId} gateway`,
      baseUrl: 'https://models.example.test/v1',
      isDefault: false,
    },
  })
  expect(createRes.status(), 'POST /api/v1/providers').toBe(201)
  const provider = (await createRes.json()) as Json
  expect(typeof provider.id).toBe('string')
  expect(provider.type).toBe('openai-compatible')
  expect(provider.displayName).toBe(`${runId} gateway`)
  expect(provider.enabled).toBe(true)
  expect(provider.credentialStatus).toBe('missing')
  expect(provider.modelCatalogState).toBe('ready')
  expect(provider.lastError).toBeNull()

  const listRes = await api.get('/api/v1/providers')
  expect(listRes.status(), 'GET /api/v1/providers').toBe(200)
  const list = (await listRes.json()) as { data: Json[] }
  expect(list.data.some((row) => row.id === provider.id)).toBe(true)
})

// [spec: providers/api-models]
test('upserts a model onto a provider and lists it back [spec: providers/api-models]', async ({ api, runId }) => {
  const createRes = await api.post('/api/v1/providers', {
    data: {
      type: 'openai',
      displayName: `${runId} model host`,
    },
  })
  expect(createRes.status(), 'POST /api/v1/providers').toBe(201)
  const provider = (await createRes.json()) as Json
  const providerId = provider.id as string

  const modelId = `${runId}-text-model`
  const putRes = await api.put(`/api/v1/providers/${providerId}/models/${encodeURIComponent(modelId)}`, {
    data: { displayName: 'Text Model', capabilities: ['text'], contextWindow: 8000 },
  })
  expect(putRes.status(), `PUT /api/v1/providers/${providerId}/models/${modelId}`).toBe(201)
  const model = (await putRes.json()) as Json
  expect(model.modelId).toBe(modelId)
  expect(model.providerId).toBe(providerId)
  expect(model.displayName).toBe('Text Model')

  const listModelsRes = await api.get(`/api/v1/providers/${providerId}/models`)
  expect(listModelsRes.status(), `GET /api/v1/providers/${providerId}/models`).toBe(200)
  const modelList = (await listModelsRes.json()) as { data: Json[] }
  expect(modelList.data.some((row) => row.modelId === modelId)).toBe(true)
})
