import type { CatalogModel } from '@server/domain/model-catalog'
import { normalizeProviderError, type ProviderErrorCategory } from '@server/domain/provider-adapter'
import type { Deps } from './deps'

export interface CatalogRefreshResult {
  outcome: 'succeeded' | 'failed'
  discoveredCount: number
  vendors: number
  category?: ProviderErrorCategory
}

function vendorDisplayName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Refreshes the GLOBAL model catalog from the discovery feeds (CF Workers AI
// search + models.dev). Upserts a vendor provider row per slug and its models,
// then records catalog health. Invoked by the scheduled handler (and the admin
// refresh endpoint); no per-tenant scope. Failures are normalized to a stable
// category — raw provider payloads never surface.
export async function refreshPlatformCatalog(deps: Deps): Promise<CatalogRefreshResult> {
  let catalog: CatalogModel[]
  try {
    catalog = await deps.providerCatalog.fetchPlatformCatalog()
  } catch (error) {
    const normalized = normalizeProviderError('workers-ai', error)
    const failedAt = new Date().toISOString()
    const lastError = {
      type: 'provider_error',
      category: normalized.category,
      message: normalized.message,
      occurredAt: failedAt,
    }
    for (const provider of await deps.providers.list()) {
      await deps.providers.setCatalogStatus(provider.id, { modelCatalogState: 'error', lastError }, failedAt)
    }
    return { outcome: 'failed', discoveredCount: 0, vendors: 0, category: normalized.category }
  }

  const byVendor = new Map<string, CatalogModel[]>()
  for (const model of catalog) {
    const models = byVendor.get(model.vendor) ?? []
    models.push(model)
    byVendor.set(model.vendor, models)
  }

  const upsertedAt = new Date().toISOString()
  for (const [vendor, models] of byVendor) {
    const provider = await deps.providers.upsert({ slug: vendor, displayName: vendorDisplayName(vendor) }, upsertedAt)
    for (const model of models) {
      await deps.providers.upsertModel(
        {
          providerId: provider.id,
          modelId: model.modelId,
          displayName: model.displayName,
          capabilities: model.capabilities,
          contextWindow: model.contextWindow,
          pricing: model.pricing,
          availability: model.availability,
          metadata: model.metadata,
        },
        upsertedAt,
      )
    }
    await deps.providers.setCatalogStatus(provider.id, { modelCatalogState: 'ready', lastError: null }, upsertedAt)
  }
  return { outcome: 'succeeded', discoveredCount: catalog.length, vendors: byVendor.size }
}
