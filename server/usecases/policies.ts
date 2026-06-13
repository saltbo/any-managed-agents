import { policyScopeChanged, validatePolicyScope } from '@server/domain/policy'
import type { Deps } from './deps'
import {
  type AuthScope,
  GovernanceValidationError,
  type PolicyRecord,
  type PolicyScope,
  PolicyScopeConflictError,
} from './ports'

export interface CreatePolicyInputDto {
  scope: PolicyScope
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}

// Creates a scoped policy after validating the scope shape and enforcing a
// single document per scope (org/team/project). Throws on an invalid scope or a
// duplicate.
export async function createPolicy(deps: Deps, auth: AuthScope, input: CreatePolicyInputDto): Promise<PolicyRecord> {
  const scopeError = validatePolicyScope(input.scope)
  if (scopeError) {
    throw new GovernanceValidationError('Policy scope is invalid', scopeError)
  }
  const existing = await deps.policies.findByScope(auth.project.id, input.scope)
  if (existing) {
    throw new PolicyScopeConflictError(existing.id)
  }
  return await deps.policies.insert(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      scope: input.scope,
      toolPolicy: input.toolPolicy,
      mcpPolicy: input.mcpPolicy,
      sandboxPolicy: input.sandboxPolicy,
      metadata: input.metadata,
    },
    new Date().toISOString(),
  )
}

export interface ReplacePolicyInputDto {
  scope?: PolicyScope
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}

// PUT replaces the whole document: omitted policy objects reset to {}. Scope is
// the row identity and immutable — a body scope that differs is rejected.
export async function replacePolicy(
  deps: Deps,
  auth: AuthScope,
  existing: PolicyRecord,
  input: ReplacePolicyInputDto,
): Promise<PolicyRecord> {
  if (
    input.scope &&
    policyScopeChanged(input.scope, { level: existing.scope.level, teamId: existing.scope.teamId ?? null })
  ) {
    throw new GovernanceValidationError('Policy scope is immutable', {
      scope: 'Scope cannot change after creation. Delete the policy and create a new one.',
    })
  }
  return await deps.policies.replace(
    auth.project.id,
    existing.id,
    {
      toolPolicy: input.toolPolicy,
      mcpPolicy: input.mcpPolicy,
      sandboxPolicy: input.sandboxPolicy,
      metadata: input.metadata,
    },
    new Date().toISOString(),
  )
}
