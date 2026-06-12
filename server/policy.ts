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

export type { PolicyDecision }

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

function commandMatches(pattern: string, command: string) {
  const normalizedPattern = pattern.trim()
  const normalizedCommand = command.trim()
  return (
    normalizedPattern === normalizedCommand ||
    normalizedCommand === normalizedPattern ||
    normalizedCommand.startsWith(`${normalizedPattern} `)
  )
}

function commandMatchesAny(patterns: string[], command: string) {
  return patterns.includes('*') || patterns.some((pattern) => commandMatches(pattern, command))
}

function mergedSandboxPolicy(
  effectivePolicy: Record<string, unknown>,
  session: { agentSnapshot: string | null; environmentSnapshot: string | null } | null,
) {
  const environmentSnapshot = session?.environmentSnapshot
    ? parseJson<{ networkPolicy?: unknown }>(session.environmentSnapshot, {})
    : {}
  return {
    governance: effectivePolicy,
    environmentNetwork: stringRecord(environmentSnapshot.networkPolicy),
  }
}

function environmentNetworkMode(networkPolicy: Record<string, unknown>) {
  return networkPolicy.mode === 'restricted' || networkPolicy.mode === 'offline' ? networkPolicy.mode : 'unrestricted'
}

function normalizeHost(value: string) {
  const trimmed = value.trim().toLowerCase()
  try {
    return new URL(trimmed).hostname
  } catch {
    return trimmed.split(':')[0] ?? trimmed
  }
}

function hostAllowed(allowedHosts: string[], host: string | null | undefined) {
  if (!host) {
    return false
  }
  const normalizedHost = normalizeHost(host)
  return allowedHosts.map(normalizeHost).some((allowedHost) => allowedHost === '*' || allowedHost === normalizedHost)
}

function hostFromUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

export type SandboxRuntimeOperation =
  | { operation: 'command'; command: string | null; resourceType: 'sandbox_command'; resourceId: string }
  | { operation: 'network'; host: string | null; resourceType: 'sandbox_network'; resourceId: string }

// Maps a cloud runtime tool invocation to the sandbox policy operation it
// performs. sandbox.exec runs a workspace command; sandbox.fetch performs an
// outbound network operation from the sandbox.
export function sandboxOperationForRuntimeTool(
  toolName: string,
  input: Record<string, unknown>,
): SandboxRuntimeOperation | null {
  if (toolName === 'sandbox.exec') {
    const command = typeof input.command === 'string' ? input.command : null
    return {
      operation: 'command',
      command,
      resourceType: 'sandbox_command',
      resourceId: command?.trim().split(/\s+/)[0] ?? toolName,
    }
  }
  if (toolName === 'sandbox.fetch') {
    const host = typeof input.host === 'string' ? input.host : hostFromUrl(input.url)
    return { operation: 'network', host, resourceType: 'sandbox_network', resourceId: host ?? toolName }
  }
  return null
}

// Policy gate for the sandbox executor seam: evaluates command and network
// tool calls against governance sandbox policy and the session environment
// network policy. Returns null when the tool is not a sandbox operation or the
// operation is allowed.
export async function policyBlocksSandboxOperation(
  db: PolicyDb,
  auth: AuthContext,
  values: {
    session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null
    toolName: string
    input: Record<string, unknown>
  },
): Promise<{ decision: PolicyDecision; operation: SandboxRuntimeOperation } | null> {
  const operation = sandboxOperationForRuntimeTool(values.toolName, values.input)
  if (!operation) {
    return null
  }
  const decision = await evaluateSandboxRuntimePolicy(db, auth, {
    session: values.session,
    operation: operation.operation,
    command: operation.operation === 'command' ? operation.command : null,
    host: operation.operation === 'network' ? operation.host : null,
  })
  if (decision.allowed) {
    return null
  }
  return { decision, operation }
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

  const snapshot = parseJson<{ mcpPolicy?: unknown }>(session.environmentSnapshot, {})
  const mcpPolicy = stringRecord(snapshot.mcpPolicy)
  const blockedConnectors = stringArray(mcpPolicy.blockedConnectors)
  if (includesWildcard(blockedConnectors, connectorId)) {
    return false
  }

  const allowedConnectors = stringArray(mcpPolicy.allowedConnectors)
  if (allowedConnectors.length === 0) {
    return mcpPolicy.defaultEffect !== 'deny'
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

// Sensitive sandbox tools can demand a human decision before they execute.
// Symmetric with mcpPolicy.requireApprovalTools, but scoped to the governance
// toolPolicy that gates the cloud sandbox toolset.
export async function toolPolicyRequiresApproval(db: PolicyDb, auth: AuthContext, toolName: string) {
  const effective = await resolveEffectivePolicy(db, auth)
  return includesWildcard(stringArray(effective.toolPolicy.requireApprovalTools), toolName)
}

// ─── Policy hierarchy resolution ──────────────────────────────────────────────
//
// Effective governance policy merges organization → team → project scope rows
// with deterministic most-restrictive semantics (documented in
// docs/product/decisions.md). Team rows apply only when the caller's
// OIDC-asserted team memberships include the row's team id.

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
function mergePolicyObjects(levels: Record<string, unknown>[]) {
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

type GovernancePolicyRow = typeof governancePolicies.$inferSelect

export interface EffectivePolicySource {
  scope: 'organization' | 'team' | 'project'
  id: string
  teamId: string | null
}

// Loads the applicable hierarchy rows: every organization-scope row for the
// caller's organization, team-scope rows matching the caller's OIDC team
// memberships, and the project-scope row. One row per scope/team (latest
// updatedAt wins) keeps the merge deterministic.
async function applicablePolicyRows(db: PolicyDb, auth: AuthContext) {
  const rows = await db
    .select()
    .from(governancePolicies)
    .where(
      or(
        and(eq(governancePolicies.scope, 'project'), eq(governancePolicies.projectId, auth.project.id)),
        and(eq(governancePolicies.scope, 'organization'), eq(governancePolicies.organizationId, auth.organization.id)),
        and(eq(governancePolicies.scope, 'team'), eq(governancePolicies.organizationId, auth.organization.id)),
      ),
    )
    .orderBy(desc(governancePolicies.updatedAt))
  const memberTeams = auth.teams ?? []
  const byKey = new Map<string, GovernancePolicyRow>()
  for (const row of rows) {
    if (row.scope === 'team' && (!row.teamId || !memberTeams.includes(row.teamId))) {
      continue
    }
    const key = `${row.scope}:${row.teamId ?? ''}`
    if (!byKey.has(key)) {
      byKey.set(key, row)
    }
  }
  const organization = byKey.get('organization:') ?? null
  const teams = [...byKey.values()]
    .filter((row) => row.scope === 'team')
    .sort((left, right) => (left.teamId ?? '').localeCompare(right.teamId ?? ''))
  const project = byKey.get('project:') ?? null
  return { organization, teams, project }
}

export async function resolveEffectivePolicy(db: PolicyDb, auth: AuthContext) {
  const { organization, teams, project } = await applicablePolicyRows(db, auth)
  const levels = [organization, ...teams, project].filter((row): row is GovernancePolicyRow => row !== null)
  const accessRules = await db
    .select()
    .from(providerAccessRules)
    .where(eq(providerAccessRules.projectId, auth.project.id))

  const sources: EffectivePolicySource[] = levels.map((row) => ({
    scope: row.scope as EffectivePolicySource['scope'],
    id: row.id,
    teamId: row.teamId,
  }))
  const mostSpecific = levels.at(-1)
  return {
    source: mostSpecific
      ? { type: mostSpecific.scope, id: mostSpecific.id }
      : { type: 'platform_default', id: 'workers-ai-default' },
    sources,
    providerRules: levels.flatMap((row) => parseJson<Rule[]>(row.providerRules, [])),
    modelRules: levels.flatMap((row) => parseJson<Rule[]>(row.modelRules, [])),
    accessRules: accessRules.map((rule) => ({
      id: rule.id,
      providerId: rule.providerId ?? '*',
      modelId: rule.modelId ?? '*',
      teamId: rule.teamId,
      effect: rule.effect,
      reason: rule.reason,
    })),
    toolPolicy: mergePolicyObjects(levels.map((row) => parseJson<Record<string, unknown>>(row.toolPolicy, {}))),
    mcpPolicy: mergePolicyObjects(levels.map((row) => parseJson<Record<string, unknown>>(row.mcpPolicy, {}))),
    sandboxPolicy: mergePolicyObjects(levels.map((row) => parseJson<Record<string, unknown>>(row.sandboxPolicy, {}))),
    budgetPolicy: mergePolicyObjects(levels.map((row) => parseJson<BudgetPolicy>(row.budgetPolicy, {}))),
  }
}

// Providers may bind their credential through a vault credential-version
// reference (version id, secretRef, or reference name). A revoked credential
// must fail provider policy evaluation, not only runtime resolution.
async function providerCredentialRevocation(
  db: PolicyDb,
  auth: AuthContext,
  provider: { id: string; credentialSecretRef: string | null },
): Promise<PolicyDecision | null> {
  if (!provider.credentialSecretRef) {
    return null
  }
  const ref = provider.credentialSecretRef
  const version = await db
    .select()
    .from(vaultCredentialVersions)
    .where(
      and(
        eq(vaultCredentialVersions.organizationId, auth.organization.id),
        or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
        or(
          eq(vaultCredentialVersions.id, ref),
          eq(vaultCredentialVersions.secretRef, ref),
          eq(vaultCredentialVersions.referenceName, ref),
        ),
      ),
    )
    .get()
  if (!version) {
    return null
  }
  const credential = await db.select().from(vaultCredentials).where(eq(vaultCredentials.id, version.credentialId)).get()
  if (version.status === 'revoked' || version.status === 'deleted' || credential?.status === 'revoked') {
    return {
      allowed: false,
      category: 'provider',
      rule: provider.id,
      message: 'Provider credential is revoked or unavailable.',
    }
  }
  return null
}

export async function evaluateProviderPolicy(
  db: PolicyDb,
  auth: AuthContext,
  values: {
    providerId: string
    modelId: string | null
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
  if (provider) {
    const revocation = await providerCredentialRevocation(db, auth, provider)
    if (revocation) {
      return revocation
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
  const modelPredicates = [isNull(providerAccessRules.modelId), eq(providerAccessRules.modelId, '*')]
  if (values.modelId) {
    modelPredicates.push(eq(providerAccessRules.modelId, values.modelId))
  }
  const accessRules = await db
    .select()
    .from(providerAccessRules)
    .where(and(eq(providerAccessRules.projectId, auth.project.id), or(...providerPredicates), or(...modelPredicates)))
  // Team membership comes from OIDC claims (`teams`); AMA stores no team
  // tables. Team-scoped deny rules only bind members of that team, and any
  // team-scoped allow rule turns the matched provider/model into a
  // team-restricted resource that requires membership in an allowed team.
  const memberTeams = auth.teams ?? []
  const deniedAccessRule = accessRules.find(
    (rule) => rule.effect === 'deny' && (!rule.teamId || memberTeams.includes(rule.teamId)),
  )
  if (deniedAccessRule) {
    return {
      allowed: false,
      category: 'provider',
      rule: deniedAccessRule.id,
      message: deniedAccessRule.reason ?? 'Provider or model is denied by governance policy.',
    }
  }
  const teamAllowRules = accessRules.filter((rule) => rule.effect === 'allow' && rule.teamId)
  if (teamAllowRules.length > 0 && !teamAllowRules.some((rule) => rule.teamId && memberTeams.includes(rule.teamId))) {
    const restrictingRule = teamAllowRules[0]
    return {
      allowed: false,
      category: 'provider',
      rule: restrictingRule?.id ?? null,
      message: restrictingRule?.reason ?? 'Provider is restricted to approved teams.',
    }
  }

  const effective = await resolveEffectivePolicy(db, auth)
  const deniedRule = [...effective.providerRules, ...effective.modelRules].find(
    (rule) =>
      rule.effect === 'deny' &&
      (!rule.providerId || rule.providerId === values.providerId || rule.providerId === provider?.id) &&
      (!rule.modelId || rule.modelId === '*' || (values.modelId !== null && rule.modelId === values.modelId)),
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

  const activeBudgets = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.projectId, auth.project.id), eq(budgets.status, 'active')))
  for (const budget of activeBudgets) {
    if (budget.providerId && budget.providerId !== values.providerId && budget.providerId !== provider?.id) {
      continue
    }
    if (budget.modelId && (values.modelId === null || budget.modelId !== values.modelId)) {
      continue
    }
    const windowPrefix = budget.window === 'day' ? new Date().toISOString().slice(0, 10) : month
    const windowUsage = usage.filter((record) => record.createdAt.startsWith(windowPrefix))
    const consumed =
      budget.limitType === 'cost_micros'
        ? windowUsage.reduce((sum, record) => sum + record.costMicros, 0)
        : budget.limitType === 'sessions'
          ? new Set(windowUsage.map((record) => record.sessionId).filter(Boolean)).size
          : windowUsage.reduce((sum, record) => sum + record.totalTokens, 0)
    if (consumed >= budget.limitValue) {
      return {
        allowed: false,
        category: 'budget',
        rule: budget.id,
        message: `Usage budget is exhausted: the ${budget.window} ${budget.limitType} limit of ${budget.limitValue} is spent.`,
      }
    }
  }

  return { allowed: true, category: 'provider', rule: null, message: 'Allowed by effective policy.' }
}

// Roles allowed to override a provider-access denial. Override must be an
// explicit per-request flag; it is never implied by the role alone.
const PROVIDER_OVERRIDE_ROLES = ['admin', 'owner'] as const

export function canOverrideProviderPolicy(auth: Pick<AuthContext, 'roles'>) {
  return auth.roles.some((role) => (PROVIDER_OVERRIDE_ROLES as readonly string[]).includes(role))
}

export interface ProviderPolicySessionDecision {
  decision: PolicyDecision
  // The denied decision an admin explicitly overrode; callers must audit it.
  override: PolicyDecision | null
}

// Session-creation entrypoint for provider policy: evaluates the effective
// policy (including OIDC-team-scoped access rules) and honors an explicit
// admin override request only for admin-role callers.
export async function evaluateProviderPolicyForSession(
  db: PolicyDb,
  auth: AuthContext,
  values: {
    providerId: string
    modelId: string | null
    adminOverride?: boolean
  },
): Promise<ProviderPolicySessionDecision> {
  const decision = await evaluateProviderPolicy(db, auth, {
    providerId: values.providerId,
    modelId: values.modelId,
  })
  if (decision.allowed || values.adminOverride !== true || !canOverrideProviderPolicy(auth)) {
    return { decision, override: null }
  }
  return {
    decision: {
      allowed: true,
      category: 'override',
      rule: decision.rule,
      message: 'Allowed by explicit admin policy override.',
    },
    override: decision,
  }
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
  if (connection?.status !== 'connected') {
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
  if (tool?.status !== 'available') {
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
      version?.status !== 'active' ||
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

export async function evaluateSandboxRuntimePolicy(
  db: PolicyDb,
  auth: AuthContext,
  values: {
    session?: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null
    operation: 'startup' | 'command' | 'network'
    command?: string | null
    host?: string | null
  },
): Promise<PolicyDecision> {
  const effective = await resolveEffectivePolicy(db, auth)
  const policies = mergedSandboxPolicy(effective.sandboxPolicy, values.session ?? null)

  if (policies.governance.enabled === false || policies.governance.status === 'disabled') {
    return {
      allowed: false,
      category: 'sandbox',
      rule: 'sandboxPolicy.enabled',
      message: 'Sandbox runtime is disabled by governance policy.',
    }
  }

  if (values.operation === 'network') {
    const environmentMode = environmentNetworkMode(policies.environmentNetwork)
    const networkPolicies = [policies.governance.network, environmentMode]
    if (
      networkPolicies.some(
        (network) => network === 'disabled' || network === 'deny' || network === 'offline' || network === false,
      )
    ) {
      return {
        allowed: false,
        category: 'sandbox_network',
        rule: 'sandboxPolicy.network',
        message: 'Sandbox network access is disabled by policy.',
      }
    }

    const governanceAllowedHosts = stringArray(policies.governance.allowedHosts)
    if (governanceAllowedHosts.length > 0 && !hostAllowed(governanceAllowedHosts, values.host)) {
      return {
        allowed: false,
        category: 'sandbox_network',
        rule: 'sandboxPolicy.allowedHosts',
        message: 'Sandbox network host is not allowed by policy.',
      }
    }

    const environmentAllowedHosts = stringArray(policies.environmentNetwork.allowedHosts)
    if (environmentMode === 'restricted' && !hostAllowed(environmentAllowedHosts, values.host)) {
      return {
        allowed: false,
        category: 'sandbox_network',
        rule: 'environment.networkPolicy.allowedHosts',
        message: 'Sandbox network host is not allowed by policy.',
      }
    }
  }

  if (values.operation === 'command') {
    const blockedCommands = stringArray(policies.governance.blockedCommands)
    const allowedCommands = stringArray(policies.governance.allowedCommands)
    if (!values.command && (blockedCommands.length > 0 || allowedCommands.length > 0)) {
      return {
        allowed: false,
        category: 'sandbox_command',
        rule: allowedCommands.length > 0 ? 'sandboxPolicy.allowedCommands' : 'sandboxPolicy.blockedCommands',
        message: 'Sandbox command is not allowed by policy.',
      }
    }
    if (values.command && commandMatchesAny(blockedCommands, values.command)) {
      return {
        allowed: false,
        category: 'sandbox_command',
        rule: 'sandboxPolicy.blockedCommands',
        message: 'Sandbox command is blocked by policy.',
      }
    }

    if (values.command && allowedCommands.length > 0 && !commandMatchesAny(allowedCommands, values.command)) {
      return {
        allowed: false,
        category: 'sandbox_command',
        rule: 'sandboxPolicy.allowedCommands',
        message: 'Sandbox command is not allowed by policy.',
      }
    }
  }

  return { allowed: true, category: 'sandbox', rule: null, message: 'Allowed by sandbox policy.' }
}
