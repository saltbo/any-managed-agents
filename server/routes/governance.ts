import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, redactSecrets, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import {
  agentDefinitions,
  auditRecords,
  budgets,
  environments,
  governancePolicies,
  mcpCatalogEntries,
  mcpConnections,
  mcpConnectionTools,
  projects,
  providerAccessRules,
  providerConfigs,
  usageRecords,
} from '../db/schema'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema, listResponseSchema } from '../openapi'
import { evaluateProviderPolicy, resolveEffectivePolicy } from '../policy'
import { PLATFORM_CONNECTOR_IDS } from './mcp'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())
const RuleSchema = z
  .object({
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    effect: z.enum(['allow', 'deny']),
    reason: z.string().max(500).optional(),
  })
  .strict()

const AccessRuleSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    teamId: z.string().nullable(),
    effect: z.enum(['allow', 'deny']),
    reason: z.string().nullable(),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ProviderAccessRule')

const GovernancePolicySchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    scope: z.literal('project'),
    providerRules: z.array(RuleSchema),
    modelRules: z.array(RuleSchema),
    toolPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    sandboxPolicy: JsonObjectSchema,
    budgetPolicy: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('GovernancePolicy')

const GovernancePayloadSchema = z
  .object({
    providerRules: z.array(RuleSchema).max(200).optional(),
    modelRules: z.array(RuleSchema).max(500).optional(),
    toolPolicy: JsonObjectSchema.optional(),
    mcpPolicy: JsonObjectSchema.optional(),
    sandboxPolicy: JsonObjectSchema.optional(),
    budgetPolicy: JsonObjectSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .openapi('UpdateGovernancePolicyRequest')

const AccessRulePayloadSchema = z
  .object({
    providerId: z.string().min(1).optional().openapi({ example: 'workers-ai' }),
    modelId: z.string().min(1).optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    teamId: z.string().min(1).optional().openapi({ example: 'team_platform' }),
    effect: z.enum(['allow', 'deny']).openapi({ example: 'deny' }),
    reason: z.string().max(500).optional().openapi({ example: 'Not approved for this project.' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { source: 'admin' } }),
  })
  .openapi('CreateProviderAccessRuleRequest')

const BudgetSchema = z
  .object({
    id: z.string(),
    scope: z.string(),
    providerId: z.string().nullable(),
    modelId: z.string().nullable(),
    limitType: z.string(),
    limitValue: z.number().int(),
    window: z.string(),
    status: z.enum(['active', 'disabled']),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Budget')

const BudgetPayloadSchema = z
  .object({
    scope: z.enum(['project', 'provider', 'model']).openapi({ example: 'project' }),
    providerId: z.string().optional().openapi({ example: 'workers-ai' }),
    modelId: z.string().optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    limitType: z.enum(['tokens', 'cost_micros', 'sessions']).openapi({ example: 'tokens' }),
    limitValue: z.number().int().positive().openapi({ example: 1000000 }),
    window: z.enum(['day', 'month']).openapi({ example: 'month' }),
    status: z.enum(['active', 'disabled']).optional().openapi({ example: 'active' }),
    metadata: JsonObjectSchema.optional(),
  })
  .openapi('CreateBudgetRequest')

const EffectivePolicySchema = z
  .object({
    source: JsonObjectSchema,
    sources: z.array(JsonObjectSchema),
    providerRules: z.array(RuleSchema),
    modelRules: z.array(RuleSchema),
    accessRules: z.array(JsonObjectSchema),
    toolPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    sandboxPolicy: JsonObjectSchema,
    budgetPolicy: JsonObjectSchema,
  })
  .openapi('EffectivePolicy')

// ─── Declarative governance configuration ────────────────────────────────────

const ConfigPolicyLevelFields = {
  providerRules: z.array(RuleSchema).max(200).optional(),
  modelRules: z.array(RuleSchema).max(500).optional(),
  toolPolicy: JsonObjectSchema.optional(),
  mcpPolicy: JsonObjectSchema.optional(),
  sandboxPolicy: JsonObjectSchema.optional(),
  budgetPolicy: JsonObjectSchema.optional(),
}

const ConfigPolicyLevelSchema = z.object(ConfigPolicyLevelFields).strict().openapi('GovernanceConfigPolicyLevel')

const ConfigTeamLevelSchema = z
  .object({ teamId: z.string().min(1).openapi({ example: 'team_platform' }), ...ConfigPolicyLevelFields })
  .strict()
  .openapi('GovernanceConfigTeamLevel')

const ConfigAccessRuleSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    teamId: z.string().min(1).optional(),
    effect: z.enum(['allow', 'deny']),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .openapi('GovernanceConfigAccessRule')

const ConfigBudgetSchema = z
  .object({
    scope: z.enum(['project', 'provider', 'model']),
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    limitType: z.enum(['tokens', 'cost_micros', 'sessions']),
    // Positivity is validated semantically so invalid budgets surface as
    // field-level errors alongside unknown-reference errors.
    limitValue: z.number().int(),
    window: z.enum(['day', 'month']),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()
  .openapi('GovernanceConfigBudget')

const GovernanceConfigSchema = z
  .object({
    version: z.string().max(120).optional().openapi({ example: '2026-06-rollout-1' }),
    projectId: z.string().min(1).optional(),
    organization: ConfigPolicyLevelSchema.optional(),
    teams: z.array(ConfigTeamLevelSchema).max(50).optional(),
    project: ConfigPolicyLevelSchema.optional(),
    providerAccessRules: z.array(ConfigAccessRuleSchema).max(200).optional(),
    budgets: z.array(ConfigBudgetSchema).max(100).optional(),
  })
  .strict()
  .openapi('GovernanceConfigDocument')

const ConfigValidationResultSchema = z
  .object({
    valid: z.literal(true),
    configVersion: z.number().int(),
    summary: JsonObjectSchema,
  })
  .openapi('GovernanceConfigValidationResult')

const ConfigApplyResultSchema = z
  .object({
    applied: z.literal(true),
    configVersion: z.number().int(),
    summary: JsonObjectSchema,
  })
  .openapi('GovernanceConfigApplyResult')

const ConfigPreviewResultSchema = z
  .object({
    configVersion: z.number().int(),
    mutatesPolicy: z.literal(false),
    impact: z.object({
      affectedAgents: z.array(JsonObjectSchema),
      affectedEnvironments: z.array(JsonObjectSchema),
      affectedProviders: z.array(z.string()),
      sessionCreationPaths: z.array(JsonObjectSchema),
    }),
  })
  .openapi('GovernanceConfigPreviewResult')

type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>
type ConfigPolicyLevel = z.infer<typeof ConfigPolicyLevelSchema>

const EvaluationRequestSchema = z
  .object({
    providerId: z.string().min(1).openapi({ example: 'workers-ai' }),
    modelId: z.string().min(1).openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    sessionId: z.string().optional().openapi({ example: 'session_abc123' }),
  })
  .openapi('PolicyEvaluationRequest')

const EvaluationSchema = z
  .object({
    allowed: z.boolean(),
    category: z.string(),
    rule: z.string().nullable(),
    message: z.string(),
  })
  .openapi('PolicyEvaluation')

const AccessRuleListResponseSchema = listResponseSchema('ProviderAccessRuleListResponse', AccessRuleSchema)
const BudgetListResponseSchema = listResponseSchema('BudgetListResponse', BudgetSchema)

type GovernanceRow = typeof governancePolicies.$inferSelect
type AccessRuleRow = typeof providerAccessRules.$inferSelect
type BudgetRow = typeof budgets.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function serializePolicy(row: GovernanceRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    scope: 'project' as const,
    providerRules: parseJson<z.infer<typeof RuleSchema>[]>(row.providerRules, []),
    modelRules: parseJson<z.infer<typeof RuleSchema>[]>(row.modelRules, []),
    toolPolicy: parseJson<Record<string, unknown>>(row.toolPolicy, {}),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy, {}),
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy, {}),
    budgetPolicy: parseJson<Record<string, unknown>>(row.budgetPolicy, {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeAccessRule(row: AccessRuleRow) {
  return {
    id: row.id,
    providerId: row.providerId ?? '*',
    modelId: row.modelId ?? '*',
    teamId: row.teamId,
    effect: row.effect as 'allow' | 'deny',
    reason: row.reason,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeBudget(row: BudgetRow) {
  return {
    id: row.id,
    scope: row.scope,
    providerId: row.providerId,
    modelId: row.modelId,
    limitType: row.limitType,
    limitValue: row.limitValue,
    window: row.window,
    status: row.status as 'active' | 'disabled',
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function currentPolicy(db: ReturnType<typeof drizzle>, projectId: string) {
  return (
    (await db
      .select()
      .from(governancePolicies)
      .where(and(eq(governancePolicies.projectId, projectId), eq(governancePolicies.scope, 'project')))
      .orderBy(desc(governancePolicies.updatedAt))
      .get()) ?? null
  )
}

type Db = ReturnType<typeof drizzle>
type AuthScope = { organization: { id: string }; project: { id: string }; teams?: string[] }

const SANDBOX_TOOL_NAMES = [
  'sandbox.exec',
  'sandbox.read',
  'sandbox.write',
  'sandbox.fetch',
  'shell.exec',
  'terminal.exec',
  'network.fetch',
  'web.fetch',
]

const TOOL_LIST_KEYS = ['allowedTools', 'blockedTools', 'deniedTools', 'requireApprovalTools']
const CONNECTOR_LIST_KEYS = ['allowedConnectors', 'blockedConnectors', 'deniedConnectors', 'requireApprovalConnectors']
const SANDBOX_NETWORK_VALUES = ['enabled', 'unrestricted', 'restricted', 'disabled', 'offline', 'deny']

interface ConfigValidationContext {
  knownProviders: Set<string>
  knownTeams: Set<string>
  knownConnectors: Set<string>
  knownTools: Set<string>
}

function stringEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item, index) => (typeof item === 'string' ? [{ item, index }] : []))
}

async function configValidationContext(db: Db, auth: AuthScope, config: GovernanceConfig) {
  const providers = await db
    .select({ id: providerConfigs.id, type: providerConfigs.type })
    .from(providerConfigs)
    .where(eq(providerConfigs.projectId, auth.project.id))
  const knownProviders = new Set(['*', 'workers-ai'])
  for (const provider of providers) {
    knownProviders.add(provider.id)
    knownProviders.add(provider.type)
  }

  const catalog = await db
    .select({ connectorId: mcpCatalogEntries.connectorId, tools: mcpCatalogEntries.tools })
    .from(mcpCatalogEntries)
  const connections = await db
    .select({ connectorId: mcpConnections.connectorId })
    .from(mcpConnections)
    .where(eq(mcpConnections.projectId, auth.project.id))
  const knownConnectors = new Set(['*', ...PLATFORM_CONNECTOR_IDS])
  for (const entry of catalog) {
    knownConnectors.add(entry.connectorId)
  }
  for (const connection of connections) {
    knownConnectors.add(connection.connectorId)
  }

  const knownTools = new Set(['*', ...SANDBOX_TOOL_NAMES])
  for (const entry of catalog) {
    for (const tool of parseJson<Array<{ name?: string }>>(entry.tools, [])) {
      if (typeof tool.name === 'string') {
        knownTools.add(tool.name)
      }
    }
  }
  const connectionTools = await db
    .select({ name: mcpConnectionTools.name })
    .from(mcpConnectionTools)
    .where(eq(mcpConnectionTools.projectId, auth.project.id))
  for (const tool of connectionTools) {
    knownTools.add(tool.name)
  }
  const agents = await db
    .select({ tools: agentDefinitions.tools })
    .from(agentDefinitions)
    .where(eq(agentDefinitions.projectId, auth.project.id))
  for (const agent of agents) {
    for (const tool of parseJson<Array<{ name?: string }>>(agent.tools, [])) {
      if (typeof tool.name === 'string') {
        knownTools.add(tool.name)
      }
    }
  }

  const knownTeams = new Set([...(auth.teams ?? []), ...(config.teams ?? []).map((team) => team.teamId)])
  const accessRuleTeams = await db
    .select({ teamId: providerAccessRules.teamId })
    .from(providerAccessRules)
    .where(and(eq(providerAccessRules.projectId, auth.project.id), isNotNull(providerAccessRules.teamId)))
  for (const rule of accessRuleTeams) {
    if (rule.teamId) {
      knownTeams.add(rule.teamId)
    }
  }
  const teamPolicies = await db
    .select({ teamId: governancePolicies.teamId })
    .from(governancePolicies)
    .where(and(eq(governancePolicies.organizationId, auth.organization.id), eq(governancePolicies.scope, 'team')))
  for (const policy of teamPolicies) {
    if (policy.teamId) {
      knownTeams.add(policy.teamId)
    }
  }

  return { knownProviders, knownTeams, knownConnectors, knownTools } satisfies ConfigValidationContext
}

function toolReferenceKnown(context: ConfigValidationContext, tool: string) {
  if (context.knownTools.has(tool)) {
    return true
  }
  if (tool.startsWith('mcp:')) {
    const connector = tool.slice('mcp:'.length).split('.')[0] ?? ''
    return context.knownConnectors.has(connector)
  }
  return false
}

function validateConfigLevel(
  context: ConfigValidationContext,
  path: string,
  level: ConfigPolicyLevel,
  fields: Record<string, string>,
) {
  for (const [ruleKey, rules] of [
    ['providerRules', level.providerRules ?? []],
    ['modelRules', level.modelRules ?? []],
  ] as const) {
    rules.forEach((rule, index) => {
      if (rule.providerId && !context.knownProviders.has(rule.providerId)) {
        fields[`${path}.${ruleKey}[${index}].providerId`] = `Unknown provider: ${rule.providerId}`
      }
    })
  }
  for (const key of TOOL_LIST_KEYS) {
    for (const { item, index } of stringEntries(level.toolPolicy?.[key])) {
      if (!toolReferenceKnown(context, item)) {
        fields[`${path}.toolPolicy.${key}[${index}]`] = `Unknown tool: ${item}`
      }
    }
  }
  for (const key of CONNECTOR_LIST_KEYS) {
    for (const { item, index } of stringEntries(level.mcpPolicy?.[key])) {
      if (!context.knownConnectors.has(item)) {
        fields[`${path}.mcpPolicy.${key}[${index}]`] = `Unknown MCP connector: ${item}`
      }
    }
  }
  const network = level.sandboxPolicy?.network
  if (typeof network === 'string' && !SANDBOX_NETWORK_VALUES.includes(network)) {
    fields[`${path}.sandboxPolicy.network`] = `Unknown sandbox network mode: ${network}`
  }
  for (const [key, value] of Object.entries(level.budgetPolicy ?? {})) {
    if (typeof value === 'number' && value < 0) {
      fields[`${path}.budgetPolicy.${key}`] = 'Budget limits must not be negative.'
    }
  }
}

async function validateGovernanceConfig(db: Db, auth: AuthScope, config: GovernanceConfig) {
  const context = await configValidationContext(db, auth, config)
  const fields: Record<string, string> = {}

  if (config.projectId) {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, config.projectId), eq(projects.organizationId, auth.organization.id)))
      .get()
    if (!project) {
      fields.projectId = `Unknown project for this organization: ${config.projectId}`
    } else if (project.id !== auth.project.id) {
      fields.projectId = 'Config must target the project resolved from the request context.'
    }
  }

  const declaredTeams = new Set<string>()
  ;(config.teams ?? []).forEach((team, index) => {
    if (declaredTeams.has(team.teamId)) {
      fields[`teams[${index}].teamId`] = `Duplicate team declaration: ${team.teamId}`
    }
    declaredTeams.add(team.teamId)
  })

  if (config.organization) {
    validateConfigLevel(context, 'organization', config.organization, fields)
  }
  ;(config.teams ?? []).forEach((team, index) => {
    validateConfigLevel(context, `teams[${index}]`, team, fields)
  })
  if (config.project) {
    validateConfigLevel(context, 'project', config.project, fields)
  }

  ;(config.providerAccessRules ?? []).forEach((rule, index) => {
    if (rule.providerId && !context.knownProviders.has(rule.providerId)) {
      fields[`providerAccessRules[${index}].providerId`] = `Unknown provider: ${rule.providerId}`
    }
    if (rule.teamId && !context.knownTeams.has(rule.teamId)) {
      fields[`providerAccessRules[${index}].teamId`] = `Unknown team: ${rule.teamId}`
    }
  })
  ;(config.budgets ?? []).forEach((budget, index) => {
    if (budget.limitValue < 1) {
      fields[`budgets[${index}].limitValue`] = 'Budget limit must be a positive integer.'
    }
    if (budget.providerId && !context.knownProviders.has(budget.providerId)) {
      fields[`budgets[${index}].providerId`] = `Unknown provider: ${budget.providerId}`
    }
    if (budget.scope === 'provider' && !budget.providerId) {
      fields[`budgets[${index}].providerId`] = 'Provider-scoped budgets require providerId.'
    }
    if (budget.scope === 'model' && !budget.modelId) {
      fields[`budgets[${index}].modelId`] = 'Model-scoped budgets require modelId.'
    }
  })

  return fields
}

function countLevelEntries(config: GovernanceConfig, pick: (level: ConfigPolicyLevel) => number) {
  const levels = [config.organization, ...(config.teams ?? []), config.project].filter(
    (level): level is ConfigPolicyLevel => level !== undefined,
  )
  return levels.reduce((sum, level) => sum + pick(level), 0)
}

function policyListEntryCount(policy: Record<string, unknown> | undefined, keys: string[]) {
  return keys.reduce((sum, key) => sum + (Array.isArray(policy?.[key]) ? (policy?.[key] as unknown[]).length : 0), 0)
}

// Safe, count-only description of an applied or validated config: never
// includes rule reasons, hosts, commands, or other operator-authored values.
function configSummary(config: GovernanceConfig) {
  return {
    hierarchy: {
      organization: config.organization !== undefined,
      teams: (config.teams ?? []).map((team) => team.teamId),
      project: config.project !== undefined,
    },
    providerRules: countLevelEntries(config, (level) => level.providerRules?.length ?? 0),
    modelRules: countLevelEntries(config, (level) => level.modelRules?.length ?? 0),
    toolRules: countLevelEntries(config, (level) => policyListEntryCount(level.toolPolicy, TOOL_LIST_KEYS)),
    mcpRules: countLevelEntries(config, (level) => policyListEntryCount(level.mcpPolicy, CONNECTOR_LIST_KEYS)),
    sandboxRules: countLevelEntries(config, (level) => Object.keys(level.sandboxPolicy ?? {}).length),
    providerAccessRules: config.providerAccessRules?.length ?? 0,
    budgets: config.budgets?.length ?? 0,
  }
}

// Config versions count applied configs for the project, so every apply gets
// a monotonically increasing version no matter which hierarchy levels the
// document declares.
async function nextConfigVersion(db: Db, projectId: string) {
  const applied = await db
    .select({ id: auditRecords.id })
    .from(auditRecords)
    .where(and(eq(auditRecords.projectId, projectId), eq(auditRecords.action, 'governance_config.apply')))
  return applied.length + 1
}

async function scopedPolicyRow(
  db: Db,
  values: { organizationId: string; projectId: string; scope: 'organization' | 'team' | 'project'; teamId?: string },
) {
  return (
    (await db
      .select()
      .from(governancePolicies)
      .where(
        and(
          eq(governancePolicies.organizationId, values.organizationId),
          eq(governancePolicies.scope, values.scope),
          values.scope === 'project' ? eq(governancePolicies.projectId, values.projectId) : undefined,
          values.scope === 'team' ? eq(governancePolicies.teamId, values.teamId ?? '') : undefined,
        ),
      )
      .orderBy(desc(governancePolicies.updatedAt))
      .get()) ?? null
  )
}

function policyRowFromLevel(values: {
  existing: GovernanceRow | null
  organizationId: string
  projectId: string
  scope: 'organization' | 'team' | 'project'
  teamId: string | null
  level: ConfigPolicyLevel
  configVersion: number
  configLabel: string | undefined
  timestamp: string
}) {
  return {
    id: values.existing?.id ?? newId('gov'),
    organizationId: values.organizationId,
    projectId: values.projectId,
    scope: values.scope,
    teamId: values.teamId,
    providerRules: stringify(values.level.providerRules ?? []),
    modelRules: stringify(values.level.modelRules ?? []),
    toolPolicy: stringify(values.level.toolPolicy ?? {}),
    mcpPolicy: stringify(values.level.mcpPolicy ?? {}),
    sandboxPolicy: stringify(values.level.sandboxPolicy ?? {}),
    budgetPolicy: stringify(values.level.budgetPolicy ?? {}),
    metadata: stringify({
      source: 'governance-config',
      configVersion: values.configVersion,
      ...(values.configLabel ? { configLabel: values.configLabel } : {}),
    }),
    createdAt: values.existing?.createdAt ?? values.timestamp,
    updatedAt: values.timestamp,
  }
}

type ConfigRule = {
  providerId?: string | undefined
  modelId?: string | undefined
  effect: 'allow' | 'deny'
  reason?: string | undefined
}

function levelFromRow(row: GovernanceRow | null): ConfigPolicyLevel {
  if (!row) {
    return {}
  }
  return {
    providerRules: parseJson<ConfigRule[]>(row.providerRules, []),
    modelRules: parseJson<ConfigRule[]>(row.modelRules, []),
    toolPolicy: parseJson<Record<string, unknown>>(row.toolPolicy, {}),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy, {}),
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy, {}),
    budgetPolicy: parseJson<Record<string, unknown>>(row.budgetPolicy, {}),
  }
}

function ruleDenies(rule: ConfigRule, providerId: string, modelId: string | null) {
  return (
    rule.effect === 'deny' &&
    (!rule.providerId || rule.providerId === '*' || rule.providerId === providerId) &&
    (!rule.modelId || rule.modelId === '*' || (modelId !== null && rule.modelId === modelId))
  )
}

// Computes the project-wide impact a proposed config would have without
// mutating policy: declared organization/project levels overlay the stored
// rows, declared access rules and budgets replace the stored sets, and
// team-scope rules are excluded because they bind only team members.
async function computeConfigImpact(db: Db, auth: AuthScope, config: GovernanceConfig) {
  const organizationLevel =
    config.organization ??
    levelFromRow(
      await scopedPolicyRow(db, {
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        scope: 'organization',
      }),
    )
  const projectLevel = config.project ?? levelFromRow(await currentPolicy(db, auth.project.id))

  const existingAccessRules = await db
    .select()
    .from(providerAccessRules)
    .where(eq(providerAccessRules.projectId, auth.project.id))
  const accessRuleSource: Array<ConfigRule & { teamId?: string | undefined }> =
    config.providerAccessRules ??
    existingAccessRules.map((rule) => ({
      ...(rule.providerId ? { providerId: rule.providerId } : {}),
      ...(rule.modelId ? { modelId: rule.modelId } : {}),
      ...(rule.teamId ? { teamId: rule.teamId } : {}),
      effect: rule.effect as 'allow' | 'deny',
      ...(rule.reason ? { reason: rule.reason } : {}),
    }))
  const accessRules: ConfigRule[] = accessRuleSource.filter((rule) => !rule.teamId)

  const denyRules: ConfigRule[] = [
    ...(organizationLevel.providerRules ?? []),
    ...(organizationLevel.modelRules ?? []),
    ...(projectLevel.providerRules ?? []),
    ...(projectLevel.modelRules ?? []),
    ...accessRules,
  ].filter((rule) => rule.effect === 'deny')

  const providers = await db
    .select({ id: providerConfigs.id, type: providerConfigs.type })
    .from(providerConfigs)
    .where(eq(providerConfigs.projectId, auth.project.id))
  const providerIds = [...new Set(['workers-ai', ...providers.flatMap((provider) => [provider.id, provider.type])])]
  const affectedProviders = providerIds.filter((providerId) =>
    denyRules.some((rule) => ruleDenies(rule, providerId, null) && (!rule.modelId || rule.modelId === '*')),
  )

  const agents = await db
    .select({
      id: agentDefinitions.id,
      name: agentDefinitions.name,
      provider: agentDefinitions.provider,
      model: agentDefinitions.model,
    })
    .from(agentDefinitions)
    .where(and(eq(agentDefinitions.projectId, auth.project.id), eq(agentDefinitions.status, 'active')))
  const affectedAgents = agents.flatMap((agent) => {
    const denied = denyRules.find((rule) => ruleDenies(rule, agent.provider, agent.model))
    if (!denied) {
      return []
    }
    return [
      {
        agentId: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        deniedBy: {
          category: denied.modelId && denied.modelId !== '*' ? 'model' : 'provider',
          rule: denied.modelId ?? denied.providerId ?? 'policy',
          reason: denied.reason ?? null,
        },
      },
    ]
  })

  const sandboxPolicy = mergeScalarRestrictive(organizationLevel.sandboxPolicy ?? {}, projectLevel.sandboxPolicy ?? {})
  const sandboxDisabled = sandboxPolicy.enabled === false || sandboxPolicy.status === 'disabled'
  const networkValue = sandboxPolicy.network
  const networkDisabled = networkValue === 'disabled' || networkValue === 'deny' || networkValue === 'offline'
  const environmentRows = await db
    .select({ id: environments.id, name: environments.name, hostingMode: environments.hostingMode })
    .from(environments)
    .where(and(eq(environments.projectId, auth.project.id), eq(environments.status, 'active')))
  const cloudEnvironments = environmentRows.filter((environment) => environment.hostingMode === 'cloud')
  const affectedEnvironments =
    sandboxDisabled || networkDisabled
      ? cloudEnvironments.map((environment) => ({
          environmentId: environment.id,
          name: environment.name,
          deniedBy: sandboxDisabled
            ? { category: 'sandbox', rule: 'sandboxPolicy.enabled' }
            : { category: 'sandbox_network', rule: 'sandboxPolicy.network' },
        }))
      : []

  const sessionCreationPaths: Record<string, unknown>[] = affectedAgents.map((agent) => ({
    path: 'session.create',
    agentId: agent.agentId,
    agentName: agent.name,
    provider: agent.provider,
    model: agent.model,
    deniedBy: agent.deniedBy,
  }))
  if (sandboxDisabled) {
    for (const environment of cloudEnvironments) {
      sessionCreationPaths.push({
        path: 'session.create',
        environmentId: environment.id,
        environmentName: environment.name,
        deniedBy: { category: 'sandbox', rule: 'sandboxPolicy.enabled' },
      })
    }
  }

  const monthPrefix = new Date().toISOString().slice(0, 7)
  const usage = await db
    .select({
      totalTokens: usageRecords.totalTokens,
      costMicros: usageRecords.costMicros,
      createdAt: usageRecords.createdAt,
    })
    .from(usageRecords)
    .where(and(eq(usageRecords.projectId, auth.project.id), eq(usageRecords.status, 'success')))
  const monthUsage = usage.filter((record) => record.createdAt.startsWith(monthPrefix))
  const usedTokens = monthUsage.reduce((sum, record) => sum + record.totalTokens, 0)
  const usedCostMicros = monthUsage.reduce((sum, record) => sum + record.costMicros, 0)
  const monthlyTokens = numericBudget(organizationLevel, projectLevel, 'monthlyTokens')
  const monthlyCostMicros = numericBudget(organizationLevel, projectLevel, 'monthlyCostMicros')
  if (monthlyTokens !== undefined && usedTokens >= monthlyTokens) {
    sessionCreationPaths.push({
      path: 'session.create',
      deniedBy: { category: 'budget', rule: 'monthlyTokens' },
    })
  } else if (monthlyCostMicros !== undefined && usedCostMicros >= monthlyCostMicros) {
    sessionCreationPaths.push({
      path: 'session.create',
      deniedBy: { category: 'budget', rule: 'monthlyCostMicros' },
    })
  }

  return { affectedAgents, affectedEnvironments, affectedProviders, sessionCreationPaths }
}

// Most-restrictive overlay for scalar sandbox values in preview: a
// restrictive broader-scope value survives a permissive project value.
function mergeScalarRestrictive(broader: Record<string, unknown>, specific: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...broader, ...specific }
  if (broader.enabled === false || specific.enabled === false) {
    merged.enabled = false
  }
  if (typeof broader.network === 'string' && ['disabled', 'deny', 'offline'].includes(broader.network)) {
    merged.network = broader.network
  }
  if (broader.status === 'disabled' || specific.status === 'disabled') {
    merged.status = 'disabled'
  }
  return merged
}

function numericBudget(organization: ConfigPolicyLevel, project: ConfigPolicyLevel, key: string) {
  const values = [organization.budgetPolicy?.[key], project.budgetPolicy?.[key]].filter(
    (value): value is number => typeof value === 'number',
  )
  return values.length > 0 ? Math.min(...values) : undefined
}

const readPolicyRoute = createRoute({
  method: 'get',
  path: '/policy',
  operationId: 'readGovernancePolicy',
  tags: ['Governance'],
  summary: 'Read governance policy',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Governance policy', content: { 'application/json': { schema: GovernancePolicySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updatePolicyRoute = createRoute({
  method: 'put',
  path: '/policy',
  operationId: 'updateGovernancePolicy',
  tags: ['Governance'],
  summary: 'Update governance policy',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: GovernancePayloadSchema } } } },
  responses: {
    200: { description: 'Governance policy', content: { 'application/json': { schema: GovernancePolicySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const effectivePolicyRoute = createRoute({
  method: 'get',
  path: '/effective-policy',
  operationId: 'readEffectiveGovernancePolicy',
  tags: ['Governance'],
  summary: 'Read effective governance policy',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Effective policy', content: { 'application/json': { schema: EffectivePolicySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const evaluateRoute = createRoute({
  method: 'post',
  path: '/evaluations',
  operationId: 'evaluateGovernancePolicy',
  tags: ['Governance'],
  summary: 'Evaluate governance policy',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: EvaluationRequestSchema } } } },
  responses: {
    200: { description: 'Policy decision', content: { 'application/json': { schema: EvaluationSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listAccessRulesRoute = createRoute({
  method: 'get',
  path: '/provider-access-rules',
  operationId: 'listProviderAccessRules',
  tags: ['Governance'],
  summary: 'List provider access rules',
  ...AuthenticatedOperation,
  responses: {
    200: {
      description: 'Provider access rules',
      content: { 'application/json': { schema: AccessRuleListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createAccessRuleRoute = createRoute({
  method: 'post',
  path: '/provider-access-rules',
  operationId: 'createProviderAccessRule',
  tags: ['Governance'],
  summary: 'Create provider access rule',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: AccessRulePayloadSchema } } } },
  responses: {
    201: { description: 'Provider access rule', content: { 'application/json': { schema: AccessRuleSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listBudgetsRoute = createRoute({
  method: 'get',
  path: '/budgets',
  operationId: 'listBudgets',
  tags: ['Governance'],
  summary: 'List budgets',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Budgets', content: { 'application/json': { schema: BudgetListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createBudgetRoute = createRoute({
  method: 'post',
  path: '/budgets',
  operationId: 'createBudget',
  tags: ['Governance'],
  summary: 'Create budget',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: BudgetPayloadSchema } } } },
  responses: {
    201: { description: 'Budget', content: { 'application/json': { schema: BudgetSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const validateConfigRoute = createRoute({
  method: 'post',
  path: '/config/validate',
  operationId: 'validateGovernanceConfig',
  tags: ['Governance'],
  summary: 'Validate declarative governance config',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: GovernanceConfigSchema } } } },
  responses: {
    200: {
      description: 'Config is valid',
      content: { 'application/json': { schema: ConfigValidationResultSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const applyConfigRoute = createRoute({
  method: 'post',
  path: '/config',
  operationId: 'applyGovernanceConfig',
  tags: ['Governance'],
  summary: 'Apply declarative governance config atomically',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: GovernanceConfigSchema } } } },
  responses: {
    200: {
      description: 'Config applied',
      content: { 'application/json': { schema: ConfigApplyResultSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const previewConfigRoute = createRoute({
  method: 'post',
  path: '/config/preview',
  operationId: 'previewGovernanceConfig',
  tags: ['Governance'],
  summary: 'Preview declarative governance config impact',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: GovernanceConfigSchema } } } },
  responses: {
    200: {
      description: 'Config impact preview',
      content: { 'application/json': { schema: ConfigPreviewResultSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(readPolicyRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const policy = await currentPolicy(db, auth.project.id)
    if (policy) return c.json(serializePolicy(policy), 200)
    const timestamp = now()
    return c.json(
      serializePolicy({
        id: 'governance_default',
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        scope: 'project',
        teamId: null,
        providerRules: '[]',
        modelRules: '[]',
        toolPolicy: '{}',
        mcpPolicy: '{}',
        sandboxPolicy: '{}',
        budgetPolicy: '{}',
        metadata: '{"platformDefault":true}',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      200,
    )
  })
  .openapi(updatePolicyRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await currentPolicy(db, auth.project.id)
    const timestamp = now()
    const row = {
      id: existing?.id ?? newId('gov'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      scope: 'project',
      teamId: null,
      providerRules: stringify(body.providerRules ?? (existing ? parseJson(existing.providerRules, []) : [])),
      modelRules: stringify(body.modelRules ?? (existing ? parseJson(existing.modelRules, []) : [])),
      toolPolicy: stringify(body.toolPolicy ?? (existing ? parseJson(existing.toolPolicy, {}) : {})),
      mcpPolicy: stringify(body.mcpPolicy ?? (existing ? parseJson(existing.mcpPolicy, {}) : {})),
      sandboxPolicy: stringify(body.sandboxPolicy ?? (existing ? parseJson(existing.sandboxPolicy, {}) : {})),
      budgetPolicy: stringify(body.budgetPolicy ?? (existing ? parseJson(existing.budgetPolicy, {}) : {})),
      metadata: stringify(body.metadata ?? (existing ? parseJson(existing.metadata, {}) : {})),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    if (existing) {
      await db.update(governancePolicies).set(row).where(eq(governancePolicies.id, existing.id))
    } else {
      await db.insert(governancePolicies).values(row)
    }
    await recordAudit(db, {
      auth,
      action: 'governance_policy.update',
      resourceType: 'governance_policy',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      before: existing ? serializePolicy(existing) : null,
      after: serializePolicy(row),
    })
    return c.json(serializePolicy(row), 200)
  })
  .openapi(effectivePolicyRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    return c.json(await resolveEffectivePolicy(db, auth), 200)
  })
  .openapi(evaluateRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const decision = await evaluateProviderPolicy(db, auth, body)
    if (!decision.allowed) {
      await recordAudit(db, {
        auth,
        action: 'policy.evaluate',
        resourceType: 'policy',
        resourceId: decision.rule,
        outcome: 'denied',
        requestId: requestId(c),
        sessionId: body.sessionId ?? null,
        policyCategory: decision.category,
        metadata: { providerId: body.providerId, modelId: body.modelId, decision },
      })
      return errorResponse(c, 403, 'policy_denied', decision.message, {
        category: decision.category,
        resourceType: decision.category === 'budget' ? 'budget' : decision.category === 'model' ? 'model' : 'provider',
        resourceId:
          decision.category === 'budget'
            ? decision.rule
            : decision.category === 'model'
              ? body.modelId
              : body.providerId,
        ruleId: decision.rule,
      })
    }
    await recordAudit(db, {
      auth,
      action: 'policy.evaluate',
      resourceType: 'policy',
      resourceId: decision.rule,
      outcome: 'success',
      requestId: requestId(c),
      sessionId: body.sessionId ?? null,
      policyCategory: decision.category,
      metadata: { providerId: body.providerId, modelId: body.modelId },
    })
    return c.json(decision, 200)
  })
  .openapi(listAccessRulesRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const rows = await db.select().from(providerAccessRules).where(eq(providerAccessRules.projectId, auth.project.id))
    return c.json(
      {
        data: rows.map(serializeAccessRule),
        pagination: {
          limit: rows.length,
          nextCursor: null,
          hasMore: false,
          firstId: rows[0]?.id ?? null,
          lastId: rows.at(-1)?.id ?? null,
        },
      },
      200,
    )
  })
  .openapi(createAccessRuleRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const timestamp = now()
    const row = {
      id: newId('access'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      providerId: body.providerId ?? '*',
      modelId: body.modelId ?? '*',
      teamId: body.teamId ?? null,
      effect: body.effect,
      reason: body.reason ?? null,
      metadata: stringify(body.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(providerAccessRules).values(row)
    await recordAudit(db, {
      auth,
      action: 'provider_access_rule.create',
      resourceType: 'provider_access_rule',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serializeAccessRule(row),
    })
    return c.json(serializeAccessRule(row), 201)
  })
  .openapi(listBudgetsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const rows = await db.select().from(budgets).where(eq(budgets.projectId, auth.project.id))
    return c.json(
      {
        data: rows.map(serializeBudget),
        pagination: {
          limit: rows.length,
          nextCursor: null,
          hasMore: false,
          firstId: rows[0]?.id ?? null,
          lastId: rows.at(-1)?.id ?? null,
        },
      },
      200,
    )
  })
  .openapi(createBudgetRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const timestamp = now()
    const row = {
      id: newId('budget'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      scope: body.scope,
      providerId: body.providerId ?? null,
      modelId: body.modelId ?? null,
      limitType: body.limitType,
      limitValue: body.limitValue,
      window: body.window,
      status: body.status ?? 'active',
      metadata: stringify(body.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(budgets).values(row)
    await recordAudit(db, {
      auth,
      action: 'budget.create',
      resourceType: 'budget',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serializeBudget(row),
    })
    return c.json(serializeBudget(row), 201)
  })
  .openapi(validateConfigRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const fields = await validateGovernanceConfig(db, auth, body)
    if (Object.keys(fields).length > 0) {
      return errorResponse(c, 400, 'validation_error', 'Governance config is invalid', { fields })
    }
    return c.json(
      {
        valid: true as const,
        configVersion: await nextConfigVersion(db, auth.project.id),
        summary: configSummary(body),
      },
      200,
    )
  })
  .openapi(applyConfigRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const fields = await validateGovernanceConfig(db, auth, body)
    if (Object.keys(fields).length > 0) {
      return errorResponse(c, 400, 'validation_error', 'Governance config is invalid', { fields })
    }

    const configVersion = await nextConfigVersion(db, auth.project.id)
    const timestamp = now()
    const summary = configSummary(body)
    type BatchStatement = Parameters<typeof db.batch>[0][number]
    const statements: BatchStatement[] = []

    const declaredLevels: Array<{
      scope: 'organization' | 'team' | 'project'
      teamId: string | null
      level: ConfigPolicyLevel
    }> = [
      ...(body.organization ? [{ scope: 'organization' as const, teamId: null, level: body.organization }] : []),
      ...(body.teams ?? []).map((team) => {
        const { teamId, ...level } = team
        return { scope: 'team' as const, teamId, level }
      }),
      ...(body.project ? [{ scope: 'project' as const, teamId: null, level: body.project }] : []),
    ]
    for (const declared of declaredLevels) {
      const existing = await scopedPolicyRow(db, {
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        scope: declared.scope,
        ...(declared.teamId ? { teamId: declared.teamId } : {}),
      })
      const row = policyRowFromLevel({
        existing,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        scope: declared.scope,
        teamId: declared.teamId,
        level: declared.level,
        configVersion,
        configLabel: body.version,
        timestamp,
      })
      statements.push(
        existing
          ? db.update(governancePolicies).set(row).where(eq(governancePolicies.id, existing.id))
          : db.insert(governancePolicies).values(row),
      )
    }

    if (body.providerAccessRules !== undefined) {
      statements.push(db.delete(providerAccessRules).where(eq(providerAccessRules.projectId, auth.project.id)))
      for (const rule of body.providerAccessRules) {
        statements.push(
          db.insert(providerAccessRules).values({
            id: newId('access'),
            organizationId: auth.organization.id,
            projectId: auth.project.id,
            providerId: rule.providerId ?? '*',
            modelId: rule.modelId ?? '*',
            teamId: rule.teamId ?? null,
            effect: rule.effect,
            reason: rule.reason ?? null,
            metadata: stringify({ source: 'governance-config', configVersion }),
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        )
      }
    }

    if (body.budgets !== undefined) {
      statements.push(db.delete(budgets).where(eq(budgets.projectId, auth.project.id)))
      for (const budget of body.budgets) {
        statements.push(
          db.insert(budgets).values({
            id: newId('budget'),
            organizationId: auth.organization.id,
            projectId: auth.project.id,
            scope: budget.scope,
            providerId: budget.providerId ?? null,
            modelId: budget.modelId ?? null,
            limitType: budget.limitType,
            limitValue: budget.limitValue,
            window: budget.window,
            status: budget.status ?? 'active',
            metadata: stringify({ source: 'governance-config', configVersion }),
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        )
      }
    }

    // The audit record is part of the same atomic batch: an applied config is
    // always auditable, and a failed apply records nothing at all.
    statements.push(
      db.insert(auditRecords).values({
        id: newId('audit'),
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        actorUserId: auth.user.id,
        actorType: 'user',
        action: 'governance_config.apply',
        resourceType: 'governance_config',
        resourceId: `config_v${configVersion}`,
        outcome: 'success',
        requestId: requestId(c),
        correlationId: null,
        sessionId: null,
        policyCategory: null,
        metadata: stringify(
          redactSecrets({
            configVersion,
            ...(body.version ? { configLabel: body.version } : {}),
            summary,
          }),
        ),
        before: '{}',
        after: '{}',
        createdAt: timestamp,
      }),
    )

    await db.batch(statements as [BatchStatement, ...BatchStatement[]])
    return c.json({ applied: true as const, configVersion, summary }, 200)
  })
  .openapi(previewConfigRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const fields = await validateGovernanceConfig(db, auth, body)
    if (Object.keys(fields).length > 0) {
      return errorResponse(c, 400, 'validation_error', 'Governance config is invalid', { fields })
    }
    const impact = await computeConfigImpact(db, auth, body)
    return c.json(
      {
        configVersion: await nextConfigVersion(db, auth.project.id),
        mutatesPolicy: false as const,
        impact,
      },
      200,
    )
  })

export default routes
