import type { CatalogModel } from '@server/domain/model-catalog'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import type {
  ProviderCatalogStatus,
  ProviderModelRecord,
  ProviderRecord,
  UpsertProviderInput,
  UpsertProviderModelInput,
} from './ports'
import { refreshPlatformCatalog } from './providers'

function catalogModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    vendor: 'anthropic',
    modelId: 'anthropic/claude-opus-4',
    displayName: 'Claude Opus 4',
    serving: 'ai-gateway',
    capabilities: ['text', 'tools'],
    contextWindow: 200000,
    pricing: { inputMicrosPerToken: 3, outputMicrosPerToken: 15 },
    availability: 'available',
    metadata: {},
    ...overrides,
  }
}

function providerRecord(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: `provider_${overrides.slug ?? 'anthropic'}`,
    slug: 'anthropic',
    displayName: 'Anthropic',
    enabled: true,
    metadata: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function modelRecord(input: UpsertProviderModelInput): ProviderModelRecord {
  return {
    id: `model_${input.modelId}`,
    providerId: input.providerId,
    modelId: input.modelId,
    displayName: input.displayName,
    capabilities: input.capabilities,
    contextWindow: input.contextWindow,
    pricing: input.pricing,
    availability: input.availability,
    metadata: input.metadata,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

interface RepoCalls {
  upserts: UpsertProviderInput[]
  models: UpsertProviderModelInput[]
  statuses: { providerId: string; status: ProviderCatalogStatus }[]
}

function fakeDeps(options: { fetch: () => Promise<CatalogModel[]>; list?: ProviderRecord[] }): {
  deps: Deps
  calls: RepoCalls
} {
  const calls: RepoCalls = { upserts: [], models: [], statuses: [] }
  const providers: Partial<Deps['providers']> = {
    list: async () => options.list ?? [],
    upsert: async (input, timestamp) => {
      calls.upserts.push(input)
      return providerRecord({
        id: `provider_${input.slug}`,
        slug: input.slug,
        displayName: input.displayName,
        updatedAt: timestamp,
      })
    },
    upsertModel: async (input) => {
      calls.models.push(input)
      return { record: modelRecord(input), created: true }
    },
    setCatalogStatus: async (providerId, status) => {
      calls.statuses.push({ providerId, status })
    },
  }
  const deps = {
    providers,
    providerCatalog: { fetchPlatformCatalog: options.fetch },
  } as unknown as Deps
  return { deps, calls }
}

describe('[spec: providers/catalog-refresh] refreshPlatformCatalog', () => {
  it('groups discovered models by vendor and upserts a provider plus its models', async () => {
    const { deps, calls } = fakeDeps({
      fetch: async () => [
        catalogModel({ vendor: 'anthropic', modelId: 'anthropic/claude-opus-4' }),
        catalogModel({ vendor: 'anthropic', modelId: 'anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4' }),
        catalogModel({
          vendor: 'meta',
          modelId: '@cf/meta/llama-3.1-8b-instruct',
          displayName: 'Llama 3.1 8b Instruct',
          serving: 'workers-ai-native',
        }),
      ],
    })

    const result = await refreshPlatformCatalog(deps)

    expect(result).toEqual({ outcome: 'succeeded', discoveredCount: 3, vendors: 2 })
    expect(calls.upserts).toEqual([
      { slug: 'anthropic', displayName: 'Anthropic' },
      { slug: 'meta', displayName: 'Meta' },
    ])
    expect(calls.models.map((model) => model.modelId)).toEqual([
      'anthropic/claude-opus-4',
      'anthropic/claude-sonnet-4',
      '@cf/meta/llama-3.1-8b-instruct',
    ])
  })

  it('carries the catalog model fields onto each upserted model row', async () => {
    const { deps, calls } = fakeDeps({
      fetch: async () => [
        catalogModel({
          vendor: 'anthropic',
          modelId: 'anthropic/claude-opus-4',
          capabilities: ['text', 'tools', 'vision'],
          contextWindow: 200000,
          pricing: { inputMicrosPerToken: 3 },
        }),
      ],
    })

    await refreshPlatformCatalog(deps)

    expect(calls.models[0]).toMatchObject({
      providerId: 'provider_anthropic',
      modelId: 'anthropic/claude-opus-4',
      displayName: 'Claude Opus 4',
      capabilities: ['text', 'tools', 'vision'],
      contextWindow: 200000,
      pricing: { inputMicrosPerToken: 3 },
      availability: 'available',
      metadata: {},
    })
  })

  it('marks each refreshed vendor provider catalog status ready with no error', async () => {
    const { deps, calls } = fakeDeps({
      fetch: async () => [
        catalogModel({ vendor: 'anthropic' }),
        catalogModel({ vendor: 'openai', modelId: 'openai/gpt-4.1', displayName: 'GPT-4.1' }),
      ],
    })

    await refreshPlatformCatalog(deps)

    expect(calls.statuses).toEqual([
      { providerId: 'provider_anthropic', status: { modelCatalogState: 'ready', lastError: null } },
      { providerId: 'provider_openai', status: { modelCatalogState: 'ready', lastError: null } },
    ])
  })

  it('returns a zero-vendor success when the catalog is empty', async () => {
    const { deps, calls } = fakeDeps({ fetch: async () => [] })

    const result = await refreshPlatformCatalog(deps)

    expect(result).toEqual({ outcome: 'succeeded', discoveredCount: 0, vendors: 0 })
    expect(calls.upserts).toEqual([])
    expect(calls.statuses).toEqual([])
  })

  it('marks every existing provider catalog status error when the discovery fetch throws', async () => {
    const { deps, calls } = fakeDeps({
      fetch: async () => {
        throw Object.assign(new Error('discovery returned HTTP 404'), { status: 404 })
      },
      list: [
        providerRecord({ id: 'provider_anthropic', slug: 'anthropic' }),
        providerRecord({ id: 'provider_openai', slug: 'openai', displayName: 'OpenAI' }),
      ],
    })

    const result = await refreshPlatformCatalog(deps)

    expect(result).toEqual({ outcome: 'failed', discoveredCount: 0, vendors: 0, category: 'model_unavailable' })
    expect(calls.statuses.map((entry) => entry.providerId)).toEqual(['provider_anthropic', 'provider_openai'])
    expect(calls.statuses[0]?.status.modelCatalogState).toBe('error')
    expect(calls.statuses[0]?.status.lastError).toMatchObject({
      type: 'provider_error',
      category: 'model_unavailable',
    })
    expect(calls.upserts).toEqual([])
  })

  it('reports failure even when no providers exist to mark', async () => {
    const { deps, calls } = fakeDeps({
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
      list: [],
    })

    const result = await refreshPlatformCatalog(deps)

    expect(result.outcome).toBe('failed')
    expect(result.category).toBe('network')
    expect(calls.statuses).toEqual([])
  })
})
