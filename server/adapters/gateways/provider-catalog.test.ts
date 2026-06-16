import type { Env } from '@server/env'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderCatalogGateway } from './provider-catalog'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WORKERS_AI_SEARCH_HOST = 'https://api.cloudflare.com/client/v4/accounts/'
const MODELS_DEV_URL = 'https://models.dev/api.json'

// A native @cf Text Generation model flagged function_calling=true — the only
// shape catalogModelFromWorkersAi keeps.
const workersAiModel = {
  name: '@cf/meta/llama-3.1-8b-instruct',
  task: { name: 'Text Generation' },
  properties: [
    { property_id: 'function_calling', value: 'true' },
    { property_id: 'context_window', value: '128000' },
    {
      property_id: 'price',
      value: [
        { unit: 'per M input tokens', price: 0.03 },
        { unit: 'per M output tokens', price: 0.2 },
      ],
    },
  ],
}

// A non-tool-calling model the gateway drops (filtered by the domain mapper).
const workersAiNonToolModel = {
  name: '@cf/meta/llama-2-7b-chat-int8',
  task: { name: 'Text Generation' },
  properties: [{ property_id: 'function_calling', value: 'false' }],
}

const workersAiPayload = { result: [workersAiModel, workersAiNonToolModel] }

// models.dev: one tool-calling anthropic model, one non-tool entry that is dropped.
const modelsDevPayload = {
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
      'claude-instant-legacy': {
        name: 'Claude Instant Legacy',
        tool_call: false,
      },
    },
  },
  google: {
    models: {
      'gemini-pro': { name: 'Gemini Pro', tool_call: true },
    },
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Routes the two discovery calls to their feed payloads by URL.
function stubFeeds(workersAi: Response, modelsDev: Response) {
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(WORKERS_AI_SEARCH_HOST)) {
      return workersAi
    }
    if (url === MODELS_DEV_URL) {
      return modelsDev
    }
    throw new Error(`unexpected fetch url ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function env(overrides: Record<string, unknown> = {}): Env {
  return {
    AMA_WORKERS_AI_ACCOUNT_ID: 'acct_123',
    AMA_WORKERS_AI_API_TOKEN: 'token_abc',
    ...overrides,
  } as unknown as Env
}

describe('[spec: provider-catalog/gateway] createProviderCatalogGateway', () => {
  it('exposes a fetchPlatformCatalog method', () => {
    const gateway = createProviderCatalogGateway(env())
    expect(typeof gateway.fetchPlatformCatalog).toBe('function')
  })

  it('concatenates rows from the Workers AI search and models.dev feeds', async () => {
    stubFeeds(jsonResponse(workersAiPayload), jsonResponse(modelsDevPayload))

    const models = await createProviderCatalogGateway(env()).fetchPlatformCatalog()

    const ids = models.map((model) => model.modelId)
    expect(ids).toContain('@cf/meta/llama-3.1-8b-instruct')
    expect(ids).toContain('anthropic/claude-opus-4')
    // Non-tool entries from both feeds are dropped by the domain mappers.
    expect(ids).not.toContain('@cf/meta/llama-2-7b-chat-int8')
    expect(ids).not.toContain('anthropic/claude-instant-legacy')
    // Only the gateway's third-party allowlist (anthropic/openai) is pulled.
    expect(ids).not.toContain('google/gemini-pro')
  })

  it('maps the Workers AI model into a native catalog row with parsed properties', async () => {
    stubFeeds(jsonResponse(workersAiPayload), jsonResponse({}))

    const models = await createProviderCatalogGateway(env()).fetchPlatformCatalog()
    const row = models.find((model) => model.modelId === '@cf/meta/llama-3.1-8b-instruct')

    expect(row).toMatchObject({
      vendor: 'meta',
      serving: 'workers-ai-native',
      capabilities: ['text', 'tools'],
      contextWindow: 128000,
      pricing: { inputMicrosPerToken: 0.03, outputMicrosPerToken: 0.2 },
      availability: 'available',
    })
  })

  it('maps the models.dev anthropic entry into a gateway-served catalog row', async () => {
    stubFeeds(jsonResponse({ result: [] }), jsonResponse(modelsDevPayload))

    const models = await createProviderCatalogGateway(env()).fetchPlatformCatalog()
    const row = models.find((model) => model.modelId === 'anthropic/claude-opus-4')

    expect(row).toMatchObject({
      vendor: 'anthropic',
      serving: 'ai-gateway',
      displayName: 'Claude Opus 4',
      capabilities: ['text', 'tools', 'vision', 'reasoning'],
      contextWindow: 200000,
      pricing: { inputMicrosPerToken: 15, outputMicrosPerToken: 75 },
    })
  })

  it('calls the Workers AI search endpoint with the account id and bearer token', async () => {
    const fetchMock = stubFeeds(jsonResponse({ result: [] }), jsonResponse({}))

    await createProviderCatalogGateway(env()).fetchPlatformCatalog()

    const searchCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith(WORKERS_AI_SEARCH_HOST))
    expect(searchCall).toBeDefined()
    const [url, init] = searchCall ?? []
    expect(String(url)).toContain('/accounts/acct_123/ai/models/search')
    expect(String(url)).toContain('task=Text+Generation')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer token_abc' })
  })

  it('falls back to the cloudflare API token when the Workers AI token is absent', async () => {
    const fetchMock = stubFeeds(jsonResponse({ result: [] }), jsonResponse({}))

    await createProviderCatalogGateway(
      env({ AMA_WORKERS_AI_API_TOKEN: undefined, AMA_CLOUDFLARE_API_TOKEN: 'fallback_token' }),
    ).fetchPlatformCatalog()

    const searchCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith(WORKERS_AI_SEARCH_HOST))
    expect((searchCall?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer fallback_token' })
  })

  it('throws when the Workers AI account id is missing', async () => {
    stubFeeds(jsonResponse({ result: [] }), jsonResponse({}))

    await expect(
      createProviderCatalogGateway(env({ AMA_WORKERS_AI_ACCOUNT_ID: undefined })).fetchPlatformCatalog(),
    ).rejects.toThrow(/account id and API token are required/)
  })

  it('throws when both Workers AI and cloudflare API tokens are missing', async () => {
    stubFeeds(jsonResponse({ result: [] }), jsonResponse({}))

    await expect(
      createProviderCatalogGateway(
        env({ AMA_WORKERS_AI_API_TOKEN: undefined, AMA_CLOUDFLARE_API_TOKEN: undefined }),
      ).fetchPlatformCatalog(),
    ).rejects.toThrow(/account id and API token are required/)
  })

  it('throws with the HTTP status when the Workers AI search returns non-ok', async () => {
    stubFeeds(jsonResponse({ error: 'Unauthorized' }, 401), jsonResponse(modelsDevPayload))

    await expect(createProviderCatalogGateway(env()).fetchPlatformCatalog()).rejects.toThrow(/HTTP 401/)
  })

  it('throws with the HTTP status when models.dev returns non-ok', async () => {
    stubFeeds(jsonResponse(workersAiPayload), jsonResponse({ error: 'down' }, 503))

    await expect(createProviderCatalogGateway(env()).fetchPlatformCatalog()).rejects.toThrow(/HTTP 503/)
  })

  it('throws when the Workers AI search payload has no result array', async () => {
    stubFeeds(jsonResponse({ messages: [] }), jsonResponse({}))

    await expect(createProviderCatalogGateway(env()).fetchPlatformCatalog()).rejects.toThrow(/not recognized/)
  })
})
