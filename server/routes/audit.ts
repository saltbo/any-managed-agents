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
  csvResponse,
  ErrorResponseSchema,
  listResponseSchema,
  negotiateMediaType,
  paginateRows,
  parseListCursor,
} from '../openapi'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())

const AuditRecordSchema = z
  .object({
    id: z.string(),
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
    .openapi({ param: { name: 'action', in: 'query' }, example: 'policy.evaluate' }),
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
    .openapi({ param: { name: 'outcome', in: 'query' }, example: 'denied' }),
  from: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'from', in: 'query' } }),
  to: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'to', in: 'query' } }),
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

const AuditRecordParamsSchema = z.object({
  recordId: z.string().openapi({ param: { name: 'recordId', in: 'path' }, example: 'audit_abc123' }),
})

type AuditRow = typeof auditRecords.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function redactedJson(value: string) {
  return redactSecrets(parseJson<Record<string, unknown>>(value, {})) as Record<string, unknown>
}

function serializeAudit(row: AuditRow) {
  return {
    id: row.id,
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
    metadata: redactedJson(row.metadata),
    before: redactedJson(row.before),
    after: redactedJson(row.after),
    createdAt: row.createdAt,
  }
}

function filters(query: z.infer<typeof QuerySchema>, organizationId: string) {
  const parsedCursor = query.cursor ? parseListCursor(query.cursor) : null
  return [
    eq(auditRecords.organizationId, organizationId),
    query.actorId ? eq(auditRecords.actorUserId, query.actorId) : undefined,
    query.projectId ? eq(auditRecords.projectId, query.projectId) : undefined,
    query.action ? like(auditRecords.action, `%${query.action}%`) : undefined,
    query.resourceType ? eq(auditRecords.resourceType, query.resourceType) : undefined,
    query.resourceId ? eq(auditRecords.resourceId, query.resourceId) : undefined,
    query.outcome ? eq(auditRecords.outcome, query.outcome) : undefined,
    query.from ? gte(auditRecords.createdAt, query.from) : undefined,
    query.to ? lte(auditRecords.createdAt, query.to) : undefined,
    parsedCursor
      ? or(
          lt(auditRecords.createdAt, parsedCursor.createdAt),
          and(eq(auditRecords.createdAt, parsedCursor.createdAt), lt(auditRecords.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
}

const CSV_HEADER = [
  'id',
  'createdAt',
  'projectId',
  'actorType',
  'actorUserId',
  'action',
  'resourceType',
  'resourceId',
  'outcome',
  'requestId',
  'correlationId',
  'sessionId',
  'policyCategory',
  'metadata',
  'before',
  'after',
]

function csvRow(row: AuditRow) {
  const item = serializeAudit(row)
  return [
    item.id,
    item.createdAt,
    item.projectId ?? '',
    item.actorType,
    item.actorUserId ?? '',
    item.action,
    item.resourceType,
    item.resourceId ?? '',
    item.outcome,
    item.requestId ?? '',
    item.correlationId ?? '',
    item.sessionId ?? '',
    item.policyCategory ?? '',
    JSON.stringify(item.metadata),
    JSON.stringify(item.before),
    JSON.stringify(item.after),
  ]
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAuditRecords',
  tags: ['Audit'],
  summary: 'List audit records',
  description: 'Lists audit records for the organization. Send Accept: text/csv to export the filtered records as CSV.',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: {
      description: 'Audit records',
      content: {
        'application/json': { schema: AuditListResponseSchema },
        'text/csv': { schema: z.string().openapi({ example: 'id,createdAt,action,outcome' }) },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{recordId}',
  operationId: 'readAuditRecord',
  tags: ['Audit'],
  summary: 'Read an audit record',
  ...AuthenticatedOperation,
  request: { params: AuditRecordParamsSchema },
  responses: {
    200: { description: 'Audit record', content: { 'application/json': { schema: AuditRecordSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Audit record not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listRoute, async (c) => {
    const query = c.req.valid('query')
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
    if (negotiateMediaType(c, ['text/csv']) === 'text/csv') {
      const rows = await db
        .select()
        .from(auditRecords)
        .where(where)
        .orderBy(desc(auditRecords.createdAt), desc(auditRecords.id))
      return csvResponse(c, 'audit-records.csv', CSV_HEADER, rows.map(csvRow))
    }
    const rows = await db
      .select()
      .from(auditRecords)
      .where(where)
      .orderBy(desc(auditRecords.createdAt), desc(auditRecords.id))
      .limit((query.limit ?? 50) + 1)
    const page = paginateRows(rows, query.limit ?? 50)
    return c.json({ data: page.data.map(serializeAudit), pagination: page.pagination }, 200)
  })
  .openapi(readRoute, async (c) => {
    const { recordId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const row = await db
      .select()
      .from(auditRecords)
      .where(and(eq(auditRecords.id, recordId), eq(auditRecords.organizationId, auth.organization.id)))
      .get()
    if (!row) return errorResponse(c, 404, 'not_found', 'Audit record not found')
    return c.json(serializeAudit(row), 200)
  })

export default routes
