import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { leases, workItems } from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import { safeRuntimeError } from '../runtime/runtime-error'
import { resolveRuntimeSecretEnv } from '../runtime/secret-env'
import { expireStaleLeases } from './leases'
import {
  type Db,
  findRunner,
  JsonObjectSchema,
  now,
  parseJson,
  parseRawJson,
  runnerOperationAuthorized,
} from './runners'

const app = createApiRouter()

export const WORK_ITEM_STATES = ['available', 'leased', 'succeeded', 'failed', 'cancelled'] as const

type WorkItemRow = typeof workItems.$inferSelect

const WorkItemSchema = z
  .object({
    id: z.string().openapi({ example: 'work_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    sessionId: z.string().nullable().openapi({ example: 'session_abc123' }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    runnerId: z.string().nullable().openapi({ example: 'runner_abc123' }),
    leaseId: z.string().nullable().openapi({ example: 'lease_abc123' }),
    type: z.string().openapi({ example: 'session.start' }),
    state: z.enum(WORK_ITEM_STATES).openapi({ example: 'available' }),
    priority: z.number().int().openapi({ example: 0 }),
    attempts: z.number().int().openapi({ example: 1 }),
    maxAttempts: z.number().int().openapi({ example: 3 }),
    payload: JsonObjectSchema,
    result: JsonObjectSchema.nullable(),
    error: JsonObjectSchema.nullable(),
    availableAt: z.string().datetime(),
    leaseExpiresAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('WorkItem')

const WorkItemParamsSchema = z.object({
  workItemId: z.string().openapi({ param: { name: 'workItemId', in: 'path' }, example: 'work_abc123' }),
})

const WorkItemListQuerySchema = z.object({
  state: z
    .enum(WORK_ITEM_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'available' }),
  sessionId: z
    .string()
    .optional()
    .openapi({ param: { name: 'sessionId', in: 'query' }, example: 'session_abc123' }),
  runnerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'runnerId', in: 'query' }, example: 'runner_abc123' }),
  search: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .openapi({ param: { name: 'search', in: 'query' }, example: 'session.start' }),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdFrom', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdTo', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})

const WorkItemListResponseSchema = listResponseSchema('WorkItemListResponse', WorkItemSchema)

export function serializeWorkItem(row: WorkItemRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    environmentId: row.environmentId,
    runnerId: row.runnerId,
    leaseId: row.leaseId,
    type: row.type,
    state: row.state as (typeof WORK_ITEM_STATES)[number],
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    result: parseJson<Record<string, unknown>>(row.result),
    error: parseJson<Record<string, unknown>>(row.error),
    availableAt: row.availableAt,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// The runner that holds the active lease receives the raw payload with vault
// secret env resolved into runtimeEnv. Everyone else gets the redacted view.
async function materializeWorkItemPayload(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  workItem: WorkItemRow,
) {
  const payload = parseRawJson<Record<string, unknown>>(workItem.payload) ?? {}
  if (payload.type !== 'session.start') {
    return payload
  }
  const runtimeSecretEnv = Array.isArray(payload.runtimeSecretEnv) ? payload.runtimeSecretEnv : []
  if (runtimeSecretEnv.length === 0) {
    return payload
  }
  const runtimeEnv =
    payload.runtimeEnv && typeof payload.runtimeEnv === 'object' && !Array.isArray(payload.runtimeEnv)
      ? { ...(payload.runtimeEnv as Record<string, string>) }
      : {}
  const resolved = await resolveRuntimeSecretEnv(env, db, scope, runtimeSecretEnv)
  return { ...payload, runtimeEnv: { ...runtimeEnv, ...resolved } }
}

const listWorkItemsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listWorkItems',
  tags: ['Work items'],
  summary: 'List queued self-hosted work items',
  ...AuthenticatedOperation,
  request: { query: WorkItemListQuerySchema },
  responses: {
    200: { description: 'Work item list', content: { 'application/json': { schema: WorkItemListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readWorkItemRoute = createRoute({
  method: 'get',
  path: '/{workItemId}',
  operationId: 'readWorkItem',
  tags: ['Work items'],
  summary: 'Read a queued self-hosted work item',
  ...AuthenticatedOperation,
  request: { params: WorkItemParamsSchema },
  responses: {
    200: { description: 'Work item', content: { 'application/json': { schema: WorkItemSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Work item not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listWorkItemsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await expireStaleLeases(db, auth)
    const { state, sessionId, runnerId, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(workItems.projectId, auth.project.id),
      state ? eq(workItems.state, state) : undefined,
      sessionId ? eq(workItems.sessionId, sessionId) : undefined,
      runnerId ? eq(workItems.runnerId, runnerId) : undefined,
      search ? like(workItems.type, `%${search}%`) : undefined,
      createdFrom ? gte(workItems.createdAt, createdFrom) : undefined,
      createdTo ? lte(workItems.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(workItems.createdAt, parsedCursor.createdAt),
            and(eq(workItems.createdAt, parsedCursor.createdAt), lt(workItems.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(workItems)
      .where(and(...filters))
      .orderBy(desc(workItems.createdAt), desc(workItems.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeWorkItem), pagination: page.pagination }, 200)
  })
  .openapi(readWorkItemRoute, async (c) => {
    const { workItemId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const workItem = await db
      .select()
      .from(workItems)
      .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, auth.project.id)))
      .get()
    if (!workItem) {
      return errorResponse(c, 404, 'not_found', 'Work item not found')
    }
    if (workItem.state === 'leased' && workItem.runnerId && workItem.leaseId) {
      const lease = await db
        .select({ id: leases.id, state: leases.state, expiresAt: leases.expiresAt })
        .from(leases)
        .where(and(eq(leases.id, workItem.leaseId), eq(leases.projectId, auth.project.id)))
        .get()
      const runner =
        lease && lease.state === 'active' && lease.expiresAt > now()
          ? await findRunner(db, auth, workItem.runnerId)
          : null
      if (runner && runnerOperationAuthorized(c.env, auth, runner)) {
        try {
          const payload = await materializeWorkItemPayload(
            c.env,
            db,
            { organizationId: auth.organization.id, projectId: auth.project.id },
            workItem,
          )
          return c.json({ ...serializeWorkItem(workItem), payload }, 200)
        } catch (error) {
          return errorResponse(c, 409, 'conflict', safeRuntimeError(error).message)
        }
      }
    }
    return c.json(serializeWorkItem(workItem), 200)
  })

export default routes
