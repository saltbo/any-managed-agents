import { createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { budgets } from '../db/schema'
import { errorResponse } from '../errors'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema, listResponseSchema } from '../openapi'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())

const BudgetSchema = z
  .object({
    id: z.string(),
    scope: z.enum(['project', 'provider', 'model']),
    providerId: z.string().nullable(),
    modelId: z.string().nullable(),
    limitType: z.enum(['tokens', 'cost_micros', 'sessions']),
    limitValue: z.number().int(),
    window: z.enum(['day', 'month']),
    enabled: z.boolean(),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Budget')

const CreateBudgetSchema = z
  .object({
    scope: z.enum(['project', 'provider', 'model']).openapi({ example: 'project' }),
    providerId: z.string().min(1).optional().openapi({ example: 'workers-ai' }),
    modelId: z.string().min(1).optional().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    limitType: z.enum(['tokens', 'cost_micros', 'sessions']).openapi({ example: 'tokens' }),
    limitValue: z.number().int().positive().openapi({ example: 1000000 }),
    window: z.enum(['day', 'month']).openapi({ example: 'month' }),
    enabled: z.boolean().optional().openapi({ example: true }),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreateBudgetRequest')

const UpdateBudgetSchema = z
  .object({
    limitValue: z.number().int().positive().optional(),
    window: z.enum(['day', 'month']).optional(),
    enabled: z.boolean().optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('UpdateBudgetRequest')

const BudgetListResponseSchema = listResponseSchema('BudgetListResponse', BudgetSchema)

const BudgetParamsSchema = z.object({
  budgetId: z.string().openapi({ param: { name: 'budgetId', in: 'path' }, example: 'budget_abc123' }),
})

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

function serializeBudget(row: BudgetRow) {
  return {
    id: row.id,
    scope: row.scope as 'project' | 'provider' | 'model',
    providerId: row.providerId,
    modelId: row.modelId,
    limitType: row.limitType as 'tokens' | 'cost_micros' | 'sessions',
    limitValue: row.limitValue,
    window: row.window as 'day' | 'month',
    enabled: row.enabled,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function budgetById(db: ReturnType<typeof drizzle>, projectId: string, budgetId: string) {
  return (
    (await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, budgetId), eq(budgets.projectId, projectId)))
      .get()) ?? null
  )
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
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
  path: '/',
  operationId: 'createBudget',
  tags: ['Governance'],
  summary: 'Create a budget',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateBudgetSchema } } } },
  responses: {
    201: { description: 'Created budget', content: { 'application/json': { schema: BudgetSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{budgetId}',
  operationId: 'readBudget',
  tags: ['Governance'],
  summary: 'Read a budget',
  ...AuthenticatedOperation,
  request: { params: BudgetParamsSchema },
  responses: {
    200: { description: 'Budget', content: { 'application/json': { schema: BudgetSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Budget not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{budgetId}',
  operationId: 'updateBudget',
  tags: ['Governance'],
  summary: 'Update a budget',
  ...AuthenticatedOperation,
  request: {
    params: BudgetParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateBudgetSchema } } },
  },
  responses: {
    200: { description: 'Updated budget', content: { 'application/json': { schema: BudgetSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Budget not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{budgetId}',
  operationId: 'deleteBudget',
  tags: ['Governance'],
  summary: 'Delete a budget',
  ...AuthenticatedOperation,
  request: { params: BudgetParamsSchema },
  responses: {
    204: { description: 'Budget deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Budget not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const rows = await db.select().from(budgets).where(eq(budgets.projectId, auth.project.id))
    return c.json(
      {
        data: rows.map(serializeBudget),
        pagination: { limit: rows.length, nextCursor: null, hasMore: false },
      },
      200,
    )
  })
  .openapi(createBudgetRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const fields: Record<string, string> = {}
    if (body.scope === 'provider' && !body.providerId) {
      fields.providerId = 'Provider-scoped budgets require providerId.'
    }
    if (body.scope === 'model' && !body.modelId) {
      fields.modelId = 'Model-scoped budgets require modelId.'
    }
    if (Object.keys(fields).length > 0) {
      return errorResponse(c, 400, 'validation_error', 'Budget is invalid', { fields })
    }
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
      enabled: body.enabled ?? true,
      metadata: JSON.stringify(body.metadata ?? {}),
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
  .openapi(readRoute, async (c) => {
    const { budgetId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const row = await budgetById(db, auth.project.id, budgetId)
    if (!row) return errorResponse(c, 404, 'not_found', 'Budget not found')
    return c.json(serializeBudget(row), 200)
  })
  .openapi(updateRoute, async (c) => {
    const { budgetId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await budgetById(db, auth.project.id, budgetId)
    if (!existing) return errorResponse(c, 404, 'not_found', 'Budget not found')
    const row = {
      ...existing,
      limitValue: body.limitValue ?? existing.limitValue,
      window: body.window ?? existing.window,
      enabled: body.enabled ?? existing.enabled,
      metadata: body.metadata === undefined ? existing.metadata : JSON.stringify(body.metadata),
      updatedAt: now(),
    }
    await db.update(budgets).set(row).where(eq(budgets.id, existing.id))
    await recordAudit(db, {
      auth,
      action: 'budget.update',
      resourceType: 'budget',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeBudget(existing),
      after: serializeBudget(row),
    })
    return c.json(serializeBudget(row), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const { budgetId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const existing = await budgetById(db, auth.project.id, budgetId)
    if (!existing) return errorResponse(c, 404, 'not_found', 'Budget not found')
    await db.delete(budgets).where(eq(budgets.id, existing.id))
    await recordAudit(db, {
      auth,
      action: 'budget.delete',
      resourceType: 'budget',
      resourceId: existing.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeBudget(existing),
    })
    return c.body(null, 204)
  })

export default routes
