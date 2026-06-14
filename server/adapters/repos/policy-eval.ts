import type {
  BudgetRule,
  BudgetUsageRecord,
  PolicyAccessRule,
  PolicyLevel,
  ProviderAccessRule,
} from '@server/domain/policy'
import type { AuthScope, PolicyConnection, PolicyEvalRepo, PolicyProvider } from '@server/usecases/ports'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import {
  accessRules,
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

// Confirms a vault credential reference (credentialId + optional pinned
// version) is still usable: the credential and the resolved version both exist,
// belong to each other, and are not revoked. Shared by provider and MCP
// connection credential checks.
async function credentialVersionUsable(
  db: Db,
  auth: AuthScope,
  binding: { credentialId: string | null; credentialVersionId: string | null },
): Promise<boolean> {
  if (!binding.credentialId) {
    return true
  }
  const credential = await db
    .select()
    .from(vaultCredentials)
    .where(
      and(
        eq(vaultCredentials.id, binding.credentialId),
        eq(vaultCredentials.organizationId, auth.organization.id),
        or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
      ),
    )
    .get()
  if (!credential || credential.state === 'revoked') {
    return false
  }
  const versionId = binding.credentialVersionId ?? credential.activeVersionId
  if (!versionId) {
    return false
  }
  const version = await db
    .select()
    .from(vaultCredentialVersions)
    .where(
      and(
        eq(vaultCredentialVersions.id, versionId),
        eq(vaultCredentialVersions.credentialId, credential.id),
        eq(vaultCredentialVersions.organizationId, auth.organization.id),
        or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
      ),
    )
    .get()
  return !!version && version.state !== 'revoked'
}

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

    async projectAccessRules(projectId: string): Promise<PolicyAccessRule[]> {
      const rows = await db.select().from(accessRules).where(eq(accessRules.projectId, projectId))
      return rows.map((rule) => ({
        id: rule.id,
        providerId: rule.providerId,
        modelId: rule.modelId,
        teamId: rule.teamId,
        // DB text column constrained to allow|deny by every write path.
        effect: rule.effect as 'allow' | 'deny',
        reason: rule.reason,
      }))
    },

    async findProvider(projectId: string, providerId: string): Promise<PolicyProvider | null> {
      const row = await db
        .select()
        .from(providers)
        .where(
          and(
            eq(providers.projectId, projectId),
            providerId === 'workers-ai' ? eq(providers.type, 'workers-ai') : eq(providers.id, providerId),
          ),
        )
        .orderBy(desc(providers.updatedAt))
        .get()
      return row
        ? {
            id: row.id,
            enabled: row.enabled,
            credentialId: row.credentialId,
            credentialVersionId: row.credentialVersionId,
          }
        : null
    },

    async providerCredentialUsable(auth: AuthScope, provider: PolicyProvider): Promise<boolean> {
      return credentialVersionUsable(db, auth, provider)
    },

    async providerAccessRules(projectId, values): Promise<ProviderAccessRule[]> {
      const providerPredicates = [
        isNull(accessRules.providerId),
        eq(accessRules.providerId, '*'),
        eq(accessRules.providerId, values.providerId),
      ]
      if (values.providerRowId) {
        providerPredicates.push(eq(accessRules.providerId, values.providerRowId))
      }
      const modelPredicates = [isNull(accessRules.modelId), eq(accessRules.modelId, '*')]
      if (values.modelId) {
        modelPredicates.push(eq(accessRules.modelId, values.modelId))
      }
      const rows = await db
        .select()
        .from(accessRules)
        .where(and(eq(accessRules.projectId, projectId), or(...providerPredicates), or(...modelPredicates)))
      return rows.map((rule) => ({ id: rule.id, effect: rule.effect, teamId: rule.teamId, reason: rule.reason }))
    },

    async successfulUsage(projectId: string): Promise<BudgetUsageRecord[]> {
      const rows = await db
        .select()
        .from(usageRecords)
        .where(and(eq(usageRecords.projectId, projectId), eq(usageRecords.status, 'success')))
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
