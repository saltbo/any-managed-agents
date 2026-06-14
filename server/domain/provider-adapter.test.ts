import { describe, expect, it } from 'vitest'
import {
  computeModelCostMicros,
  extractProviderUsage,
  isProviderErrorCategory,
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

  it('parses Ollama tag lists using the name field', () => {
    const models = parseProviderModelCatalog('ollama', { models: [{ name: 'qwen3:8b' }] })
    expect(models[0]?.modelId).toBe('qwen3:8b')
  })

  it('parses Ollama entries that use the model field instead of name', () => {
    const models = parseProviderModelCatalog('ollama', { models: [{ model: 'llama3:8b' }] })
    expect(models[0]?.modelId).toBe('llama3:8b')
  })

  it('rejects unrecognized payloads instead of guessing', () => {
    expect(() => parseProviderModelCatalog('openai', { unexpected: true })).toThrow(/not recognized/)
    expect(() => parseProviderModelCatalog('openai', { data: [{}] })).toThrow(/missing an id/)
  })

  it('rejects an ollama payload that has no models array', () => {
    expect(() => parseProviderModelCatalog('ollama', { unexpected: true })).toThrow(/not recognized/)
  })

  it('rejects an ollama model entry with no name or model field', () => {
    expect(() => parseProviderModelCatalog('ollama', { models: [{}] })).toThrow(/missing an id/)
  })

  it('preserves explicit capabilities when the model entry provides them', () => {
    const models = parseProviderModelCatalog('openai', {
      data: [{ id: 'gpt-4o', capabilities: ['text', 'vision'], context_window: 128000 }],
    })
    expect(models[0]?.capabilities).toEqual(['text', 'vision'])
  })

  it('falls back to text capability when no capabilities are provided', () => {
    const models = parseProviderModelCatalog('openai', {
      data: [{ id: 'gpt-4o' }],
    })
    expect(models[0]?.capabilities).toEqual(['text'])
  })

  it('reads context_length as an alternative to context_window', () => {
    const models = parseProviderModelCatalog('openai', {
      data: [{ id: 'm1', context_length: 32000 }],
    })
    expect(models[0]?.contextWindow).toBe(32000)
  })

  it('uses name as display name fallback when display_name is absent', () => {
    const models = parseProviderModelCatalog('openai', {
      data: [{ id: 'm1', name: 'Model One' }],
    })
    expect(models[0]?.displayName).toBe('Model One')
  })

  it('falls back to id as display name when both display_name and name are absent', () => {
    const models = parseProviderModelCatalog('openai', {
      data: [{ id: 'fallback-id' }],
    })
    expect(models[0]?.displayName).toBe('fallback-id')
  })
})

describe('[spec: providers/error-normalization] normalizeProviderError status-based branches', () => {
  it('categorizes 403 as auth', () => {
    expect(normalizeProviderError('openai', { status: 403 }).category).toBe('auth')
  })

  it('categorizes 402 as quota', () => {
    expect(normalizeProviderError('openai', { status: 402 }).category).toBe('quota')
  })

  it('categorizes 429 as rate_limit', () => {
    expect(normalizeProviderError('openai', { status: 429 }).category).toBe('rate_limit')
  })

  it('categorizes 503 as rate_limit', () => {
    expect(normalizeProviderError('anthropic', { status: 503 }).category).toBe('rate_limit')
  })

  it('categorizes 529 as rate_limit', () => {
    expect(normalizeProviderError('anthropic', { status: 529 }).category).toBe('rate_limit')
  })

  it('categorizes other 5xx as network', () => {
    expect(normalizeProviderError('openai', { status: 502 }).category).toBe('network')
  })

  it('categorizes other 4xx as invalid_request', () => {
    expect(normalizeProviderError('openai', { status: 422 }).category).toBe('invalid_request')
  })

  it('categorizes text-matched overloaded as rate_limit', () => {
    expect(normalizeProviderError('anthropic', Object.assign(new Error('overloaded'), { status: 500 })).category).toBe(
      'rate_limit',
    )
  })

  it('categorizes text-matched billing as quota', () => {
    expect(normalizeProviderError('openai', Object.assign(new Error('billing error'), { status: 400 })).category).toBe(
      'quota',
    )
  })

  it('categorizes text-matched payment required as quota', () => {
    expect(
      normalizeProviderError('openai', Object.assign(new Error('payment required'), { status: 400 })).category,
    ).toBe('quota')
  })

  it('categorizes text-matched forbidden as auth', () => {
    expect(
      normalizeProviderError('openai', Object.assign(new Error('permission denied'), { status: 400 })).category,
    ).toBe('auth')
  })

  it('categorizes text-matched model decommissioned as model_unavailable', () => {
    expect(
      normalizeProviderError('openai', Object.assign(new Error('model has been decommissioned'), { status: 400 }))
        .category,
    ).toBe('model_unavailable')
  })

  it('categorizes text-matched no such model as model_unavailable', () => {
    expect(normalizeProviderError('openai', Object.assign(new Error('no such model'), { status: 400 })).category).toBe(
      'model_unavailable',
    )
  })

  it('categorizes text-matched content filter as invalid_request', () => {
    expect(
      normalizeProviderError('openai', Object.assign(new Error('content filter triggered'), { status: 400 })).category,
    ).toBe('invalid_request')
  })

  it('categorizes text-matched safety as invalid_request', () => {
    expect(
      normalizeProviderError('openai', Object.assign(new Error('safety policy violation'), { status: 400 })).category,
    ).toBe('invalid_request')
  })

  it('categorizes text-matched abort as network', () => {
    expect(
      normalizeProviderError('openai', Object.assign(new Error('request timed out'), { status: 400 })).category,
    ).toBe('network')
  })

  it('includes retryAfterSeconds from nested error.retry_after', () => {
    const result = normalizeProviderError('anthropic', {
      status: 429,
      error: { retry_after: 30 },
      message: 'rate limit',
    })
    expect(result.category).toBe('rate_limit')
    expect(result.retryAfterSeconds).toBe(30)
  })

  it('reads retryAfterSeconds from headers retry-after', () => {
    const result = normalizeProviderError('openai', {
      status: 429,
      headers: { 'retry-after': 45 },
      message: 'rate limit',
    })
    expect(result.category).toBe('rate_limit')
    expect(result.retryAfterSeconds).toBe(45)
  })

  it('reads statusCode as a fallback for status', () => {
    expect(normalizeProviderError('openai', { statusCode: 401 }).category).toBe('auth')
  })

  it('reads status from the nested error object', () => {
    expect(normalizeProviderError('openai', { error: { status: 403 } }).category).toBe('auth')
  })

  it('reads code from the nested error object type field', () => {
    expect(normalizeProviderError('openai', { error: { type: 'insufficient_quota' } }).category).toBe('quota')
  })

  it('handles string status values in numberValue', () => {
    expect(normalizeProviderError('openai', { status: '401' }).category).toBe('auth')
  })

  it('does not include retryAfterSeconds for non-retryable categories', () => {
    const result = normalizeProviderError('openai', { status: 401 })
    expect(result.retryAfterSeconds).toBeUndefined()
  })

  it('categorizes 404 status as model_unavailable when text does not match first', () => {
    // Plain object with status 404 and no matching text — hits the status branch
    expect(normalizeProviderError('openai', { status: 404 }).category).toBe('model_unavailable')
  })

  it('categorizes a TypeError with no fetch-related text as network via transitional fallback', () => {
    // TypeError without text matching network keywords — category is 'unknown', then isTransportError upgrades it
    expect(normalizeProviderError('openai', new TypeError('connection refused somewhere')).category).toBe('network')
  })
})

describe('extractProviderUsage additional branches', () => {
  it('uses input_tokens as fallback for prompt_tokens in openai-compatible payloads', () => {
    const usage = extractProviderUsage('openai-compatible', {
      usage: { input_tokens: 5, output_tokens: 3 },
    })
    expect(usage?.promptTokens).toBe(5)
    expect(usage?.completionTokens).toBe(3)
  })

  it('computes totalTokens from prompt + completion when total_tokens is absent', () => {
    const usage = extractProviderUsage('openai', {
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    expect(usage?.totalTokens).toBe(15)
  })

  it('handles ollama payload with only eval_count (prompt_eval_count missing)', () => {
    const usage = extractProviderUsage('ollama', { eval_count: 10 })
    expect(usage?.completionTokens).toBe(10)
    expect(usage?.promptTokens).toBe(0)
  })

  it('handles ollama payload with only prompt_eval_count (eval_count missing)', () => {
    const usage = extractProviderUsage('ollama', { prompt_eval_count: 7 })
    expect(usage?.promptTokens).toBe(7)
    expect(usage?.completionTokens).toBe(0)
  })

  it('returns null for workers-ai family when usage block is empty', () => {
    expect(extractProviderUsage('workers-ai', {})).toBeNull()
  })

  it('defaults missing anthropic input_tokens to 0 when only output_tokens is present', () => {
    // Anthropic usage with only output_tokens — input_tokens ?? 0 hits
    const usage = extractProviderUsage('anthropic', {
      usage: { output_tokens: 8 },
    })
    expect(usage?.promptTokens).toBe(0)
    expect(usage?.completionTokens).toBe(8)
    expect(usage?.cacheReadTokens).toBe(0)
    expect(usage?.cacheWriteTokens).toBe(0)
  })

  it('defaults missing anthropic output_tokens to 0 when only input_tokens is present', () => {
    // Anthropic usage with only input_tokens — output_tokens ?? 0 hits
    const usage = extractProviderUsage('anthropic', {
      usage: { input_tokens: 5 },
    })
    expect(usage?.promptTokens).toBe(5)
    expect(usage?.completionTokens).toBe(0)
  })

  it('defaults missing openai prompt/completion token fields to 0', () => {
    // Usage block present but with only total_tokens (no prompt_tokens or completion_tokens or input_tokens)
    const usage = extractProviderUsage('openai', {
      usage: { total_tokens: 20 },
    })
    expect(usage?.promptTokens).toBe(0)
    expect(usage?.completionTokens).toBe(0)
    expect(usage?.totalTokens).toBe(20)
  })
})

describe('computeModelCostMicros with partial pricing', () => {
  it('computes cost when only input pricing is present (output defaults to 0)', () => {
    const cost = computeModelCostMicros({ inputMicrosPerToken: 3 }, { promptTokens: 10, completionTokens: 5 })
    expect(cost).toBe(30)
  })

  it('computes cost when only output pricing is present (input defaults to 0)', () => {
    const cost = computeModelCostMicros({ outputMicrosPerToken: 4 }, { promptTokens: 10, completionTokens: 5 })
    expect(cost).toBe(20)
  })
})

describe('isProviderErrorCategory', () => {
  it('validates known categories', () => {
    expect(isProviderErrorCategory('auth')).toBe(true)
    expect(isProviderErrorCategory('rate_limit')).toBe(true)
    expect(isProviderErrorCategory('unknown')).toBe(true)
    expect(isProviderErrorCategory('made_up')).toBe(false)
    expect(isProviderErrorCategory(42)).toBe(false)
  })
})
