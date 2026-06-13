import { describe, expect, it } from 'vitest'
import {
  computeModelCostMicros,
  extractProviderUsage,
  normalizeProviderError,
  parseProviderModelCatalog,
  providerFamily,
} from './provider-adapter'

describe('providerFamily', () => {
  it('maps runtime and configured provider names onto adapter families', () => {
    expect(providerFamily('cloudflare-workers-ai')).toBe('workers-ai')
    expect(providerFamily('workers-ai')).toBe('workers-ai')
    expect(providerFamily('anthropic')).toBe('anthropic')
    expect(providerFamily('openai')).toBe('openai')
    expect(providerFamily('ollama')).toBe('ollama')
  })

  it('treats unknown and missing providers as OpenAI-compatible', () => {
    expect(providerFamily('other')).toBe('openai-compatible')
    expect(providerFamily(null)).toBe('openai-compatible')
    expect(providerFamily(undefined)).toBe('openai-compatible')
  })
})

describe('[spec: providers/error-normalization] normalizeProviderError', () => {
  it('categorizes credential failures as auth without copying the raw payload', () => {
    const raw = Object.assign(new Error('401 invalid api key sk-raw-credential-fragment'), {
      status: 401,
      code: 'invalid_api_key',
    })
    const normalized = normalizeProviderError('openai', raw)
    expect(normalized.category).toBe('auth')
    expect(normalized.retryable).toBe(false)
    expect(normalized.message).not.toContain('sk-raw-credential-fragment')
  })

  it('separates quota exhaustion from rate limiting on shared 429 status codes', () => {
    const quota = normalizeProviderError(
      'openai',
      Object.assign(new Error('insufficient_quota'), { status: 429, code: 'insufficient_quota' }),
    )
    const rateLimit = normalizeProviderError(
      'openai',
      Object.assign(new Error('too many requests'), { status: 429, retryAfterSeconds: 7 }),
    )
    expect(quota.category).toBe('quota')
    expect(quota.retryable).toBe(false)
    expect(rateLimit.category).toBe('rate_limit')
    expect(rateLimit.retryable).toBe(true)
    expect(rateLimit.retryAfterSeconds).toBe(7)
  })

  it('categorizes missing models, invalid requests, transport failures, and unknowns', () => {
    expect(
      normalizeProviderError('anthropic', Object.assign(new Error('model_not_found'), { status: 404 })).category,
    ).toBe('model_unavailable')
    expect(
      normalizeProviderError('anthropic', Object.assign(new Error('invalid_request_error'), { status: 400 })).category,
    ).toBe('invalid_request')
    const network = normalizeProviderError('ollama', new TypeError('fetch failed'))
    expect(network.category).toBe('network')
    expect(network.retryable).toBe(true)
    expect(normalizeProviderError('openai-compatible', new Error('something odd happened')).category).toBe('unknown')
  })
})

describe('extractProviderUsage', () => {
  it('reads OpenAI-compatible usage blocks', () => {
    const usage = extractProviderUsage('openai', {
      usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
    })
    expect(usage).toEqual({
      promptTokens: 11,
      completionTokens: 4,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('reads Anthropic usage blocks including cache token splits', () => {
    const usage = extractProviderUsage('anthropic', {
      usage: { input_tokens: 9, output_tokens: 6, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    })
    expect(usage).toEqual({
      promptTokens: 9,
      completionTokens: 6,
      totalTokens: 15,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
  })

  it('reads Ollama eval counters', () => {
    const usage = extractProviderUsage('ollama', { prompt_eval_count: 21, eval_count: 13 })
    expect(usage).toEqual({
      promptTokens: 21,
      completionTokens: 13,
      totalTokens: 34,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('returns null when the payload carries no usage metadata', () => {
    expect(extractProviderUsage('openai', { result: 'no usage here' })).toBeNull()
    expect(extractProviderUsage('ollama', {})).toBeNull()
  })
})

describe('computeModelCostMicros', () => {
  it('prices usage from per-token micro pricing metadata', () => {
    const cost = computeModelCostMicros(
      { inputMicrosPerToken: 2, outputMicrosPerToken: 5 },
      { promptTokens: 10, completionTokens: 4 },
    )
    expect(cost).toBe(40)
  })

  it('returns null when the catalog row carries no pricing keys', () => {
    expect(computeModelCostMicros({}, { promptTokens: 10, completionTokens: 4 })).toBeNull()
  })
})

describe('[spec: providers/catalog-parse] parseProviderModelCatalog', () => {
  it('parses OpenAI-compatible model lists with safe catalog fields only', () => {
    const models = parseProviderModelCatalog('openai-compatible', {
      data: [
        {
          id: 'gpt-5.3-codex',
          display_name: 'GPT 5.3 Codex',
          context_window: 400000,
          pricing: { inputMicrosPerToken: 2 },
          api_key: 'must-not-be-copied',
        },
      ],
    })
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      modelId: 'gpt-5.3-codex',
      displayName: 'GPT 5.3 Codex',
      contextWindow: 400000,
      pricing: { inputMicrosPerToken: 2 },
      availability: 'available',
    })
    expect(JSON.stringify(models[0])).not.toContain('must-not-be-copied')
  })

  it('parses Ollama tag lists', () => {
    const models = parseProviderModelCatalog('ollama', { models: [{ name: 'qwen3:8b' }] })
    expect(models[0]?.modelId).toBe('qwen3:8b')
  })

  it('rejects unrecognized payloads instead of guessing', () => {
    expect(() => parseProviderModelCatalog('openai', { unexpected: true })).toThrow(/not recognized/)
    expect(() => parseProviderModelCatalog('openai', { data: [{}] })).toThrow(/missing an id/)
  })
})
