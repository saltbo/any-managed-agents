import { describe, expect, it } from 'vitest'
import { summarizeUsage, type UsageMeasurement } from './usage'

function measurement(overrides: Partial<UsageMeasurement> = {}): UsageMeasurement {
  return {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    durationMs: 100,
    costMicros: 25,
    currency: 'USD',
    providerId: 'workers-ai',
    providerType: 'workers-ai',
    modelId: '@cf/model-a',
    agentId: 'agent_alpha',
    ...overrides,
  }
}

describe('[spec: usage/summary] summarizeUsage', () => {
  it('folds grand totals across every row', () => {
    const summary = summarizeUsage(
      [
        measurement(),
        measurement({ promptTokens: 2, completionTokens: 0, totalTokens: 2, durationMs: 50, costMicros: 0 }),
      ],
      'provider',
    )
    expect(summary.totals).toEqual({
      records: 2,
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      durationMs: 150,
      costMicros: 25,
      currency: 'USD',
    })
  })

  it('groups by provider, falling back to providerType when providerId is null', () => {
    const summary = summarizeUsage(
      [measurement(), measurement(), measurement({ providerId: null, providerType: 'sandbox', totalTokens: 0 })],
      'provider',
    )
    expect(summary.groupBy).toBe('provider')
    // Sorted stably by the serialized key.
    expect(summary.groups).toEqual([
      expect.objectContaining({ key: { provider: 'sandbox' }, records: 1 }),
      expect.objectContaining({ key: { provider: 'workers-ai' }, records: 2, totalTokens: 30 }),
    ])
  })

  it('groups by model', () => {
    const summary = summarizeUsage([measurement(), measurement({ modelId: '@cf/model-b' })], 'model')
    expect(summary.groups.map((group) => group.key)).toEqual([{ model: '@cf/model-a' }, { model: '@cf/model-b' }])
  })

  it('groups by agent and preserves a null agent key', () => {
    const summary = summarizeUsage([measurement({ agentId: 'agent_beta' }), measurement({ agentId: null })], 'agent')
    const keys = summary.groups.map((group) => group.key)
    expect(keys).toContainEqual({ agent: 'agent_beta' })
    expect(keys).toContainEqual({ agent: null })
  })

  it('returns empty totals and no groups for no rows', () => {
    const summary = summarizeUsage([], 'provider')
    expect(summary.totals.records).toBe(0)
    expect(summary.groups).toEqual([])
  })
})
