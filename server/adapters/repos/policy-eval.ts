import type { BudgetRule, BudgetUsageRecord, PolicyLevel } from '@server/domain/policy'
import type { AuthScope, PolicyEvalRepo, PolicyProvider } from '@server/usecases/ports'
import { and, desc, eq, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { budgets, policies, providers, usageRecords } from '../../db/schema'

type Db = ReturnType<typeof drizzle>

export function createPolicyEvalRepo(db: Db): PolicyEvalRepo {
  return {
    async policyLevels(auth: AuthScope): Promise<PolicyLevel[]> {
      const rows = await db
        .select()
        .from(policies)
        .where(
          or(
            and(eq(policies.scope, 'project'), eq(policies.projectId, auth.project.id)),
            and(eq(policies.scope, 'organization'), eq(policies.organizationId, auth.organization.id)),
            and(eq(policies.scope, 'team'), eq(policies.organizationId, auth.organization.id)),
          ),
        )
        .orderBy(desc(policies.updatedAt))
      return rows.map((row) => ({
        id: row.id,
        scope: row.scope as PolicyLevel['scope'],
        teamId: row.teamId,
        toolPolicy: row.toolPolicy,
        mcpPolicy: row.mcpPolicy,
        sandboxPolicy: row.sandboxPolicy,
        updatedAt: row.updatedAt,
      }))
    },

    // Providers are a GLOBAL vendor catalog (not per-project): resolve by id, or
    // by slug for the platform-default 'workers-ai' lookup. projectId is accepted
    // to satisfy the port but no longer scopes the query.
    async findProvider(_projectId: string, providerId: string): Promise<PolicyProvider | null> {
      const row = await db
        .select()
        .from(providers)
        .where(providerId === 'workers-ai' ? eq(providers.slug, 'workers-ai') : eq(providers.id, providerId))
        .orderBy(desc(providers.updatedAt))
        .get()
      return row
        ? {
            id: row.id,
            enabled: row.enabled,
            // BYOK credentials were removed; a global vendor only needs to be
            // enabled. Always usable as far as credentials go.
            credentialId: null,
            credentialVersionId: null,
          }
        : null
    },

    // BYOK was removed: provider rows carry no credential, so there is nothing to
    // revoke. Enablement is gated in evaluateProviderPolicy.
    async providerCredentialUsable(_auth: AuthScope, _provider: PolicyProvider): Promise<boolean> {
      return true
    },

    async successfulUsage(projectId: string): Promise<BudgetUsageRecord[]> {
      const rows = await db
        .select()
        .from(usageRecords)
        .where(and(eq(usageRecords.projectId, projectId), eq(usageRecords.state, 'success')))
      return rows.map((record) => ({
        createdAt: record.createdAt,
        costMicros: record.costMicros,
        totalTokens: record.totalTokens,
        sessionId: record.sessionId,
      }))
    },

    async enabledBudgets(projectId: string): Promise<BudgetRule[]> {
      const rows = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.projectId, projectId), eq(budgets.enabled, true)))
      return rows.map((budget) => ({
        id: budget.id,
        providerId: budget.providerId,
        modelId: budget.modelId,
        limitType: budget.limitType,
        limitValue: budget.limitValue,
        window: budget.window,
      }))
    },
  }
}
