// Pure global model-catalog rules. Zero outward imports beyond the shared
// DiscoveredProviderModel shape — directly unit-testable.
//
// "provider" carries its real semantic here: the model VENDOR (anthropic,
// openai, moonshotai, …), NOT the transport. Every cloud model is dispatched the
// same way — `env.AI.run(modelId)` through the Workers AI binding — so HOW a
// model is served (free `@cf/…` native allocation vs metered AI Gateway) is a
// per-model property derived from the id prefix, orthogonal to the vendor. The
// old catalog conflated the two by tagging everything `provider: 'workers-ai'`.

import type { DiscoveredProviderModel } from './provider-adapter'

export const MODEL_SERVINGS = ['workers-ai-native', 'ai-gateway'] as const
export type ModelServing = (typeof MODEL_SERVINGS)[number]

// A discovered model placed under its vendor, with the serving path resolved.
export interface CatalogModel extends DiscoveredProviderModel {
  vendor: string
  serving: ModelServing
}

// CF marks these `function_calling: true` (the model accepts a `tools` param)
// but they do not emit usable tool_calls in this harness — verified by probing
// through the runtime-ai proxy. The flag means "accepts tools", not "drives a
// tool loop", so a thin denylist still guards the agent runtime.
export const TOOL_CALL_DENYLIST: ReadonlySet<string> = new Set([
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
])

const WORKERS_AI_NATIVE_PREFIX = '@cf/'

// `@cf/{vendor}/{model}` → vendor is the middle segment; `{vendor}/{model}` →
// vendor is the first segment. A bare id with no vendor segment is unattributed.
export function vendorFromModelId(modelId: string): string {
  const path = modelId.startsWith(WORKERS_AI_NATIVE_PREFIX) ? modelId.slice(WORKERS_AI_NATIVE_PREFIX.length) : modelId
  const segments = path.split('/')
  const [first] = segments
  return segments.length >= 2 && first ? first : 'unknown'
}

export function servingFromModelId(modelId: string): ModelServing {
  return modelId.startsWith(WORKERS_AI_NATIVE_PREFIX) ? 'workers-ai-native' : 'ai-gateway'
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function displayNameFromModelId(modelId: string): string {
  const last = modelId.split('/').pop() ?? modelId
  return titleCase(last)
}

// USD-per-million-tokens equals micro-USD-per-token numerically (1 USD = 1e6
// micro-USD, 1M tokens = 1e6 tokens), so both source feeds map straight onto the
// pricing contract consumed by computeModelCostMicros (provider-adapter.ts).
function pricingMicros(input?: number, output?: number, cacheRead?: number, cacheWrite?: number) {
  const pricing: Record<string, number> = {}
  if (typeof input === 'number') pricing.inputMicrosPerToken = input
  if (typeof output === 'number') pricing.outputMicrosPerToken = output
  if (typeof cacheRead === 'number') pricing.cacheReadMicrosPerToken = cacheRead
  if (typeof cacheWrite === 'number') pricing.cacheWriteMicrosPerToken = cacheWrite
  return pricing
}

// --- Workers AI search API: GET /accounts/{id}/ai/models/search -------------
// Each model: { name, task: { name }, properties: [{ property_id, value }] }.

interface WorkersAiModel {
  name?: unknown
  task?: { name?: unknown } | null
  properties?: Array<{ property_id?: unknown; value?: unknown }> | null
}

function propertyMap(model: WorkersAiModel): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const prop of model.properties ?? []) {
    if (typeof prop?.property_id === 'string') {
      map.set(prop.property_id, prop.value)
    }
  }
  return map
}

function workersAiPricing(priceProp: unknown): Record<string, number> {
  if (!Array.isArray(priceProp)) {
    return {}
  }
  let input: number | undefined
  let output: number | undefined
  for (const tier of priceProp) {
    if (!tier || typeof tier !== 'object') continue
    const unit = (tier as { unit?: unknown }).unit
    const price = (tier as { price?: unknown }).price
    if (typeof unit !== 'string' || typeof price !== 'number') continue
    if (/per M input tokens/i.test(unit)) input = price
    else if (/per M output tokens/i.test(unit)) output = price
  }
  return pricingMicros(input, output)
}

// Returns null for anything that is not a tool-driving text-generation model:
// non-text tasks, models without `function_calling`, and denylisted ids.
export function catalogModelFromWorkersAi(model: WorkersAiModel): CatalogModel | null {
  const modelId = typeof model.name === 'string' ? model.name : null
  if (!modelId || TOOL_CALL_DENYLIST.has(modelId)) {
    return null
  }
  if (typeof model.task?.name !== 'string' || model.task.name !== 'Text Generation') {
    return null
  }
  const props = propertyMap(model)
  if (props.get('function_calling') !== 'true') {
    return null
  }
  const capabilities = ['text', 'tools']
  if (props.get('vision') === 'true') capabilities.push('vision')
  if (props.get('reasoning') === 'true') capabilities.push('reasoning')
  const ctx = props.get('context_window')
  return {
    vendor: vendorFromModelId(modelId),
    modelId,
    displayName: displayNameFromModelId(modelId),
    serving: 'workers-ai-native',
    capabilities,
    contextWindow: typeof ctx === 'string' && Number.isFinite(Number(ctx)) ? Number(ctx) : null,
    pricing: workersAiPricing(props.get('price')),
    availability: 'available',
    metadata: {},
  }
}

// --- models.dev: GET https://models.dev/api.json ----------------------------
// Shape: { [vendor]: { models: { [id]: ModelsDevModel } } }.

interface ModelsDevModel {
  name?: unknown
  tool_call?: unknown
  reasoning?: unknown
  modalities?: { input?: unknown } | null
  limit?: { context?: unknown } | null
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown } | null
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// Maps one models.dev entry under a vendor to a gateway-served catalog row.
// Returns null for non-tool-callers (the agent runtime needs tool loops).
export function catalogModelFromModelsDev(vendor: string, id: string, model: ModelsDevModel): CatalogModel | null {
  if (model.tool_call !== true) {
    return null
  }
  const modelId = `${vendor}/${id}`
  const capabilities = ['text', 'tools']
  const inputModalities = model.modalities?.input
  if (Array.isArray(inputModalities) && inputModalities.includes('image')) capabilities.push('vision')
  if (model.reasoning === true) capabilities.push('reasoning')
  const cost = model.cost ?? {}
  return {
    vendor,
    modelId,
    displayName: typeof model.name === 'string' && model.name.length > 0 ? model.name : id,
    serving: 'ai-gateway',
    capabilities,
    contextWindow: numberOrUndefined(model.limit?.context) ?? null,
    pricing: pricingMicros(
      numberOrUndefined(cost.input),
      numberOrUndefined(cost.output),
      numberOrUndefined(cost.cache_read),
      numberOrUndefined(cost.cache_write),
    ),
    availability: 'available',
    metadata: {},
  }
}
