import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { drizzle } from 'drizzle-orm/d1'
import { requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema, listResponseSchema } from '../openapi'
import { type UpdateAccessRulePatch, updateAccessRule } from '../usecases/access-rules'
import type { AccessRuleRecord, AuthScope } from '../usecases/ports'

type AccessRuleRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

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
  .openapi('AccessRule')

const CreateAccessRuleSchema = z
  .object({
    providerId: z.string().min(1).optional().openapi({ example: 'workers-ai' }),
    modelId: z.string().min(1).optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    teamId: z.string().min(1).optional().openapi({ example: 'team_platform' }),
    effect: z.enum(['allow', 'deny']).openapi({ example: 'deny' }),
    reason: z.string().max(500).optional().openapi({ example: 'Not approved for this project.' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { source: 'admin' } }),
  })
  .strict()
  .openapi('CreateAccessRuleRequest')

const UpdateAccessRuleSchema = z
  .object({
    effect: z.enum(['allow', 'deny']).optional(),
    reason: z.string().max(500).nullable().optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('UpdateAccessRuleRequest')

const AccessRuleListResponseSchema = listResponseSchema('AccessRuleListResponse', AccessRuleSchema)

const AccessRuleParamsSchema = z.object({
  ruleId: z.string().openapi({ param: { name: 'ruleId', in: 'path' }, example: 'access_abc123' }),
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function serializeAccessRule(record: AccessRuleRecord) {
  return {
    id: record.id,
    providerId: record.providerId,
    modelId: record.modelId,
    teamId: record.teamId,
    effect: record.effect,
    reason: record.reason,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAccessRules',
  tags: ['Governance'],
  summary: 'List provider and model access rules',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Access rules', content: { 'application/json': { schema: AccessRuleListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createAccessRuleRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createAccessRule',
  tags: ['Governance'],
  summary: 'Create an access rule',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateAccessRuleSchema } } } },
  responses: {
    201: { description: 'Created access rule', content: { 'application/json': { schema: AccessRuleSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{ruleId}',
  operationId: 'readAccessRule',
  tags: ['Governance'],
  summary: 'Read an access rule',
  ...AuthenticatedOperation,
  request: { params: AccessRuleParamsSchema },
  responses: {
    200: { description: 'Access rule', content: { 'application/json': { schema: AccessRuleSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Access rule not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{ruleId}',
  operationId: 'updateAccessRule',
  tags: ['Governance'],
  summary: 'Update an access rule',
  ...AuthenticatedOperation,
  request: {
    params: AccessRuleParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateAccessRuleSchema } } },
  },
  responses: {
    200: { description: 'Updated access rule', content: { 'application/json': { schema: AccessRuleSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Access rule not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{ruleId}',
  operationId: 'deleteAccessRule',
  tags: ['Governance'],
  summary: 'Delete an access rule',
  ...AuthenticatedOperation,
  request: { params: AccessRuleParamsSchema },
  responses: {
    204: { description: 'Access rule deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Access rule not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: static segments register before parameter
// segments. The assembler in app.ts calls this at the access-rules resource's
// original mount position.
export function registerAccessRuleRoutes(routes: AccessRuleRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const records = await deps.accessRules.list(auth.project.id)
      return c.json(
        {
          data: records.map(serializeAccessRule),
          pagination: { limit: records.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(createAccessRuleRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const scope = authScope(auth)
      // Create is a pure forward with wildcard defaulting — no orchestration, so
      // the route maps the body to the repo input directly (anti-ceremony).
      const rule = await deps.accessRules.insert(
        {
          organizationId: auth.organization.id,
          projectId: auth.project.id,
          providerId: body.providerId ?? '*',
          modelId: body.modelId ?? '*',
          teamId: body.teamId ?? null,
          effect: body.effect,
          reason: body.reason ?? null,
          metadata: body.metadata ?? {},
        },
        new Date().toISOString(),
      )
      await deps.audit.record(scope, {
        action: 'access_rule.create',
        resourceType: 'access_rule',
        resourceId: rule.id,
        outcome: 'success',
        requestId: requestId(c),
        after: serializeAccessRule(rule),
      })
      return c.json(serializeAccessRule(rule), 201)
    })
    .openapi(readRoute, async (c) => {
      const { ruleId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const rule = await deps.accessRules.find(auth.project.id, ruleId)
      if (!rule) {
        return c.json(errorBody('not_found', 'Access rule not found'), 404)
      }
      return c.json(serializeAccessRule(rule), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { ruleId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const existing = await deps.accessRules.find(auth.project.id, ruleId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Access rule not found'), 404)
      }
      const scope = authScope(auth)
      const rule = await updateAccessRule(deps, scope, existing, patchFromBody(body))
      await deps.audit.record(scope, {
        action: 'access_rule.update',
        resourceType: 'access_rule',
        resourceId: rule.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeAccessRule(existing),
        after: serializeAccessRule(rule),
      })
      return c.json(serializeAccessRule(rule), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { ruleId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c, drizzle(c.env.DB))
      if (auth instanceof Response) {
        return auth
      }
      const existing = await deps.accessRules.find(auth.project.id, ruleId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Access rule not found'), 404)
      }
      const scope = authScope(auth)
      await deps.accessRules.delete(auth.project.id, ruleId)
      await deps.audit.record(scope, {
        action: 'access_rule.delete',
        resourceType: 'access_rule',
        resourceId: existing.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeAccessRule(existing),
      })
      return c.body(null, 204)
    })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}

function patchFromBody(body: z.infer<typeof UpdateAccessRuleSchema>): UpdateAccessRulePatch {
  return {
    ...(body.effect !== undefined ? { effect: body.effect } : {}),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  }
}
