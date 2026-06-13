import { type BudgetScope, validateBudgetScope } from '@server/domain/policy'
import type { Deps } from './deps'
import { type AuthScope, type BudgetRecord, GovernanceValidationError } from './ports'

export interface CreateBudgetInputDto {
  scope: BudgetScope
  providerId: string | null
  modelId: string | null
  limitType: 'tokens' | 'cost_micros' | 'sessions'
  limitValue: number
  window: 'day' | 'month'
  enabled: boolean
  metadata: Record<string, unknown>
}

// Creates a budget after validating that a provider/model-scoped budget carries
// the matching identifier.
export async function createBudget(deps: Deps, auth: AuthScope, input: CreateBudgetInputDto): Promise<BudgetRecord> {
  const scopeError = validateBudgetScope({
    scope: input.scope,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
  })
  if (scopeError) {
    throw new GovernanceValidationError('Budget is invalid', scopeError)
  }
  return await deps.budgets.insert(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      scope: input.scope,
      providerId: input.providerId,
      modelId: input.modelId,
      limitType: input.limitType,
      limitValue: input.limitValue,
      window: input.window,
      enabled: input.enabled,
      metadata: input.metadata,
    },
    new Date().toISOString(),
  )
}

// PATCH merges over the existing budget: scope, providerId, modelId, and
// limitType are immutable (create-time identity); only limit/window/enabled/
// metadata change.
export interface UpdateBudgetPatch {
  limitValue?: number
  window?: 'day' | 'month'
  enabled?: boolean
  metadata?: Record<string, unknown>
}

export async function updateBudget(
  deps: Deps,
  auth: AuthScope,
  existing: BudgetRecord,
  patch: UpdateBudgetPatch,
): Promise<BudgetRecord> {
  return await deps.budgets.update(
    auth.project.id,
    existing.id,
    {
      limitValue: patch.limitValue ?? existing.limitValue,
      window: patch.window ?? existing.window,
      enabled: patch.enabled ?? existing.enabled,
      metadata: patch.metadata ?? existing.metadata,
    },
    new Date().toISOString(),
  )
}
