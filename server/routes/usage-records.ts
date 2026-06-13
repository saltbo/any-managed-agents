import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { usageRecords } from '../db/schema'
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

const UsageRecordSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    agentId: z.string().nullable(),
    agentVersionId: z.string().nullable(),
    sessionId: z.string().nullable(),
    sessionEventId: z.string().nullable(),
    correlationId: z.string().nullable(),
    providerId: z.string().nullable(),
    providerType: z.string(),
    modelId: z.string(),
    status: z.string(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
    durationMs: z.number().int(),
    costMicros: z.number().int(),
    currency: z.string(),
    usageType: z.string(),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('UsageRecord')

const QuerySchema = z.object({
  from: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'from', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  to: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'to', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
  providerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'providerId', in: 'query' }, example: 'workers-ai' }),
  modelId: z
    .string()
    .optional()
    .openapi({ param: { name: 'modelId', in: 'query' }, example: '@cf/moonshotai/kimi-k2.6' }),
  agentId: z
    .string()
    .optional()
    .openapi({ param: { name: 'agentId', in: 'query' }, example: 'agent_abc123' }),
  sessionId: z
    .string()
    .optional()
    .openapi({ param: { name: 'sessionId', in: 'query' }, example: 'session_abc123' }),
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

const UsageRecordListResponseSchema = listResponseSchema('UsageRecordListResponse', UsageRecordSchema)

const UsageRecordParamsSchema = z.object({
  recordId: z.string().openapi({ param: { name: 'recordId', in: 'path' }, example: 'usage_abc123' }),
})

type UsageRow = typeof usageRecords.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function serializeUsage(row: UsageRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    agentVersionId: row.agentVersionId,
    sessionId: row.sessionId,
    sessionEventId: row.sessionEventId,
    correlationId: row.correlationId,
    providerId: row.providerId,
    providerType: row.providerType,
    modelId: row.modelId,
    status: row.status,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    durationMs: row.durationMs,
    costMicros: row.costMicros,
    currency: row.currency,
    usageType: row.usageType,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
  }
}

function filters(query: z.infer<typeof QuerySchema>, projectId: string) {
  const parsedCursor = query.cursor ? parseListCursor(query.cursor) : null
  return [
    eq(usageRecords.projectId, projectId),
    // providerId matches the configured provider id or the provider type so
    // platform records (providerType only) stay addressable.
    query.providerId
      ? or(eq(usageRecords.providerId, query.providerId), eq(usageRecords.providerType, query.providerId))
      : undefined,
    query.modelId ? eq(usageRecords.modelId, query.modelId) : undefined,
    query.agentId ? eq(usageRecords.agentId, query.agentId) : undefined,
    query.sessionId ? eq(usageRecords.sessionId, query.sessionId) : undefined,
    query.from ? gte(usageRecords.createdAt, query.from) : undefined,
    query.to ? lte(usageRecords.createdAt, query.to) : undefined,
    parsedCursor
      ? or(
          lt(usageRecords.createdAt, parsedCursor.createdAt),
          and(eq(usageRecords.createdAt, parsedCursor.createdAt), lt(usageRecords.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
}

const CSV_HEADER = [
  'id',
  'createdAt',
  'projectId',
  'agentId',
  'agentVersionId',
  'sessionId',
  'providerId',
  'providerType',
  'modelId',
  'status',
  'usageType',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'durationMs',
  'costMicros',
  'currency',
]

function csvRow(row: UsageRow) {
  return [
    row.id,
    row.createdAt,
    row.projectId,
    row.agentId ?? '',
    row.agentVersionId ?? '',
    row.sessionId ?? '',
    row.providerId ?? '',
    row.providerType,
    row.modelId,
    row.status,
    row.usageType,
    String(row.promptTokens),
    String(row.completionTokens),
    String(row.totalTokens),
    String(row.durationMs),
    String(row.costMicros),
    row.currency,
  ]
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listUsageRecords',
  tags: ['Usage'],
  summary: 'List usage records',
  description: 'Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: {
      description: 'Usage records',
      content: {
        'application/json': { schema: UsageRecordListResponseSchema },
        'text/csv': { schema: z.string().openapi({ example: 'id,createdAt,providerId,modelId,totalTokens' }) },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{recordId}',
  operationId: 'readUsageRecord',
  tags: ['Usage'],
  summary: 'Read a usage record',
  ...AuthenticatedOperation,
  request: { params: UsageRecordParamsSchema },
  responses: {
    200: { description: 'Usage record', content: { 'application/json': { schema: UsageRecordSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Usage record not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
      where = and(...filters(query, auth.project.id))
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    if (negotiateMediaType(c, ['text/csv']) === 'text/csv') {
      const rows = await db
        .select()
        .from(usageRecords)
        .where(where)
        .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
      return csvResponse(c, 'usage-records.csv', CSV_HEADER, rows.map(csvRow))
    }
    const rows = await db
      .select()
      .from(usageRecords)
      .where(where)
      .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
      .limit((query.limit ?? 50) + 1)
    const page = paginateRows(rows, query.limit ?? 50)
    return c.json({ data: page.data.map(serializeUsage), pagination: page.pagination }, 200)
  })
  .openapi(readRoute, async (c) => {
    const { recordId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const row = await db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.id, recordId), eq(usageRecords.projectId, auth.project.id)))
      .get()
    if (!row) return errorResponse(c, 404, 'not_found', 'Usage record not found')
    return c.json(serializeUsage(row), 200)
  })

export default routes
