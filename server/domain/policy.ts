// Pure governance policy rules. Zero outward imports — directly unit-testable.
//
// Two concerns live here: hierarchy merge (org → team → project policy objects
// combine with most-restrictive semantics) and the field-level validation rules
// for policy/access-rule/budget scopes. The DB-mixed evaluation (provider
// access decisions, effective-policy resolution) stays in server/policy.ts,
// which reuses mergePolicyObjects from here.

export type FieldErrors = Record<string, string>

export type PolicyScopeLevel = 'organization' | 'team' | 'project'
export type BudgetScope = 'project' | 'provider' | 'model'

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// ─── Policy hierarchy merge ───────────────────────────────────────────────────

const RESTRICTIVE_NETWORK_VALUES = new Set(['disabled', 'deny', 'offline'])

function isAllowListKey(key: string) {
  return key.startsWith('allowed')
}

function isUnionListKey(key: string) {
  return key.startsWith('blocked') || key.startsWith('denied') || key.startsWith('requireApproval')
}

function intersectAllowLists(current: string[], next: string[]) {
  if (current.includes('*')) {
    return next
  }
  if (next.includes('*')) {
    return current
  }
  return current.filter((item) => next.includes(item))
}

// Merges one policy object (toolPolicy/mcpPolicy/sandboxPolicy/budgetPolicy)
// across hierarchy levels ordered organization → team → project:
// blocked/denied/requireApproval lists union, allow lists intersect ('*' is
// identity), defaultEffect 'deny' is sticky, booleans AND (false is sticky),
// restrictive network/status strings are sticky, numbers take the minimum,
// nested objects shallow-merge with the most specific level last, and any
// other scalar takes the most specific level's value.
export function mergePolicyObjects(levels: Record<string, unknown>[]) {
  const merged: Record<string, unknown> = {}
  for (const level of levels) {
    for (const [key, value] of Object.entries(level)) {
      if (!(key in merged)) {
        merged[key] = value
        continue
      }
      const current = merged[key]
      if (Array.isArray(current) && Array.isArray(value)) {
        if (isUnionListKey(key)) {
          merged[key] = [...new Set([...stringArray(current), ...stringArray(value)])]
          continue
        }
        if (isAllowListKey(key)) {
          merged[key] = intersectAllowLists(stringArray(current), stringArray(value))
          continue
        }
        merged[key] = value
        continue
      }
      if (key === 'defaultEffect') {
        merged[key] = current === 'deny' || value === 'deny' ? 'deny' : value
        continue
      }
      if (typeof current === 'boolean' && typeof value === 'boolean') {
        merged[key] = current && value
        continue
      }
      if (typeof current === 'number' && typeof value === 'number') {
        merged[key] = Math.min(current, value)
        continue
      }
      if (typeof current === 'string' && RESTRICTIVE_NETWORK_VALUES.has(current)) {
        continue
      }
      if (current && value && typeof current === 'object' && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
        continue
      }
      merged[key] = value
    }
  }
  return merged
}

// ─── Scope validation rules ───────────────────────────────────────────────────

// Team-scoped policies require a teamId; org/project scopes must not carry one.
export function validatePolicyScope(scope: { level: PolicyScopeLevel; teamId?: string }): FieldErrors | null {
  const fields: FieldErrors = {}
  if (scope.level === 'team' && !scope.teamId) {
    fields['scope.teamId'] = 'Team-scoped policies require teamId.'
  }
  if (scope.level !== 'team' && scope.teamId) {
    fields['scope.teamId'] = 'teamId is only valid for team-scoped policies.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

// Scope is the row identity and may not move after creation.
export function policyScopeChanged(
  next: { level: PolicyScopeLevel; teamId?: string },
  current: { level: PolicyScopeLevel; teamId: string | null },
) {
  return next.level !== current.level || (next.teamId ?? null) !== current.teamId
}

// Provider/model-scoped budgets need the matching identifier.
export function validateBudgetScope(input: {
  scope: BudgetScope
  providerId?: string
  modelId?: string
}): FieldErrors | null {
  const fields: FieldErrors = {}
  if (input.scope === 'provider' && !input.providerId) {
    fields.providerId = 'Provider-scoped budgets require providerId.'
  }
  if (input.scope === 'model' && !input.modelId) {
    fields.modelId = 'Model-scoped budgets require modelId.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

// Provider/model allow|deny access rules surface in the effective policy split
// by whether they carry a model scope: model-less rules are provider rules,
// model-scoped rules are model rules. '*' is the unscoped wildcard.
export function accessRuleView(rule: { providerId: string; modelId: string; effect: string; reason: string | null }) {
  return {
    ...(rule.providerId === '*' ? {} : { providerId: rule.providerId }),
    ...(rule.modelId === '*' ? {} : { modelId: rule.modelId }),
    effect: rule.effect as 'allow' | 'deny',
    ...(rule.reason ? { reason: rule.reason } : {}),
  }
}
