import { describe, expect, it } from 'vitest'
import { catalogModelFromModelsDev, servingFromModelId, TOOL_CALL_DENYLIST, vendorFromModelId } from './model-catalog'

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

  it('keeps a cloudflare-workers-ai @cf id as-is, native serving, vendor from the id', () => {
    const kimi = { tool_call: true, limit: { context: 262144 }, cost: { input: 0.6, output: 3 } }
    expect(catalogModelFromModelsDev('cloudflare-workers-ai', '@cf/moonshotai/kimi-k2.6', kimi)).toMatchObject({
      vendor: 'moonshotai',
      modelId: '@cf/moonshotai/kimi-k2.6',
      serving: 'workers-ai-native',
      capabilities: ['text', 'tools'],
      contextWindow: 262144,
      pricing: { inputMicrosPerToken: 0.6, outputMicrosPerToken: 3 },
    })
  })

  it('drops non-tool-callers', () => {
    expect(catalogModelFromModelsDev('openai', 'text-embedding-3-large', { tool_call: false })).toBeNull()
  })

  it('drops denylisted @cf ids that advertise tool_call but do not drive tool loops', () => {
    expect(
      catalogModelFromModelsDev('cloudflare-workers-ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        tool_call: true,
      }),
    ).toBeNull()
    expect(TOOL_CALL_DENYLIST.has('@cf/meta/llama-4-scout-17b-16e-instruct')).toBe(true)
  })

  it('prettifies the model id for display when the entry has no name', () => {
    const minimal = { tool_call: true }
    expect(catalogModelFromModelsDev('openai', 'gpt-5.2', minimal)).toMatchObject({
      modelId: 'openai/gpt-5.2',
      displayName: 'Gpt 5.2',
      capabilities: ['text', 'tools'],
      contextWindow: null,
      pricing: {},
    })
  })
})
