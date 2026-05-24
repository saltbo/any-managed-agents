import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { AuthContext } from './auth/session'
import {
  budgets,
  governancePolicies,
  mcpConnections,
  mcpConnectionTools,
  providerAccessRules,
  providerConfigs,
  usageRecords,
  vaultCredentials,
  vaultCredentialVersions,
} from './db/schema'

type PolicyDb = ReturnType<typeof drizzle>

interface Rule {
  providerId?: string
  modelId?: string
  effect: 'allow' | 'deny'
  reason?: string
}

type BudgetPolicy = Record<string, unknown>
type PolicyDecision = {
  allowed: boolean
  category: string
  rule: string | null
  message: string
}

function parseJson<T>(value: string | null | undefined, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function currentMonthPrefix() {
  return new Date().toISOString().slice(0, 7)
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function includesWildcard(values: string[], candidate: string) {
  return values.includes('*') || values.includes(candidate)
}

function sessionAllowsTool(session: { agentSnapshot: string | null } | null, connectorId: string, toolName: string) {
  if (!session?.agentSnapshot) {
    return true
  }

  const snapshot = parseJson<{ allowedTools?: unknown }>(session.agentSnapshot, {})
  const allowedTools = stringArray(snapshot.allowedTools)
  if (allowedTools.length === 0) {
    return false
  }

  return (
    includesWildcard(allowedTools, toolName) ||
    includesWildcard(allowedTools, `mcp:${connectorId}`) ||
    includesWildcard(allowedTools, `mcp:${connectorId}.${toolName}`)
  )
}

function environmentAllowsConnector(session: { environmentSnapshot: string | null } | null, connectorId: string) {
  if (!session?.environmentSnapshot) {
    return true
  }

  const snapshot = parseJson<{ metadata?: unknown }>(session.environmentSnapshot, {})
  const metadata = stringRecord(snapshot.metadata)
  const mcp = stringRecord(metadata.mcp)
  const allowedConnectors = stringArray(mcp.allowedConnectors)
  if (allowedConnectors.length === 0) {
    return true
  }

  return includesWildcard(allowedConnectors, connectorId)
}

function policyBlocksConnector(mcpPolicy: Record<string, unknown>, connectorId: string): PolicyDecision | null {
  const blockedConnectors = stringArray(mcpPolicy.blockedConnectors)
  if (includesWildcard(blockedConnectors, connectorId)) {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'mcpPolicy.blockedConnectors',
      message: 'MCP connector is blocked by governance policy.',
    }
  }

  const allowedConnectors = stringArray(mcpPolicy.allowedConnectors)
  if (allowedConnectors.length > 0 && !includesWildcard(allowedConnectors, connectorId)) {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'mcpPolicy.allowedConnectors',
      message: 'MCP connector is not allowed by governance policy.',
    }
  }

  if (mcpPolicy.defaultEffect === 'deny') {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'mcpPolicy.defaultEffect',
      message: 'MCP connector is denied by default governance policy.',
    }
  }

  return null
}

function policyRequiresApproval(mcpPolicy: Record<string, unknown>, connectorId: string, toolName: string) {
  const approvalModes = stringRecord(mcpPolicy.connectorApprovalModes)
  const approvalMode = approvalModes[connectorId] ?? approvalModes['*']
  return (
    approvalMode === 'require_approval' ||
    includesWildcard(stringArray(mcpPolicy.requireApprovalConnectors), connectorId) ||
    includesWildcard(stringArray(mcpPolicy.requireApprovalTools), toolName)
  )
}

function policyBlocksTool(toolPolicy: Record<string, unknown>, toolName: string): PolicyDecision | null {
  if (includesWildcard(stringArray(toolPolicy.blockedTools), toolName)) {
    return {
      allowed: false,
      category: 'tool',
      rule: 'toolPolicy.blockedTools',
      message: 'Tool is blocked by governance policy.',
    }
  }

  const allowedTools = stringArray(toolPolicy.allowedTools)
  if (allowedTools.length > 0 && !includesWildcard(allowedTools, toolName)) {
    return {
      allowed: false,
      category: 'tool',
      rule: 'toolPolicy.allowedTools',
      message: 'Tool is not allowed by governance policy.',
    }
  }

  if (toolPolicy.defaultEffect === 'deny') {
    return {
      allowed: false,
      category: 'tool',
      rule: 'toolPolicy.defaultEffect',
      message: 'Tool is denied by default governance policy.',
    }
  }

  return null
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
      providerId: rule.providerId ?? '*',
      modelId: rule.modelId ?? '*',
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

  const providerPredicates = [
    isNull(providerAccessRules.providerId),
    eq(providerAccessRules.providerId, '*'),
    eq(providerAccessRules.providerId, values.providerId),
  ]
  if (provider) {
    providerPredicates.push(eq(providerAccessRules.providerId, provider.id))
  }
  const accessRules = await db
    .select()
    .from(providerAccessRules)
    .where(
      and(
        eq(providerAccessRules.projectId, auth.project.id),
        or(...providerPredicates),
        or(
          isNull(providerAccessRules.modelId),
          eq(providerAccessRules.modelId, '*'),
          eq(providerAccessRules.modelId, values.modelId),
        ),
      ),
    )
  const deniedAccessRule = accessRules.find((rule) => rule.effect === 'deny')
  if (deniedAccessRule) {
    return {
      allowed: false,
      category: 'provider',
      rule: deniedAccessRule.id,
      message: deniedAccessRule.reason ?? 'Provider or model is denied by governance policy.',
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

export async function evaluateMcpToolPolicy(
  db: PolicyDb,
  auth: AuthContext,
  values: {
    connectorId: string
    toolName: string
    session?: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null
  },
): Promise<PolicyDecision> {
  const effective = await resolveEffectivePolicy(db, auth)
  const connectorDecision = policyBlocksConnector(effective.mcpPolicy, values.connectorId)
  if (connectorDecision) {
    return connectorDecision
  }

  const toolDecision = policyBlocksTool(effective.toolPolicy, values.toolName)
  if (toolDecision) {
    return toolDecision
  }

  const connection = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.projectId, auth.project.id), eq(mcpConnections.connectorId, values.connectorId)))
    .get()
  if (!connection || connection.status !== 'connected') {
    return {
      allowed: false,
      category: 'mcp',
      rule: values.connectorId,
      message: 'MCP connector is not connected for this project.',
    }
  }
  if (!connection.credentialVersionId) {
    return {
      allowed: false,
      category: 'mcp',
      rule: connection.id,
      message: 'MCP connector credential is required.',
    }
  }

  const tool = await db
    .select()
    .from(mcpConnectionTools)
    .where(
      and(
        eq(mcpConnectionTools.connectionId, connection.id),
        eq(mcpConnectionTools.connectorId, values.connectorId),
        eq(mcpConnectionTools.name, values.toolName),
      ),
    )
    .get()
  if (!tool || tool.status !== 'available') {
    return {
      allowed: false,
      category: 'tool',
      rule: values.toolName,
      message: 'MCP tool is not available for this connector.',
    }
  }

  if (connection.credentialVersionId) {
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
    if (
      !version ||
      version.status !== 'active' ||
      credential?.status === 'revoked' ||
      (credential && version.credentialId !== credential.id)
    ) {
      return {
        allowed: false,
        category: 'mcp',
        rule: connection.id,
        message: 'MCP connector credential is revoked or unavailable.',
      }
    }
  }

  if (!sessionAllowsTool(values.session ?? null, values.connectorId, values.toolName)) {
    return {
      allowed: false,
      category: 'tool',
      rule: 'agent.allowedTools',
      message: 'Agent version does not allow this MCP tool.',
    }
  }

  if (!environmentAllowsConnector(values.session ?? null, values.connectorId)) {
    return {
      allowed: false,
      category: 'mcp',
      rule: 'environment.mcp.allowedConnectors',
      message: 'Environment does not allow this MCP connector.',
    }
  }

  if (policyRequiresApproval(effective.mcpPolicy, values.connectorId, values.toolName)) {
    return {
      allowed: false,
      category: 'approval',
      rule: 'mcpPolicy.requireApproval',
      message: 'MCP tool call requires approval before execution.',
    }
  }

  return { allowed: true, category: 'mcp', rule: connection.id, message: 'Allowed by effective MCP policy.' }
}
