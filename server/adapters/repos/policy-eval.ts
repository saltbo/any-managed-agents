import type { BudgetRule, BudgetUsageRecord, PolicyLevel } from '@server/domain/policy'
import type { AuthScope, PolicyConnection, PolicyEvalRepo, PolicyProvider } from '@server/usecases/ports'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import {
  budgets,
  connections,
  connectionTools,
  policies,
  providers,
  usageRecords,
  vaultCredentials,
  vaultCredentialVersions,
} from '../../db/schema'

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

    async findConnection(projectId: string, connectorId: string): Promise<PolicyConnection | null> {
      const row = await db
        .select()
        .from(connections)
        .where(and(eq(connections.projectId, projectId), eq(connections.connectorId, connectorId)))
        .get()
      return row
        ? {
            id: row.id,
            state: row.state,
            credentialId: row.credentialId,
            credentialVersionId: row.credentialVersionId,
          }
        : null
    },

    async findConnectionTool(connectionId, connectorId, toolName): Promise<{ availability: string } | null> {
      const row = await db
        .select()
        .from(connectionTools)
        .where(
          and(
            eq(connectionTools.connectionId, connectionId),
            eq(connectionTools.connectorId, connectorId),
            eq(connectionTools.name, toolName),
          ),
        )
        .get()
      return row ? { availability: row.availability } : null
    },

    async connectionCredentialUsable(auth: AuthScope, connection: PolicyConnection): Promise<boolean> {
      // The connection credential check resolves the credential's active
      // version (rather than the pinned version) and additionally requires the
      // resolved version to be `active` — stricter than the provider check,
      // which only rejects `revoked`.
      const credential = connection.credentialId
        ? await db
            .select()
            .from(vaultCredentials)
            .where(
              and(
                eq(vaultCredentials.id, connection.credentialId),
                eq(vaultCredentials.organizationId, auth.organization.id),
                or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
              ),
            )
            .get()
        : null
      if (!connection.credentialVersionId) {
        return true
      }
      const effectiveVersionId = credential?.activeVersionId ?? connection.credentialVersionId
      const version = await db
        .select()
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, effectiveVersionId),
            eq(vaultCredentialVersions.organizationId, auth.organization.id),
            or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
          ),
        )
        .get()
      return !(
        version?.state !== 'active' ||
        credential?.state === 'revoked' ||
        (credential && version.credentialId !== credential.id)
      )
    },
  }
}
