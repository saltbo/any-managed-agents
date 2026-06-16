import { type CatalogModel, catalogModelFromModelsDev, catalogModelFromWorkersAi } from '@server/domain/model-catalog'
import type { Env } from '@server/env'
import type { ProviderCatalogGateway } from '@server/usecases/ports'

const DISCOVERY_TIMEOUT_MS = 15_000
const MODELS_DEV_URL = 'https://models.dev/api.json'

// Third-party vendors surfaced through AI Gateway. Their model metadata comes
// from models.dev (no provider key needed); only these vendors are pulled so the
// catalog stays to gateway-routable families.
const THIRD_PARTY_VENDORS = ['anthropic', 'openai'] as const

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
  if (!response.ok) {
    throw Object.assign(new Error(`model discovery returned HTTP ${response.status} for ${url}`), {
      status: response.status,
    })
  }
  return response.json()
}

// Native @cf models from the Workers AI search API (free, includes the
// function_calling/context/pricing properties the catalog maps).
async function fetchWorkersAiModels(env: Env): Promise<CatalogModel[]> {
  const accountId = env.AMA_WORKERS_AI_ACCOUNT_ID
  const token = env.AMA_WORKERS_AI_API_TOKEN ?? env.AMA_CLOUDFLARE_API_TOKEN
  if (!accountId || !token) {
    throw new Error('invalid request: Workers AI account id and API token are required for model discovery')
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text+Generation&hide_experimental=true&per_page=100`
  const payload = await fetchJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  const result = (payload as { result?: unknown }).result
  if (!Array.isArray(result)) {
    throw new Error('Workers AI model search payload is not recognized')
  }
  return result.map((model) => catalogModelFromWorkersAi(model as Record<string, unknown>)).filter(isCatalogModel)
}

// Third-party gateway models from models.dev: { [vendor]: { models: { [id]: … } } }.
async function fetchModelsDevModels(): Promise<CatalogModel[]> {
  const payload = (await fetchJson(MODELS_DEV_URL)) as Record<string, { models?: Record<string, unknown> }>
  const rows: CatalogModel[] = []
  for (const vendor of THIRD_PARTY_VENDORS) {
    const models = payload[vendor]?.models ?? {}
    for (const [id, model] of Object.entries(models)) {
      const row = catalogModelFromModelsDev(vendor, id, model as Record<string, unknown>)
      if (row) {
        rows.push(row)
      }
    }
  }
  return rows
}

function isCatalogModel(value: CatalogModel | null): value is CatalogModel {
  return value !== null
}

// Fetches the platform's live model catalog from both discovery feeds. Either
// feed failing throws; the usecase records the refresh as errored.
export function createProviderCatalogGateway(env: Env): ProviderCatalogGateway {
  return {
    async fetchPlatformCatalog(): Promise<CatalogModel[]> {
      const [workersAi, modelsDev] = await Promise.all([fetchWorkersAiModels(env), fetchModelsDevModels()])
      return [...workersAi, ...modelsDev]
    },
  }
}
