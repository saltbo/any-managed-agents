import { createRoute, z } from '@hono/zod-openapi'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { policies } from '../db/schema'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema, listResponseSchema } from '../openapi'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())

const PolicyScopeSchema = z
  .object({
    level: z.enum(['organization', 'team', 'project']).openapi({ example: 'project' }),
    teamId: z.string().min(1).optional().openapi({ example: 'team_platform' }),
  })
  .strict()
  .openapi('PolicyScope')

const PolicySchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    scope: PolicyScopeSchema,
    toolPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    sandboxPolicy: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Policy')

const CreatePolicySchema = z
  .object({
    scope: PolicyScopeSchema,
    toolPolicy: JsonObjectSchema.optional(),
    mcpPolicy: JsonObjectSchema.optional(),
    sandboxPolicy: JsonObjectSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreatePolicyRequest')

// PUT replaces the whole policy document: omitted policy objects reset to {}.
// Scope identifies the row and is immutable after creation.
const ReplacePolicySchema = z
  .object({
    scope: PolicyScopeSchema.optional(),
    toolPolicy: JsonObjectSchema.optional(),
    mcpPolicy: JsonObjectSchema.optional(),
    sandboxPolicy: JsonObjectSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('ReplacePolicyRequest')

const PolicyListResponseSchema = listResponseSchema('PolicyListResponse', PolicySchema)

const PolicyParamsSchema = z.object({
  policyId: z.string().openapi({ param: { name: 'policyId', in: 'path' }, example: 'policy_abc123' }),
})

type PolicyRow = typeof policies.$inferSelect
type PolicyScope = z.infer<typeof PolicyScopeSchema>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function serializePolicy(row: PolicyRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    scope: {
      level: row.scope as PolicyScope['level'],
      ...(row.teamId ? { teamId: row.teamId } : {}),
    },
    toolPolicy: parseJson<Record<string, unknown>>(row.toolPolicy, {}),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy, {}),
    sandboxPolicy: parseJson<Record<string, unknown>>(row.sandboxPolicy, {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function scopeValidationErrors(scope: PolicyScope) {
  const fields: Record<string, string> = {}
  if (scope.level === 'team' && !scope.teamId) {
    fields['scope.teamId'] = 'Team-scoped policies require teamId.'
  }
  if (scope.level !== 'team' && scope.teamId) {
    fields['scope.teamId'] = 'teamId is only valid for team-scoped policies.'
  }
  return fields
}

async function policyByScope(db: ReturnType<typeof drizzle>, projectId: string, scope: PolicyScope) {
  return (
    (await db
      .select()
      .from(policies)
      .where(
        and(
          eq(policies.projectId, projectId),
          eq(policies.scope, scope.level),
          scope.teamId ? eq(policies.teamId, scope.teamId) : isNull(policies.teamId),
        ),
      )
      .get()) ?? null
  )
}

async function policyById(db: ReturnType<typeof drizzle>, projectId: string, policyId: string) {
  return (
    (await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.projectId, projectId)))
      .get()) ?? null
  )
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listPolicies',
  tags: ['Governance'],
  summary: 'List scoped governance policies',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Policies', content: { 'application/json': { schema: PolicyListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createPolicyRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createPolicy',
  tags: ['Governance'],
  summary: 'Create a scoped governance policy',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreatePolicySchema } } } },
  responses: {
    201: { description: 'Created policy', content: { 'application/json': { schema: PolicySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'A policy already exists for this scope',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{policyId}',
  operationId: 'readPolicy',
  tags: ['Governance'],
  summary: 'Read a governance policy',
  ...AuthenticatedOperation,
  request: { params: PolicyParamsSchema },
  responses: {
    200: { description: 'Policy', content: { 'application/json': { schema: PolicySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const replaceRoute = createRoute({
  method: 'put',
  path: '/{policyId}',
  operationId: 'replacePolicy',
  tags: ['Governance'],
  summary: 'Replace a governance policy',
  ...AuthenticatedOperation,
  request: {
    params: PolicyParamsSchema,
    body: { required: true, content: { 'application/json': { schema: ReplacePolicySchema } } },
  },
  responses: {
    200: { description: 'Replaced policy', content: { 'application/json': { schema: PolicySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{policyId}',
  operationId: 'deletePolicy',
  tags: ['Governance'],
  summary: 'Delete a governance policy',
  ...AuthenticatedOperation,
  request: { params: PolicyParamsSchema },
  responses: {
    204: { description: 'Policy deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const rows = await db.select().from(policies).where(eq(policies.projectId, auth.project.id))
    return c.json(
      {
        data: rows.map(serializePolicy),
        pagination: { limit: rows.length, nextCursor: null, hasMore: false },
      },
      200,
    )
  })
  .openapi(createPolicyRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const fields = scopeValidationErrors(body.scope)
    if (Object.keys(fields).length > 0) {
      return errorResponse(c, 400, 'validation_error', 'Policy scope is invalid', { fields })
    }
    const existing = await policyByScope(db, auth.project.id, body.scope)
    if (existing) {
      return errorResponse(c, 409, 'conflict', 'A policy already exists for this scope', {
        resourceType: 'policy',
        resourceId: existing.id,
      })
    }
    const timestamp = now()
    const row = {
      id: newId('policy'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      scope: body.scope.level,
      teamId: body.scope.teamId ?? null,
      toolPolicy: JSON.stringify(body.toolPolicy ?? {}),
      mcpPolicy: JSON.stringify(body.mcpPolicy ?? {}),
      sandboxPolicy: JSON.stringify(body.sandboxPolicy ?? {}),
      metadata: JSON.stringify(body.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(policies).values(row)
    await recordAudit(db, {
      auth,
      action: 'policy.create',
      resourceType: 'policy',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serializePolicy(row),
    })
    return c.json(serializePolicy(row), 201)
  })
  .openapi(readRoute, async (c) => {
    const { policyId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const row = await policyById(db, auth.project.id, policyId)
    if (!row) return errorResponse(c, 404, 'not_found', 'Policy not found')
    return c.json(serializePolicy(row), 200)
  })
  .openapi(replaceRoute, async (c) => {
    const { policyId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await policyById(db, auth.project.id, policyId)
    if (!existing) return errorResponse(c, 404, 'not_found', 'Policy not found')
    if (body.scope && (body.scope.level !== existing.scope || (body.scope.teamId ?? null) !== existing.teamId)) {
      return errorResponse(c, 400, 'validation_error', 'Policy scope is immutable', {
        fields: { scope: 'Scope cannot change after creation. Delete the policy and create a new one.' },
      })
    }
    const row = {
      ...existing,
      toolPolicy: JSON.stringify(body.toolPolicy ?? {}),
      mcpPolicy: JSON.stringify(body.mcpPolicy ?? {}),
      sandboxPolicy: JSON.stringify(body.sandboxPolicy ?? {}),
      metadata: JSON.stringify(body.metadata ?? {}),
      updatedAt: now(),
    }
    await db.update(policies).set(row).where(eq(policies.id, existing.id))
    await recordAudit(db, {
      auth,
      action: 'policy.update',
      resourceType: 'policy',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializePolicy(existing),
      after: serializePolicy(row),
    })
    return c.json(serializePolicy(row), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const { policyId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await policyById(db, auth.project.id, policyId)
    if (!existing) return errorResponse(c, 404, 'not_found', 'Policy not found')
    await db.delete(policies).where(eq(policies.id, existing.id))
    await recordAudit(db, {
      auth,
      action: 'policy.delete',
      resourceType: 'policy',
      resourceId: existing.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializePolicy(existing),
    })
    return c.body(null, 204)
  })

export default routes
