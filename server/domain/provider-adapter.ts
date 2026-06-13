// Pure provider-family business rules: error normalization, usage extraction,
// model-catalog parsing, and pricing math. Zero outward imports — the
// normalization rules that keep provider-specific payload shapes out of the
// session protocol (canonical events and usage records only ever carry
// normalized values, never raw provider payloads or credential material) are
// directly unit-testable.

export const PROVIDER_FAMILIES = ['workers-ai', 'anthropic', 'openai', 'openai-compatible', 'ollama'] as const
export type ProviderFamily = (typeof PROVIDER_FAMILIES)[number]

export const PROVIDER_ERROR_CATEGORIES = [
  'auth',
  'quota',
  'rate_limit',
  'model_unavailable',
  'invalid_request',
  'network',
  'unknown',
] as const
export type ProviderErrorCategory = (typeof PROVIDER_ERROR_CATEGORIES)[number]

export interface NormalizedProviderError {
  type: 'provider_error'
  family: ProviderFamily
  category: ProviderErrorCategory
  // Safe, actionable template message. Raw provider payloads are never copied.
  message: string
  retryable: boolean
  retryAfterSeconds?: number
}

export interface NormalizedProviderUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface DiscoveredProviderModel {
  modelId: string
  displayName: string
  capabilities: string[]
  contextWindow: number | null
  pricing: Record<string, unknown>
  availability: 'available' | 'unavailable'
  metadata: Record<string, unknown>
}

export function isProviderErrorCategory(value: unknown): value is ProviderErrorCategory {
  return typeof value === 'string' && (PROVIDER_ERROR_CATEGORIES as readonly string[]).includes(value)
}

// Maps configured provider types and runtime provider names onto an adapter
// family. The Pi runtime reports Workers AI as `cloudflare-workers-ai`;
// `other` providers speak the OpenAI-compatible wire format by definition.
export function providerFamily(value: string | null | undefined): ProviderFamily {
  if (!value) {
    return 'openai-compatible'
  }
  if (value === 'cloudflare-workers-ai' || value === 'workers-ai') {
    return 'workers-ai'
  }
  if ((PROVIDER_FAMILIES as readonly string[]).includes(value)) {
    return value as ProviderFamily
  }
  return 'openai-compatible'
}

const CATEGORY_MESSAGES: Record<ProviderErrorCategory, string> = {
  auth: 'Provider rejected the configured credential. Update the provider credential reference.',
  quota: 'Provider account quota is exhausted. Review the provider plan or budget.',
  rate_limit: 'Provider rate limit reached. Retry after the provider cooldown.',
  model_unavailable: 'Requested model is unavailable at the provider. Pick another model from the catalog.',
  invalid_request: 'Provider rejected the request as invalid. Review the agent model configuration.',
  network: 'Provider is unreachable or the network request failed. Retry once connectivity recovers.',
  unknown: 'Provider request failed. Inspect the provider status and retry.',
}

const RETRYABLE_CATEGORIES: ReadonlySet<ProviderErrorCategory> = new Set(['rate_limit', 'network'])

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

interface ProviderErrorSignals {
  status: number | null
  code: string | null
  text: string
  retryAfterSeconds: number | null
}

function providerErrorSignals(error: unknown): ProviderErrorSignals {
  const record = objectValue(error)
  const nested = objectValue(record.error)
  const status = numberValue(record.status) ?? numberValue(record.statusCode) ?? numberValue(nested.status)
  const code = stringValue(record.code) ?? stringValue(nested.code) ?? stringValue(nested.type)
  const headers = objectValue(record.headers)
  const retryAfterSeconds =
    numberValue(record.retryAfterSeconds) ??
    numberValue(nested.retry_after) ??
    numberValue(headers['retry-after']) ??
    null
  const text = [
    error instanceof Error ? `${error.name} ${error.message}` : '',
    stringValue(record.message) ?? '',
    stringValue(nested.message) ?? '',
    code ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return { status, code, text, retryAfterSeconds }
}

function categoryForSignals(signals: ProviderErrorSignals): ProviderErrorCategory {
  const { status, text } = signals
  if (/insufficient_quota|quota|billing|payment required/.test(text)) {
    return 'quota'
  }
  if (/invalid_api_key|api key|unauthorized|authentication|permission denied|forbidden/.test(text)) {
    return 'auth'
  }
  if (/rate.?limit|too many requests|overloaded/.test(text)) {
    return 'rate_limit'
  }
  if (/model.{0,40}(not found|unavailable|does not exist|decommissioned)|model_not_found|no such model/.test(text)) {
    return 'model_unavailable'
  }
  if (/content.?filter|safety|invalid request|invalid_request|validation/.test(text)) {
    return 'invalid_request'
  }
  if (/fetch failed|network|timed?.?out|abort|econnrefused|econnreset|enotfound|dns|socket|unreachable/.test(text)) {
    return 'network'
  }
  if (status === 401 || status === 403) {
    return 'auth'
  }
  if (status === 402) {
    return 'quota'
  }
  if (status === 404) {
    return 'model_unavailable'
  }
  if (status === 429) {
    return 'rate_limit'
  }
  if (status !== null && status >= 400 && status < 500) {
    return 'invalid_request'
  }
  if (status === 503 || status === 529) {
    return 'rate_limit'
  }
  if (status !== null && status >= 500) {
    return 'network'
  }
  return 'unknown'
}

// Undici/workerd surface connection failures as TypeError('fetch failed').
function isTransportError(error: unknown) {
  return error instanceof TypeError
}

export function normalizeProviderError(family: ProviderFamily, error: unknown): NormalizedProviderError {
  const signals = providerErrorSignals(error)
  let category = categoryForSignals(signals)
  if (category === 'unknown' && isTransportError(error)) {
    category = 'network'
  }
  const retryable = RETRYABLE_CATEGORIES.has(category)
  return {
    type: 'provider_error',
    family,
    category,
    message: CATEGORY_MESSAGES[category],
    retryable,
    ...(retryable && signals.retryAfterSeconds !== null ? { retryAfterSeconds: signals.retryAfterSeconds } : {}),
  }
}

export function extractProviderUsage(family: ProviderFamily, raw: unknown): NormalizedProviderUsage | null {
  const record = objectValue(raw)
  if (family === 'ollama') {
    const prompt = numberValue(record.prompt_eval_count)
    const completion = numberValue(record.eval_count)
    if (prompt === null && completion === null) {
      return null
    }
    return usageTotals(prompt ?? 0, completion ?? 0, null, 0, 0)
  }
  const usage = objectValue(record.usage)
  if (Object.keys(usage).length === 0) {
    return null
  }
  if (family === 'anthropic') {
    return usageTotals(
      numberValue(usage.input_tokens) ?? 0,
      numberValue(usage.output_tokens) ?? 0,
      null,
      numberValue(usage.cache_read_input_tokens) ?? 0,
      numberValue(usage.cache_creation_input_tokens) ?? 0,
    )
  }
  return usageTotals(
    numberValue(usage.prompt_tokens) ?? numberValue(usage.input_tokens) ?? 0,
    numberValue(usage.completion_tokens) ?? numberValue(usage.output_tokens) ?? 0,
    numberValue(usage.total_tokens),
    numberValue(usage.cache_read_input_tokens) ?? 0,
    numberValue(usage.cache_creation_input_tokens) ?? 0,
  )
}

function usageTotals(
  promptTokens: number,
  completionTokens: number,
  totalTokens: number | null,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): NormalizedProviderUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens ?? promptTokens + completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

// Pricing metadata contract for providerModels.pricing: micro-USD per token,
// split by direction. Catalog rows without these keys yield null cost and the
// usage record is stored unpriced.
export function computeModelCostMicros(
  pricing: Record<string, unknown>,
  usage: Pick<NormalizedProviderUsage, 'promptTokens' | 'completionTokens'>,
): number | null {
  const input = numberValue(pricing.inputMicrosPerToken)
  const output = numberValue(pricing.outputMicrosPerToken)
  if (input === null && output === null) {
    return null
  }
  return Math.round(usage.promptTokens * (input ?? 0) + usage.completionTokens * (output ?? 0))
}

// Parses a provider model-list payload into catalog entries. Only known safe
// fields are copied; arbitrary provider payload content never lands in D1.
export function parseProviderModelCatalog(family: ProviderFamily, payload: unknown): DiscoveredProviderModel[] {
  const record = objectValue(payload)
  if (family === 'ollama') {
    const models = Array.isArray(record.models) ? record.models : null
    if (!models) {
      throw new Error('Provider model list payload is not recognized')
    }
    return models.map((item) => {
      const model = objectValue(item)
      const id = stringValue(model.name) ?? stringValue(model.model)
      if (!id) {
        throw new Error('Provider model entry is missing an id')
      }
      return discoveredModel(id, id, model)
    })
  }
  const data = Array.isArray(record.data) ? record.data : null
  if (!data) {
    throw new Error('Provider model list payload is not recognized')
  }
  return data.map((item) => {
    const model = objectValue(item)
    const id = stringValue(model.id)
    if (!id) {
      throw new Error('Provider model entry is missing an id')
    }
    return discoveredModel(id, stringValue(model.display_name) ?? stringValue(model.name) ?? id, model)
  })
}

function discoveredModel(id: string, displayName: string, model: Record<string, unknown>): DiscoveredProviderModel {
  const capabilities = Array.isArray(model.capabilities)
    ? model.capabilities.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  const pricing = objectValue(model.pricing)
  return {
    modelId: id,
    displayName,
    capabilities: capabilities.length > 0 ? capabilities : ['text'],
    contextWindow: numberValue(model.context_window) ?? numberValue(model.context_length) ?? null,
    pricing,
    availability: 'available',
    metadata: {},
  }
}
