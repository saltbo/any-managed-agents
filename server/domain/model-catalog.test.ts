import { describe, expect, it } from 'vitest'
import {
  catalogModelFromModelsDev,
  catalogModelFromWorkersAi,
  servingFromModelId,
  TOOL_CALL_DENYLIST,
  vendorFromModelId,
} from './model-catalog'

describe('vendorFromModelId', () => {
  it('reads the middle segment of a native @cf id', () => {
    expect(vendorFromModelId('@cf/moonshotai/kimi-k2.7-code')).toBe('moonshotai')
    expect(vendorFromModelId('@cf/openai/gpt-oss-120b')).toBe('openai')
  })

  it('reads the first segment of a gateway {vendor}/{model} id', () => {
    expect(vendorFromModelId('anthropic/claude-opus-4')).toBe('anthropic')
    expect(vendorFromModelId('openai/gpt-5.2')).toBe('openai')
  })

  it('returns unknown for a bare id with no vendor segment', () => {
    expect(vendorFromModelId('gpt-4')).toBe('unknown')
  })
})

describe('servingFromModelId', () => {
  it('classifies @cf ids as native and everything else as gateway', () => {
    expect(servingFromModelId('@cf/openai/gpt-oss-120b')).toBe('workers-ai-native')
    expect(servingFromModelId('anthropic/claude-opus-4')).toBe('ai-gateway')
  })
})

// Real shape from `wrangler ai models list --json` / GET /ai/models/search.
const kimi = {
  name: '@cf/moonshotai/kimi-k2.7-code',
  task: { name: 'Text Generation' },
  properties: [
    { property_id: 'context_window', value: '262144' },
    {
      property_id: 'price',
      value: [
        { unit: 'per M input tokens', price: 0.95, currency: 'USD' },
        { unit: 'per M output tokens', price: 4, currency: 'USD' },
      ],
    },
    { property_id: 'function_calling', value: 'true' },
    { property_id: 'reasoning', value: 'true' },
    { property_id: 'vision', value: 'true' },
  ],
}

describe('catalogModelFromWorkersAi', () => {
  it('maps a tool-capable text-gen model with vendor, serving, caps, pricing', () => {
    expect(catalogModelFromWorkersAi(kimi)).toEqual({
      vendor: 'moonshotai',
      modelId: '@cf/moonshotai/kimi-k2.7-code',
      displayName: 'Kimi K2.7 Code',
      serving: 'workers-ai-native',
      capabilities: ['text', 'tools', 'vision', 'reasoning'],
      contextWindow: 262144,
      pricing: { inputMicrosPerToken: 0.95, outputMicrosPerToken: 4 },
      availability: 'available',
      metadata: {},
    })
  })

  it('drops denylisted ids that advertise function_calling but do not drive tool loops', () => {
    const denylisted = { ...kimi, name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }
    expect(catalogModelFromWorkersAi(denylisted)).toBeNull()
    expect(TOOL_CALL_DENYLIST.has('@cf/meta/llama-4-scout-17b-16e-instruct')).toBe(true)
  })

  it('drops non-text-generation tasks', () => {
    const embedding = { ...kimi, name: '@cf/baai/bge-m3', task: { name: 'Text Embeddings' } }
    expect(catalogModelFromWorkersAi(embedding)).toBeNull()
  })

  it('drops models without the function_calling property', () => {
    const noTools = {
      name: '@cf/qwen/qwq-32b',
      task: { name: 'Text Generation' },
      properties: [{ property_id: 'context_window', value: '32768' }],
    }
    expect(catalogModelFromWorkersAi(noTools)).toBeNull()
  })

  it('drops a model with no name', () => {
    expect(catalogModelFromWorkersAi({ task: { name: 'Text Generation' }, properties: [] })).toBeNull()
  })

  it('yields baseline text+tools caps, null context, empty pricing when properties are sparse', () => {
    const sparse = {
      name: '@cf/zai-org/glm-4.7-flash',
      task: { name: 'Text Generation' },
      properties: [{ property_id: 'function_calling', value: 'true' }],
    }
    expect(catalogModelFromWorkersAi(sparse)).toMatchObject({
      vendor: 'zai-org',
      capabilities: ['text', 'tools'],
      contextWindow: null,
      pricing: {},
    })
  })

  it('ignores malformed price tiers and non-string context windows', () => {
    const messy = {
      name: '@cf/openai/gpt-oss-20b',
      task: { name: 'Text Generation' },
      properties: [
        { property_id: 'context_window', value: 128000 },
        { property_id: 'price', value: [{ unit: 'per request', price: 1 }, null, { unit: 'per M input tokens' }] },
        { property_id: 'function_calling', value: 'true' },
      ],
    }
    const row = catalogModelFromWorkersAi(messy)
    expect(row?.contextWindow).toBeNull()
    expect(row?.pricing).toEqual({})
  })
})

// Real shape from GET https://models.dev/api.json (j.anthropic.models[id]).
const claudeOpus = {
  name: 'Claude Opus 4.5',
  tool_call: true,
  reasoning: true,
  modalities: { input: ['text', 'image'] },
  limit: { context: 200000 },
  cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
}

describe('catalogModelFromModelsDev', () => {
  it('maps a third-party tool-caller to a gateway {vendor}/{model} row', () => {
    expect(catalogModelFromModelsDev('anthropic', 'claude-opus-4-5', claudeOpus)).toEqual({
      vendor: 'anthropic',
      modelId: 'anthropic/claude-opus-4-5',
      displayName: 'Claude Opus 4.5',
      serving: 'ai-gateway',
      capabilities: ['text', 'tools', 'vision', 'reasoning'],
      contextWindow: 200000,
      pricing: {
        inputMicrosPerToken: 5,
        outputMicrosPerToken: 25,
        cacheReadMicrosPerToken: 0.5,
        cacheWriteMicrosPerToken: 6.25,
      },
      availability: 'available',
      metadata: {},
    })
  })

  it('drops non-tool-callers', () => {
    expect(catalogModelFromModelsDev('openai', 'text-embedding-3-large', { tool_call: false })).toBeNull()
  })

  it('falls back to the id for display name and omits absent capabilities/pricing', () => {
    const minimal = { tool_call: true }
    expect(catalogModelFromModelsDev('openai', 'gpt-5.2', minimal)).toMatchObject({
      modelId: 'openai/gpt-5.2',
      displayName: 'gpt-5.2',
      capabilities: ['text', 'tools'],
      contextWindow: null,
      pricing: {},
    })
  })
})
