// Pure usage-aggregation rules. Zero outward imports — directly unit-testable.

export const USAGE_GROUP_BY_VALUES = ['provider', 'model', 'agent'] as const
export type UsageGroupBy = (typeof USAGE_GROUP_BY_VALUES)[number]

export const USAGE_STATUSES = ['success', 'error'] as const
export type UsageStatus = (typeof USAGE_STATUSES)[number]

export const USAGE_TYPES = ['model', 'tool'] as const
export type UsageType = (typeof USAGE_TYPES)[number]

// Provider families (see domain/provider-adapter PROVIDER_FAMILIES) plus
// 'sandbox' for tool-execution usage rows.
export const USAGE_PROVIDER_TYPES = [
  'workers-ai',
  'anthropic',
  'openai',
  'openai-compatible',
  'ollama',
  'sandbox',
] as const
export type UsageProviderType = (typeof USAGE_PROVIDER_TYPES)[number]

// The numeric fields a usage row contributes to a summary. A row carries more
// columns, but only these cross into the aggregation.
export interface UsageMeasurement {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
  providerId: string | null
  providerType: string
  modelId: string
  agentId: string | null
}

export interface UsageTotals {
  records: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
}

export interface UsageGroup extends UsageTotals {
  key: Record<string, string | null>
}

export interface UsageSummary {
  groupBy: UsageGroupBy
  totals: UsageTotals
  groups: UsageGroup[]
}

function emptyTotals(): UsageTotals {
  return {
    records: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    costMicros: 0,
    currency: 'USD',
  }
}

function accumulate(target: UsageTotals, row: UsageMeasurement) {
  target.records += 1
  target.promptTokens += row.promptTokens
  target.completionTokens += row.completionTokens
  target.totalTokens += row.totalTokens
  target.durationMs += row.durationMs
  target.costMicros += row.costMicros
  target.currency = row.currency
}

function groupKeyValue(groupBy: UsageGroupBy, row: UsageMeasurement) {
  switch (groupBy) {
    case 'provider':
      return row.providerId ?? row.providerType
    case 'model':
      return row.modelId
    case 'agent':
      return row.agentId
  }
}

// Deterministic aggregation of usage rows into grand totals plus per-key groups,
// sorted stably by the serialized group key.
export function summarizeUsage(rows: UsageMeasurement[], groupBy: UsageGroupBy): UsageSummary {
  const totals = emptyTotals()
  const groups = new Map<string, UsageGroup>()
  for (const row of rows) {
    accumulate(totals, row)
    const value = groupKeyValue(groupBy, row)
    const keyString = JSON.stringify(value)
    const group = groups.get(keyString) ?? { key: { [groupBy]: value }, ...emptyTotals() }
    accumulate(group, row)
    groups.set(keyString, group)
  }
  return {
    groupBy,
    totals,
    groups: [...groups.values()].sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key))),
  }
}
