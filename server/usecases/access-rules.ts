import type { Deps } from './deps'
import type { AccessRuleRecord, AuthScope } from './ports'

// PATCH merges over the existing rule: only present fields change. An absent
// reason leaves the stored value; an explicit null clears it.
export interface UpdateAccessRulePatch {
  effect?: 'allow' | 'deny'
  reason?: string | null
  metadata?: Record<string, unknown>
}

export async function updateAccessRule(
  deps: Deps,
  auth: AuthScope,
  existing: AccessRuleRecord,
  patch: UpdateAccessRulePatch,
): Promise<AccessRuleRecord> {
  return await deps.accessRules.update(
    auth.project.id,
    existing.id,
    {
      effect: patch.effect ?? existing.effect,
      reason: patch.reason !== undefined ? patch.reason : existing.reason,
      metadata: patch.metadata ?? existing.metadata,
    },
    new Date().toISOString(),
  )
}
