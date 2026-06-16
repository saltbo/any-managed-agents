import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderCatalogGateway } from './provider-catalog'

afterEach(() => {
  vi.unstubAllGlobals()
})

// models.dev shape: native @cf models live under cloudflare-workers-ai (full
// @cf/... ids), third-party under anthropic/openai (bare ids).
const modelsDevPayload = {
  'cloudflare-workers-ai': {
    models: {
      '@cf/moonshotai/kimi-k2.6': { tool_call: true, limit: { context: 262144 }, cost: { input: 0.6, output: 3 } },
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { tool_call: true }, // denylisted
      '@cf/baai/bge-m3': { tool_call: false }, // non-tool, dropped
    },
  },
  anthropic: {
    models: {
      'claude-opus-4': {
        name: 'Claude Opus 4',
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'] },
        limit: { context: 200000 },
        cost: { input: 15, output: 75 },
      },
      'claude-instant-legacy': { name: 'Claude Instant', tool_call: false },
    },
  },
  google: {
    models: { 'gemini-pro': { name: 'Gemini Pro', tool_call: true } }, // not in the allowlist
  },
}

function stubModelsDev(response: Response) {
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('[spec: provider-catalog/gateway] createProviderCatalogGateway', () => {
  it('exposes a fetchPlatformCatalog method', () => {
    expect(typeof createProviderCatalogGateway().fetchPlatformCatalog).toBe('function')
  })

  it('fetches the models.dev catalog with no credential', async () => {
    const fetchMock = stubModelsDev(jsonResponse(modelsDevPayload))
    await createProviderCatalogGateway().fetchPlatformCatalog()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://models.dev/api.json')
  })

  it('maps cloudflare-workers-ai (@cf native) and the third-party allowlist, dropping the rest', async () => {
    stubModelsDev(jsonResponse(modelsDevPayload))
    const ids = (await createProviderCatalogGateway().fetchPlatformCatalog()).map((model) => model.modelId)
    expect(ids).toContain('@cf/moonshotai/kimi-k2.6')
    expect(ids).toContain('anthropic/claude-opus-4')
    // denylisted @cf id, non-tool entries, and out-of-allowlist google are dropped
    expect(ids).not.toContain('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
    expect(ids).not.toContain('@cf/baai/bge-m3')
    expect(ids).not.toContain('anthropic/claude-instant-legacy')
    expect(ids).not.toContain('google/gemini-pro')
  })

  it('maps a native @cf row with native serving and the vendor from the id', async () => {
    stubModelsDev(jsonResponse(modelsDevPayload))
    const models = await createProviderCatalogGateway().fetchPlatformCatalog()
    expect(models.find((model) => model.modelId === '@cf/moonshotai/kimi-k2.6')).toMatchObject({
      vendor: 'moonshotai',
      serving: 'workers-ai-native',
      contextWindow: 262144,
      pricing: { inputMicrosPerToken: 0.6, outputMicrosPerToken: 3 },
    })
  })

  it('maps a third-party row through AI Gateway with the vendor prefix', async () => {
    stubModelsDev(jsonResponse(modelsDevPayload))
    const models = await createProviderCatalogGateway().fetchPlatformCatalog()
    expect(models.find((model) => model.modelId === 'anthropic/claude-opus-4')).toMatchObject({
      vendor: 'anthropic',
      serving: 'ai-gateway',
      displayName: 'Claude Opus 4',
      capabilities: ['text', 'tools', 'vision', 'reasoning'],
    })
  })

  it('returns an empty catalog when models.dev has none of the known providers', async () => {
    stubModelsDev(jsonResponse({ requesty: { models: {} } }))
    expect(await createProviderCatalogGateway().fetchPlatformCatalog()).toEqual([])
  })

  it('throws with the HTTP status when models.dev returns non-ok', async () => {
    stubModelsDev(jsonResponse({ error: 'down' }, 503))
    await expect(createProviderCatalogGateway().fetchPlatformCatalog()).rejects.toThrow(/HTTP 503/)
  })
})
