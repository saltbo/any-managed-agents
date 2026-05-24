import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { budgets, governancePolicies, providerAccessRules } from '../db/schema'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema, listResponseSchema } from '../openapi'
import { evaluateProviderPolicy, resolveEffectivePolicy } from '../policy'

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
    providerId: z.string().nullable(),
    modelId: z.string().nullable(),
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
    providerRules: z.array(RuleSchema),
    modelRules: z.array(RuleSchema),
    accessRules: z.array(JsonObjectSchema),
    toolPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    sandboxPolicy: JsonObjectSchema,
    budgetPolicy: JsonObjectSchema,
  })
  .openapi('EffectivePolicy')

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
    providerId: row.providerId,
    modelId: row.modelId,
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

app.openapi(readPolicyRoute, async (c) => {
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

app.openapi(updatePolicyRoute, async (c) => {
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

app.openapi(effectivePolicyRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  return c.json(await resolveEffectivePolicy(db, auth), 200)
})

app.openapi(evaluateRoute, async (c) => {
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
        decision.category === 'budget' ? decision.rule : decision.category === 'model' ? body.modelId : body.providerId,
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

app.openapi(listAccessRulesRoute, async (c) => {
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

app.openapi(createAccessRuleRoute, async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const timestamp = now()
  const row = {
    id: newId('access'),
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    providerId: body.providerId ?? null,
    modelId: body.modelId ?? null,
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

app.openapi(listBudgetsRoute, async (c) => {
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

app.openapi(createBudgetRoute, async (c) => {
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

export default app
