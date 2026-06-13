import { createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { accessRules } from '../db/schema'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema, listResponseSchema } from '../openapi'

const app = createApiRouter()

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

type AccessRuleRow = typeof accessRules.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
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

async function ruleById(db: ReturnType<typeof drizzle>, projectId: string, ruleId: string) {
  return (
    (await db
      .select()
      .from(accessRules)
      .where(and(eq(accessRules.id, ruleId), eq(accessRules.projectId, projectId)))
      .get()) ?? null
  )
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

const routes = app
  .openapi(listRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const rows = await db.select().from(accessRules).where(eq(accessRules.projectId, auth.project.id))
    return c.json(
      {
        data: rows.map(serializeAccessRule),
        pagination: { limit: rows.length, nextCursor: null, hasMore: false },
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
      metadata: JSON.stringify(body.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(accessRules).values(row)
    await recordAudit(db, {
      auth,
      action: 'access_rule.create',
      resourceType: 'access_rule',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serializeAccessRule(row),
    })
    return c.json(serializeAccessRule(row), 201)
  })
  .openapi(readRoute, async (c) => {
    const { ruleId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const row = await ruleById(db, auth.project.id, ruleId)
    if (!row) return errorResponse(c, 404, 'not_found', 'Access rule not found')
    return c.json(serializeAccessRule(row), 200)
  })
  .openapi(updateRoute, async (c) => {
    const { ruleId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await ruleById(db, auth.project.id, ruleId)
    if (!existing) return errorResponse(c, 404, 'not_found', 'Access rule not found')
    const row = {
      ...existing,
      effect: body.effect ?? existing.effect,
      reason: body.reason === undefined ? existing.reason : body.reason,
      metadata: body.metadata === undefined ? existing.metadata : JSON.stringify(body.metadata),
      updatedAt: now(),
    }
    await db.update(accessRules).set(row).where(eq(accessRules.id, existing.id))
    await recordAudit(db, {
      auth,
      action: 'access_rule.update',
      resourceType: 'access_rule',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeAccessRule(existing),
      after: serializeAccessRule(row),
    })
    return c.json(serializeAccessRule(row), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const { ruleId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await ruleById(db, auth.project.id, ruleId)
    if (!existing) return errorResponse(c, 404, 'not_found', 'Access rule not found')
    await db.delete(accessRules).where(eq(accessRules.id, existing.id))
    await recordAudit(db, {
      auth,
      action: 'access_rule.delete',
      resourceType: 'access_rule',
      resourceId: existing.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeAccessRule(existing),
    })
    return c.body(null, 204)
  })

export default routes
