import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderCatalogGateway } from './provider-catalog'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const openaiModelsPayload = {
  data: [
    { id: 'gpt-4o', display_name: 'GPT-4o', capabilities: ['text'], context_window: 128000, pricing: {} },
    { id: 'gpt-3.5-turbo', display_name: null, name: 'GPT-3.5', capabilities: [], context_window: null, pricing: {} },
  ],
}

const anthropicModelsPayload = {
  data: [
    { id: 'claude-opus-4', display_name: 'Claude Opus 4', capabilities: ['text'], context_window: 200000, pricing: {} },
  ],
}

const ollamaModelsPayload = {
  models: [{ name: 'llama3', model: 'llama3:latest', context_length: 8192 }],
}

describe('[spec: provider-catalog/gateway] createProviderCatalogGateway', () => {
  it('returns a gateway with a fetchCatalog method', () => {
    const gateway = createProviderCatalogGateway()
    expect(typeof gateway.fetchCatalog).toBe('function')
  })

  it('fetches the OpenAI model list from the default base URL', async () => {
    const fetchMock = makeFetch(openaiModelsPayload)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    const models = await gateway.fetchCatalog({ type: 'openai', baseUrl: null })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
    expect(models).toHaveLength(2)
    expect(models[0]?.modelId).toBe('gpt-4o')
    expect(models[0]?.displayName).toBe('GPT-4o')
    expect(models[0]?.contextWindow).toBe(128000)
  })

  it('fetches the Anthropic model list from the default base URL', async () => {
    const fetchMock = makeFetch(anthropicModelsPayload)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    const models = await gateway.fetchCatalog({ type: 'anthropic', baseUrl: null })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
    expect(models).toHaveLength(1)
    expect(models[0]?.modelId).toBe('claude-opus-4')
  })

  it('fetches Ollama model list from /api/tags instead of /models', async () => {
    const fetchMock = makeFetch(ollamaModelsPayload)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    const models = await gateway.fetchCatalog({ type: 'ollama', baseUrl: null })

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.any(Object))
    expect(models).toHaveLength(1)
    expect(models[0]?.modelId).toBe('llama3')
  })

  it('uses a custom baseUrl when provided, stripping trailing slash', async () => {
    const fetchMock = makeFetch(openaiModelsPayload)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    await gateway.fetchCatalog({ type: 'openai', baseUrl: 'https://my-proxy.example.com/v1/' })

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://my-proxy.example.com/v1/models')
  })

  it('throws when provider type has no known base URL and baseUrl is null', async () => {
    const gateway = createProviderCatalogGateway()
    await expect(gateway.fetchCatalog({ type: 'openai-compatible', baseUrl: null })).rejects.toThrow(
      /base URL is required/,
    )
  })

  it('throws on non-ok HTTP response with status in the error message', async () => {
    const fetchMock = makeFetch({ error: 'Unauthorized' }, 401)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    await expect(gateway.fetchCatalog({ type: 'openai', baseUrl: null })).rejects.toThrow(/401/)
  })

  it('passes the AbortSignal timeout option', async () => {
    const fetchMock = makeFetch(openaiModelsPayload)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    await gateway.fetchCatalog({ type: 'openai', baseUrl: null })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.signal).toBeDefined()
  })

  it('maps openai-compatible type through the default openai-compatible family (no default URL)', async () => {
    const gateway = createProviderCatalogGateway()
    await expect(gateway.fetchCatalog({ type: 'openai-compatible', baseUrl: null })).rejects.toThrow(
      /base URL is required/,
    )
  })

  it('uses the custom baseUrl for openai-compatible providers', async () => {
    const fetchMock = makeFetch(openaiModelsPayload)
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createProviderCatalogGateway()
    await gateway.fetchCatalog({ type: 'openai-compatible', baseUrl: 'https://custom.api.com/v1' })

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://custom.api.com/v1/models')
  })

  it('propagates fetch network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const gateway = createProviderCatalogGateway()
    await expect(gateway.fetchCatalog({ type: 'openai', baseUrl: null })).rejects.toThrow('fetch failed')
  })
})
