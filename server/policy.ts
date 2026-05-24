import { and, desc, eq, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { AuthContext } from './auth/session'
import { budgets, governancePolicies, providerAccessRules, providerConfigs, usageRecords } from './db/schema'

type PolicyDb = ReturnType<typeof drizzle>

interface Rule {
  providerId?: string
  modelId?: string
  effect: 'allow' | 'deny'
  reason?: string
}

type BudgetPolicy = Record<string, unknown>

function parseJson<T>(value: string | null | undefined, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function currentMonthPrefix() {
  return new Date().toISOString().slice(0, 7)
}

export async function resolveEffectivePolicy(db: PolicyDb, auth: AuthContext) {
  const policy = await db
    .select()
    .from(governancePolicies)
    .where(and(eq(governancePolicies.projectId, auth.project.id), eq(governancePolicies.scope, 'project')))
    .orderBy(desc(governancePolicies.updatedAt))
    .get()
  const accessRules = await db
    .select()
    .from(providerAccessRules)
    .where(eq(providerAccessRules.projectId, auth.project.id))

  return {
    source: policy ? { type: 'project', id: policy.id } : { type: 'platform_default', id: 'workers-ai-default' },
    providerRules: policy ? parseJson<Rule[]>(policy.providerRules, []) : [],
    modelRules: policy ? parseJson<Rule[]>(policy.modelRules, []) : [],
    accessRules: accessRules.map((rule) => ({
      id: rule.id,
      providerId: rule.providerId,
      modelId: rule.modelId,
      teamId: rule.teamId,
      effect: rule.effect,
      reason: rule.reason,
    })),
    toolPolicy: policy ? parseJson<Record<string, unknown>>(policy.toolPolicy, {}) : {},
    mcpPolicy: policy ? parseJson<Record<string, unknown>>(policy.mcpPolicy, {}) : {},
    sandboxPolicy: policy ? parseJson<Record<string, unknown>>(policy.sandboxPolicy, {}) : {},
    budgetPolicy: policy ? parseJson<BudgetPolicy>(policy.budgetPolicy, {}) : {},
  }
}

export async function evaluateProviderPolicy(
  db: PolicyDb,
  auth: AuthContext,
  values: {
    providerId: string
    modelId: string
  },
) {
  const provider = await db
    .select()
    .from(providerConfigs)
    .where(
      and(
        eq(providerConfigs.projectId, auth.project.id),
        values.providerId === 'workers-ai'
          ? eq(providerConfigs.type, 'workers-ai')
          : eq(providerConfigs.id, values.providerId),
      ),
    )
    .orderBy(desc(providerConfigs.updatedAt))
    .get()

  if (provider && provider.status !== 'active') {
    return {
      allowed: false,
      category: 'provider',
      rule: provider.id,
      message: 'Provider is disabled for this project.',
    }
  }
  if (!provider && values.providerId !== 'workers-ai') {
    return {
      allowed: false,
      category: 'provider',
      rule: values.providerId,
      message: 'Provider is not configured for this project.',
    }
  }

  const accessRule = await db
    .select()
    .from(providerAccessRules)
    .where(
      and(
        eq(providerAccessRules.projectId, auth.project.id),
        or(
          eq(providerAccessRules.providerId, values.providerId),
          eq(providerAccessRules.providerId, provider?.id ?? ''),
        ),
        or(eq(providerAccessRules.modelId, values.modelId), eq(providerAccessRules.modelId, '*')),
      ),
    )
    .get()
  if (accessRule?.effect === 'deny') {
    return {
      allowed: false,
      category: 'provider',
      rule: accessRule.id,
      message: accessRule.reason ?? 'Provider or model is denied by governance policy.',
    }
  }

  const effective = await resolveEffectivePolicy(db, auth)
  const deniedRule = [...effective.providerRules, ...effective.modelRules].find(
    (rule) =>
      rule.effect === 'deny' &&
      (!rule.providerId || rule.providerId === values.providerId || rule.providerId === provider?.id) &&
      (!rule.modelId || rule.modelId === values.modelId || rule.modelId === '*'),
  )
  if (deniedRule) {
    return {
      allowed: false,
      category: deniedRule.modelId ? 'model' : 'provider',
      rule: deniedRule.modelId ?? deniedRule.providerId ?? 'policy',
      message: deniedRule.reason ?? 'Provider or model is denied by governance policy.',
    }
  }

  const month = currentMonthPrefix()
  const usage = await db
    .select()
    .from(usageRecords)
    .where(and(eq(usageRecords.projectId, auth.project.id), eq(usageRecords.status, 'success')))
  const monthUsage = usage.filter((record) => record.createdAt.startsWith(month))
  const totalCostMicros = monthUsage.reduce((sum, record) => sum + record.costMicros, 0)
  const totalTokens = monthUsage.reduce((sum, record) => sum + record.totalTokens, 0)
  const monthlyCostMicros =
    typeof effective.budgetPolicy.monthlyCostMicros === 'number' ? effective.budgetPolicy.monthlyCostMicros : undefined
  const monthlyTokens =
    typeof effective.budgetPolicy.monthlyTokens === 'number' ? effective.budgetPolicy.monthlyTokens : undefined
  if (monthlyCostMicros !== undefined && totalCostMicros >= monthlyCostMicros) {
    return {
      allowed: false,
      category: 'budget',
      rule: 'monthlyCostMicros',
      message: 'Monthly model cost budget is exhausted.',
    }
  }
  if (monthlyTokens !== undefined && totalTokens >= monthlyTokens) {
    return {
      allowed: false,
      category: 'budget',
      rule: 'monthlyTokens',
      message: 'Monthly model token budget is exhausted.',
    }
  }

  const activeBudget = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.projectId, auth.project.id), eq(budgets.status, 'active')))
    .get()
  if (activeBudget?.limitType === 'tokens' && totalTokens >= activeBudget.limitValue) {
    return {
      allowed: false,
      category: 'budget',
      rule: activeBudget.id,
      message: 'Usage budget is exhausted.',
    }
  }

  return { allowed: true, category: 'provider', rule: null, message: 'Allowed by effective policy.' }
}
