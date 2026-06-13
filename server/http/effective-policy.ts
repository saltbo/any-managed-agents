import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema } from '../openapi'
import { readEffectivePolicy } from '../usecases/effective-policy'
import type { AuthScope } from '../usecases/ports'
import { requestId } from './request-context'

type EffectivePolicyRoutes = OpenAPIHono<DepsEnv>

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

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
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

// effective-policy is a read-only derived resource: GET merges the policy
// hierarchy + access rules + enabled budgets, and optionally attaches a
// provider/model decision. The assembler in app.ts mounts this at the resource's
// original chain position.
export function registerEffectivePolicyRoutes(routes: EffectivePolicyRoutes) {
  return routes.openapi(readRoute, async (c) => {
    const query = c.req.valid('query')
    const deps = c.get('deps')
    const auth = await requireAuth(c)
    if (auth instanceof Response) {
      return auth
    }
    // A policy decision requires both providerId and modelId, so a single one is
    // a validation error.
    if ((query.providerId === undefined) !== (query.modelId === undefined)) {
      return c.json(
        errorBody('validation_error', 'providerId and modelId must be provided together', {
          fields: {
            [query.providerId === undefined ? 'providerId' : 'modelId']:
              'Both providerId and modelId are required for a policy decision.',
          },
        }),
        400,
      )
    }

    const effective = await readEffectivePolicy(deps, authScope(auth), {
      ...(query.teamId !== undefined ? { teamId: query.teamId } : {}),
      ...(query.providerId !== undefined ? { providerId: query.providerId } : {}),
      ...(query.modelId !== undefined ? { modelId: query.modelId } : {}),
      requestId: requestId(c),
    })

    return c.json(
      {
        source: effective.source,
        sources: effective.sources,
        providerRules: effective.providerRules,
        modelRules: effective.modelRules,
        accessRules: effective.accessRules,
        toolPolicy: effective.toolPolicy,
        mcpPolicy: effective.mcpPolicy,
        sandboxPolicy: effective.sandboxPolicy,
        budgets: effective.budgets.map((budget) => ({
          id: budget.id,
          scope: budget.scope,
          providerId: budget.providerId,
          modelId: budget.modelId,
          limitType: budget.limitType,
          limitValue: budget.limitValue,
          window: budget.window,
          enabled: budget.enabled,
          metadata: budget.metadata,
        })),
        ...(effective.decision ? { decision: effective.decision } : {}),
      },
      200,
    )
  })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}
