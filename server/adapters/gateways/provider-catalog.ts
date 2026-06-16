import { type CatalogModel, catalogModelFromModelsDev } from '@server/domain/model-catalog'
import type { ProviderCatalogGateway } from '@server/usecases/ports'

const DISCOVERY_TIMEOUT_MS = 15_000
const MODELS_DEV_URL = 'https://models.dev/api.json'

// The discovery sources, all from models.dev (no API key): cloudflare-workers-ai
// is the native free @cf catalog; anthropic/openai are the gateway-routed
// third-party families. models.dev keys @cf entries by their full `@cf/...` id,
// so the mapper resolves vendor + serving from the id itself.
const MODELS_DEV_PROVIDERS = ['cloudflare-workers-ai', 'anthropic', 'openai'] as const

// Fetches the platform's live model catalog from models.dev. No credential
// needed. Throws on transport/HTTP failure (normalized by the usecase).
export function createProviderCatalogGateway(): ProviderCatalogGateway {
  return {
    async fetchPlatformCatalog(): Promise<CatalogModel[]> {
      const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
      if (!response.ok) {
        throw Object.assign(new Error(`model discovery returned HTTP ${response.status} for ${MODELS_DEV_URL}`), {
          status: response.status,
        })
      }
      const payload = (await response.json()) as Record<string, { models?: Record<string, unknown> }>
      const rows: CatalogModel[] = []
      for (const providerKey of MODELS_DEV_PROVIDERS) {
        const models = payload[providerKey]?.models ?? {}
        for (const [id, model] of Object.entries(models)) {
          const row = catalogModelFromModelsDev(providerKey, id, model as Record<string, unknown>)
          if (row) {
            rows.push(row)
          }
        }
      }
      return rows
    },
  }
}
