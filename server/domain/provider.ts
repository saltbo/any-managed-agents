// Pure provider business rules. Zero outward imports — directly unit-testable.

export const PROVIDER_TYPES = ['workers-ai', 'anthropic', 'openai', 'openai-compatible', 'ollama', 'other'] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

export const MODEL_AVAILABILITY = ['available', 'unavailable', 'disabled'] as const
export type ModelAvailability = (typeof MODEL_AVAILABILITY)[number]

export const DISCOVERY_TASK_STATES = ['pending', 'running', 'succeeded', 'failed'] as const
export type DiscoveryTaskState = (typeof DISCOVERY_TASK_STATES)[number]

// The model catalog's operational state: 'ready' once a discovery has populated
// (or the platform default is synthesized), 'error' when the last refresh failed.
export const MODEL_CATALOG_STATES = ['ready', 'error'] as const
export type ModelCatalogState = (typeof MODEL_CATALOG_STATES)[number]

export type CredentialStatus = 'not_required' | 'configured' | 'missing'

export type FieldErrors = Record<string, string>

// Providers that run on the platform binding (Workers AI) or locally (Ollama)
// need no credential; others must carry one to be usable.
export function providerCredentialStatus(provider: { type: string; credentialId: string | null }): CredentialStatus {
  if (provider.type === 'workers-ai' || provider.type === 'ollama') {
    return provider.credentialId ? 'configured' : 'not_required'
  }
  return provider.credentialId ? 'configured' : 'missing'
}

// OpenAI-compatible gateways speak an arbitrary endpoint, so a base URL is
// mandatory. Returns a field error keyed to baseUrl, or null.
export function validateProviderBaseUrl(type: string, baseUrl: string | null): FieldErrors | null {
  if (type === 'openai-compatible' && !baseUrl) {
    return { baseUrl: 'OpenAI-compatible providers require a base URL.' }
  }
  return null
}
