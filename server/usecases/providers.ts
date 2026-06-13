import { validateProviderBaseUrl } from '@server/domain/provider'
import { type DiscoveredProviderModel, normalizeProviderError, providerFamily } from '@server/domain/provider-adapter'
import type { Deps } from './deps'
import {
  type AuthScope,
  type CreateProviderInput,
  type ProviderRecord,
  ProviderReferencedError,
  ProviderValidationError,
  type UpdateProviderFields,
} from './ports'

export interface CreateProviderInputDto {
  type: CreateProviderInput['type']
  displayName: string
  baseUrl: string | null
  isDefault: boolean
  credentialId: string | null
  credentialVersionId: string | null
  metadata: Record<string, unknown>
  rateLimits: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
}

export async function createProvider(
  deps: Deps,
  auth: AuthScope,
  input: CreateProviderInputDto,
): Promise<ProviderRecord> {
  const baseUrlError = validateProviderBaseUrl(input.type, input.baseUrl)
  if (baseUrlError) {
    throw new ProviderValidationError('Invalid provider configuration', baseUrlError)
  }
  const createdAt = new Date().toISOString()
  // A single default provider per project: promoting a new default demotes the
  // previous one before the insert.
  if (input.isDefault) {
    await deps.providers.clearDefaults(auth.project.id, createdAt)
  }
  return await deps.providers.insert(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      type: input.type,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      isDefault: input.isDefault,
      credentialId: input.credentialId,
      credentialVersionId: input.credentialVersionId,
      metadata: input.metadata,
      rateLimits: input.rateLimits,
      budgetPolicy: input.budgetPolicy,
    },
    createdAt,
  )
}

// Whether the PATCH explicitly carried a credentialRef field at all — null
// clears it, absence leaves it untouched. Sentinel distinguishes the two.
export type CredentialPatch = { credentialId: string | null; credentialVersionId: string | null } | undefined

export interface UpdateProviderPatch {
  type?: UpdateProviderFields['type']
  displayName?: string
  baseUrl?: string | null
  isDefault?: boolean
  enabled?: boolean
  credential?: CredentialPatch
  metadata?: Record<string, unknown>
  rateLimits?: Record<string, unknown>
  budgetPolicy?: Record<string, unknown>
}

export async function updateProvider(
  deps: Deps,
  auth: AuthScope,
  provider: ProviderRecord,
  patch: UpdateProviderPatch,
): Promise<ProviderRecord> {
  const nextType = patch.type ?? provider.type
  const nextBaseUrl = patch.baseUrl !== undefined ? patch.baseUrl : provider.baseUrl
  const baseUrlError = validateProviderBaseUrl(nextType, nextBaseUrl)
  if (baseUrlError) {
    throw new ProviderValidationError('Invalid provider configuration', baseUrlError)
  }
  const updatedAt = new Date().toISOString()
  if (patch.isDefault) {
    await deps.providers.clearDefaults(auth.project.id, updatedAt)
  }
  const fields: UpdateProviderFields = {
    type: nextType,
    displayName: patch.displayName ?? provider.displayName,
    baseUrl: nextBaseUrl,
    isDefault: patch.isDefault ?? provider.isDefault,
    enabled: patch.enabled ?? provider.enabled,
    credentialId: patch.credential !== undefined ? (patch.credential?.credentialId ?? null) : provider.credentialId,
    credentialVersionId:
      patch.credential !== undefined ? (patch.credential?.credentialVersionId ?? null) : provider.credentialVersionId,
    metadata: patch.metadata ?? provider.metadata,
    rateLimits: patch.rateLimits ?? provider.rateLimits,
    budgetPolicy: patch.budgetPolicy ?? provider.budgetPolicy,
  }
  return await deps.providers.update(auth.project.id, provider.id, fields, updatedAt)
}

export async function deleteProvider(deps: Deps, auth: AuthScope, provider: ProviderRecord): Promise<void> {
  if (await deps.providers.agentReferences(auth.project.id, provider.id)) {
    throw new ProviderReferencedError()
  }
  await deps.providers.delete(auth.project.id, provider.id)
}

export interface DiscoveryResult {
  task: import('./ports').ModelDiscoveryTaskRecord
  outcome: 'succeeded' | 'failed'
  discoveredCount: number
  category?: string
  retryable?: boolean
}

const WORKERS_AI_DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.6'

function workersAiCatalog(defaultModel: string | undefined): DiscoveredProviderModel[] {
  return [
    {
      modelId: defaultModel ?? WORKERS_AI_DEFAULT_MODEL,
      displayName: 'Workers AI default model',
      capabilities: ['text'],
      contextWindow: null,
      pricing: {},
      availability: 'available',
      metadata: { source: 'workers-ai-binding' },
    },
  ]
}

// Runs model discovery synchronously: inserts a running task, fetches the
// catalog (Workers AI from the binding default, others via the catalog
// gateway), upserts the discovered models, and resolves the task + provider
// catalog state to a terminal value. Failures are normalized to a stable
// category — raw provider payloads and credential references never surface.
export async function runModelDiscovery(
  deps: Deps,
  auth: AuthScope,
  provider: ProviderRecord,
  defaultModel: string | undefined,
): Promise<DiscoveryResult> {
  const createdAt = new Date().toISOString()
  const task = await deps.providers.insertDiscoveryTask(
    { organizationId: auth.organization.id, projectId: auth.project.id, providerId: provider.id },
    createdAt,
  )

  let discovered: DiscoveredProviderModel[]
  try {
    discovered =
      provider.type === 'workers-ai'
        ? workersAiCatalog(defaultModel)
        : await deps.providerCatalog.fetchCatalog({ type: provider.type, baseUrl: provider.baseUrl })
  } catch (error) {
    const failedAt = new Date().toISOString()
    const normalized = normalizeProviderError(providerFamily(provider.type), error)
    const lastError = {
      type: 'provider_error',
      category: normalized.category,
      message: normalized.message,
      retryable: normalized.retryable,
      ...(normalized.retryAfterSeconds !== undefined ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
      occurredAt: failedAt,
    }
    await deps.providers.setCatalogStatus(
      auth.project.id,
      provider.id,
      { modelCatalogState: 'error', lastError },
      failedAt,
    )
    const failedTask = await deps.providers.updateDiscoveryTask(
      auth.project.id,
      task.id,
      { state: 'failed', discoveredCount: null, error: lastError },
      failedAt,
    )
    return {
      task: failedTask,
      outcome: 'failed',
      discoveredCount: 0,
      category: normalized.category,
      retryable: normalized.retryable,
    }
  }

  const upsertedAt = new Date().toISOString()
  for (const model of discovered) {
    await deps.providers.upsertModel(
      {
        organizationId: auth.organization.id,
        projectId: auth.project.id,
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
  await deps.providers.setCatalogStatus(
    auth.project.id,
    provider.id,
    { modelCatalogState: 'ready', lastError: null },
    upsertedAt,
  )
  const succeededTask = await deps.providers.updateDiscoveryTask(
    auth.project.id,
    task.id,
    { state: 'succeeded', discoveredCount: discovered.length, error: null },
    upsertedAt,
  )
  return { task: succeededTask, outcome: 'succeeded', discoveredCount: discovered.length }
}
