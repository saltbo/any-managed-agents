import { createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { budgets } from '../db/schema'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema } from '../openapi'
import { evaluateProviderPolicy, resolveEffectivePolicy } from '../policy'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())

const PolicyDecisionSchema = z
  .object({
    allowed: z.boolean(),
    category: z.string().openapi({ example: 'provider' }),
    rule: z.string().nullable(),
    message: z.string().openapi({ example: 'Allowed by effective policy.' }),
  })
  .openapi('PolicyDecision')

const EffectiveRuleSchema = z
  .object({
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    effect: z.enum(['allow', 'deny']),
    reason: z.string().optional(),
  })
  .openapi('EffectiveRule')

const EffectiveAccessRuleSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    teamId: z.string().nullable(),
    effect: z.string(),
    reason: z.string().nullable(),
  })
  .openapi('EffectiveAccessRule')

const EffectiveBudgetSchema = z
  .object({
    id: z.string(),
    scope: z.string(),
    providerId: z.string().nullable(),
    modelId: z.string().nullable(),
    limitType: z.string(),
    limitValue: z.number().int(),
    window: z.string(),
    enabled: z.boolean(),
    metadata: JsonObjectSchema,
  })
  .openapi('EffectiveBudget')

const EffectivePolicySchema = z
  .object({
    source: z.object({ type: z.string(), id: z.string() }),
    sources: z.array(z.object({ scope: z.string(), id: z.string(), teamId: z.string().nullable() })),
    providerRules: z.array(EffectiveRuleSchema),
    modelRules: z.array(EffectiveRuleSchema),
    accessRules: z.array(EffectiveAccessRuleSchema),
    toolPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    sandboxPolicy: JsonObjectSchema,
    budgets: z.array(EffectiveBudgetSchema),
    decision: PolicyDecisionSchema.optional(),
  })
  .openapi('EffectivePolicy')

const QuerySchema = z.object({
  teamId: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'teamId', in: 'query' }, example: 'team_platform' }),
  providerId: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'providerId', in: 'query' }, example: 'workers-ai' }),
  modelId: z
    .string()
    .min(1)
    .optional()
    .openapi({ param: { name: 'modelId', in: 'query' }, example: '@cf/moonshotai/kimi-k2.6' }),
})

type BudgetRow = typeof budgets.$inferSelect
type EffectiveAccessRule = Awaited<ReturnType<typeof resolveEffectivePolicy>>['accessRules'][number]

// Provider/model allow|deny rules live only in the access_rules table:
// rules without a model scope surface as providerRules, model-scoped rules
// as modelRules.
function ruleView(rule: EffectiveAccessRule) {
  return {
    ...(rule.providerId === '*' ? {} : { providerId: rule.providerId }),
    ...(rule.modelId === '*' ? {} : { modelId: rule.modelId }),
    effect: rule.effect as 'allow' | 'deny',
    ...(rule.reason ? { reason: rule.reason } : {}),
  }
}

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
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
    enabled: row.enabled,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  }
}

const readRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'readEffectivePolicy',
  tags: ['Governance'],
  summary: 'Read the effective governance policy',
  description:
    'Merges organization, team, and project policies with access rules and enabled budgets. Pass teamId to resolve the policy as a member of that team. Pass providerId and modelId together to attach a policy decision for that provider/model pair.',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: { description: 'Effective policy', content: { 'application/json': { schema: EffectivePolicySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app.openapi(readRoute, async (c) => {
  const query = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  if ((query.providerId === undefined) !== (query.modelId === undefined)) {
    return errorResponse(c, 400, 'validation_error', 'providerId and modelId must be provided together', {
      fields: {
        [query.providerId === undefined ? 'providerId' : 'modelId']:
          'Both providerId and modelId are required for a policy decision.',
      },
    })
  }

  const scopedAuth = query.teamId ? { ...auth, teams: [query.teamId] } : auth
  const effective = await resolveEffectivePolicy(db, scopedAuth)
  const budgetRows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.projectId, auth.project.id), eq(budgets.enabled, true)))

  let decision: Awaited<ReturnType<typeof evaluateProviderPolicy>> | undefined
  if (query.providerId && query.modelId) {
    decision = await evaluateProviderPolicy(db, scopedAuth, {
      providerId: query.providerId,
      modelId: query.modelId,
    })
    await recordAudit(db, {
      auth,
      action: 'policy.evaluate',
      resourceType: 'policy',
      resourceId: decision.rule,
      outcome: decision.allowed ? 'success' : 'denied',
      requestId: requestId(c),
      policyCategory: decision.category,
      metadata: {
        providerId: query.providerId,
        modelId: query.modelId,
        ...(decision.allowed ? {} : { decision }),
      },
    })
  }

  return c.json(
    {
      source: effective.source,
      sources: effective.sources,
      providerRules: effective.accessRules.filter((rule) => rule.modelId === '*').map(ruleView),
      modelRules: effective.accessRules.filter((rule) => rule.modelId !== '*').map(ruleView),
      accessRules: effective.accessRules,
      toolPolicy: effective.toolPolicy,
      mcpPolicy: effective.mcpPolicy,
      sandboxPolicy: effective.sandboxPolicy,
      budgets: budgetRows.map(serializeBudget),
      ...(decision ? { decision } : {}),
    },
    200,
  )
})

export default routes
