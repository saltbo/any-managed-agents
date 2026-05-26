import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { redactSecrets } from '../audit'
import { requireAuth } from '../auth/session'
import { auditRecords } from '../db/schema'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())
const AuditRecordSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    projectId: z.string().nullable(),
    actorUserId: z.string().nullable(),
    actorType: z.string(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    outcome: z.string(),
    requestId: z.string().nullable(),
    correlationId: z.string().nullable(),
    sessionId: z.string().nullable(),
    policyCategory: z.string().nullable(),
    metadata: JsonObjectSchema,
    before: JsonObjectSchema,
    after: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('AuditRecord')

const QuerySchema = z.object({
  actorId: z
    .string()
    .optional()
    .openapi({ param: { name: 'actorId', in: 'query' } }),
  projectId: z
    .string()
    .optional()
    .openapi({ param: { name: 'projectId', in: 'query' } }),
  action: z
    .string()
    .optional()
    .openapi({ param: { name: 'action', in: 'query' } }),
  resourceType: z
    .string()
    .optional()
    .openapi({ param: { name: 'resourceType', in: 'query' } }),
  resourceId: z
    .string()
    .optional()
    .openapi({ param: { name: 'resourceId', in: 'query' } }),
  outcome: z
    .string()
    .optional()
    .openapi({ param: { name: 'outcome', in: 'query' } }),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdFrom', in: 'query' } }),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdTo', in: 'query' } }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})
const AuditListResponseSchema = listResponseSchema('AuditRecordListResponse', AuditRecordSchema)

type AuditRow = typeof auditRecords.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function serializeAudit(row: AuditRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome,
    requestId: row.requestId,
    correlationId: row.correlationId,
    sessionId: row.sessionId,
    policyCategory: row.policyCategory,
    metadata: redactSecrets(parseJson<Record<string, unknown>>(row.metadata, {})) as Record<string, unknown>,
    before: redactSecrets(parseJson<Record<string, unknown>>(row.before, {})) as Record<string, unknown>,
    after: redactSecrets(parseJson<Record<string, unknown>>(row.after, {})) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

function filters(query: z.infer<typeof QuerySchema>, organizationId: string) {
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  if (query.cursor) parsedCursor = parseListCursor(query.cursor)
  return [
    eq(auditRecords.organizationId, organizationId),
    query.actorId ? eq(auditRecords.actorUserId, query.actorId) : undefined,
    query.projectId ? eq(auditRecords.projectId, query.projectId) : undefined,
    query.action ? like(auditRecords.action, `%${query.action}%`) : undefined,
    query.resourceType ? eq(auditRecords.resourceType, query.resourceType) : undefined,
    query.resourceId ? eq(auditRecords.resourceId, query.resourceId) : undefined,
    query.outcome ? eq(auditRecords.outcome, query.outcome) : undefined,
    query.createdFrom ? gte(auditRecords.createdAt, query.createdFrom) : undefined,
    query.createdTo ? lte(auditRecords.createdAt, query.createdTo) : undefined,
    parsedCursor
      ? or(
          lt(auditRecords.createdAt, parsedCursor.createdAt),
          and(eq(auditRecords.createdAt, parsedCursor.createdAt), lt(auditRecords.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAuditRecords',
  tags: ['Audit'],
  summary: 'List audit records',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: { description: 'Audit records', content: { 'application/json': { schema: AuditListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const exportRoute = createRoute({
  method: 'get',
  path: '/export',
  operationId: 'exportAuditRecords',
  tags: ['Audit'],
  summary: 'Export audit records',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: { description: 'Audit export', content: { 'application/json': { schema: z.array(AuditRecordSchema) } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

async function readRows(c: Parameters<Parameters<typeof app.openapi>[1]>[0], query: z.infer<typeof QuerySchema>) {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  let where: ReturnType<typeof and>
  try {
    where = and(...filters(query, auth.organization.id))
  } catch {
    return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
      fields: { cursor: 'Cursor is invalid.' },
    })
  }
  return await db
    .select()
    .from(auditRecords)
    .where(where)
    .orderBy(desc(auditRecords.createdAt), desc(auditRecords.id))
    .limit((query.limit ?? 50) + 1)
}

const routes = app
  .openapi(listRoute, async (c) => {
    const query = c.req.valid('query')
    const rows = await readRows(c, query)
    if (rows instanceof Response) return rows
    const page = paginateRows(rows, query.limit ?? 50)
    return c.json({ data: page.data.map(serializeAudit), pagination: page.pagination }, 200)
  })
  .openapi(exportRoute, async (c) => {
    const query = c.req.valid('query')
    const rows = await readRows(c, { ...query, limit: 100 })
    if (rows instanceof Response) return rows
    return c.json(rows.slice(0, query.limit ?? 100).map(serializeAudit), 200)
  })

export default routes
