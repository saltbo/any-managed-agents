import type { Deps } from './deps'
import type { AuthScope, BudgetRecord, EffectivePolicyResult, PolicyDecisionResult } from './ports'

export interface EffectivePolicyView {
  source: EffectivePolicyResult['source']
  sources: EffectivePolicyResult['sources']
  toolPolicy: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  sandboxPolicy: Record<string, unknown>
  budgets: BudgetRecord[]
  decision?: PolicyDecisionResult
}

// Reads the merged effective governance policy: the hierarchy-resolved policy
// objects + enabled budgets. When providerId+modelId are supplied, attaches a
// provider policy decision and audits the evaluation. teamId resolves the policy
// as a member of that team.
export async function readEffectivePolicy(
  deps: Deps,
  auth: AuthScope,
  query: { teamId?: string; providerId?: string; modelId?: string; requestId?: string | null },
): Promise<EffectivePolicyView> {
  const scopedAuth: AuthScope = query.teamId ? { ...auth, teams: [query.teamId] } : auth
  const effective = await deps.policy.resolveEffective(scopedAuth)
  const budgets = await deps.budgets.listEnabled(auth.project.id)

  let decision: PolicyDecisionResult | undefined
  if (query.providerId && query.modelId) {
    decision = await deps.policy.evaluateProvider(scopedAuth, { providerId: query.providerId, modelId: query.modelId })
    await deps.audit.record(auth, {
      action: 'policy.evaluate',
      resourceType: 'policy',
      resourceId: decision.rule,
      outcome: decision.allowed ? 'success' : 'denied',
      requestId: query.requestId ?? null,
      policyCategory: decision.category,
      metadata: {
        providerId: query.providerId,
        modelId: query.modelId,
        ...(decision.allowed ? {} : { decision }),
      },
    })
  }

  return {
    source: effective.source,
    sources: effective.sources,
    toolPolicy: effective.toolPolicy,
    mcpPolicy: effective.mcpPolicy,
    sandboxPolicy: effective.sandboxPolicy,
    budgets,
    ...(decision ? { decision } : {}),
  }
}
