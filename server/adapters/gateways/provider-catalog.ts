import type { ProviderCatalogGateway } from '@server/usecases/ports'
import { type DiscoveredProviderModel, parseProviderModelCatalog, providerFamily } from '../../providers/adapters'

const FAMILY_DEFAULT_BASE_URLS: Record<string, string | undefined> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://127.0.0.1:11434',
}

const DISCOVERY_TIMEOUT_MS = 10_000

// Fetches the provider's live model list. Discovery never sends or echoes
// stored credential references; failures bubble raw and are normalized by the
// usecase so responses stay credential-free.
export function createProviderCatalogGateway(): ProviderCatalogGateway {
  return {
    async fetchCatalog(provider): Promise<DiscoveredProviderModel[]> {
      const family = providerFamily(provider.type)
      const baseUrl = (provider.baseUrl ?? FAMILY_DEFAULT_BASE_URLS[family])?.replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('invalid request: provider base URL is required for model discovery')
      }
      const url = family === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw Object.assign(new Error(`provider model discovery returned HTTP ${response.status}`), {
          status: response.status,
        })
      }
      return parseProviderModelCatalog(family, await response.json())
    },
  }
}
