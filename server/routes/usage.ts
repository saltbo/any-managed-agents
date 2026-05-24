import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { usageRecords } from '../db/schema'
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

const UsageRecordSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
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

const UsageSummaryGroupSchema = z
  .object({
    key: JsonObjectSchema,
    records: z.number().int(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
    durationMs: z.number().int(),
    costMicros: z.number().int(),
    currency: z.string(),
  })
  .openapi('UsageSummaryGroup')

const UsageSummarySchema = z
  .object({
    totals: UsageSummaryGroupSchema,
    groups: z.array(UsageSummaryGroupSchema),
  })
  .openapi('UsageSummary')

const QuerySchema = z.object({
  provider: z
    .string()
    .optional()
    .openapi({ param: { name: 'provider', in: 'query' }, example: 'workers-ai' }),
  model: z
    .string()
    .optional()
    .openapi({ param: { name: 'model', in: 'query' }, example: '@cf/moonshotai/kimi-k2.6' }),
  agentId: z
    .string()
    .optional()
    .openapi({ param: { name: 'agentId', in: 'query' }, example: 'agent_abc123' }),
  sessionId: z
    .string()
    .optional()
    .openapi({ param: { name: 'sessionId', in: 'query' }, example: 'session_abc123' }),
  status: z
    .string()
    .optional()
    .openapi({ param: { name: 'status', in: 'query' }, example: 'success' }),
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
  groupBy: z
    .string()
    .optional()
    .openapi({ param: { name: 'groupBy', in: 'query' }, example: 'provider,model,session' }),
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
const UsageListResponseSchema = listResponseSchema('UsageRecordListResponse', UsageRecordSchema)

type UsageRow = typeof usageRecords.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function serializeUsage(row: UsageRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
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
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  if (query.cursor) parsedCursor = parseListCursor(query.cursor)
  return [
    eq(usageRecords.projectId, projectId),
    query.provider ? eq(usageRecords.providerType, query.provider) : undefined,
    query.model ? eq(usageRecords.modelId, query.model) : undefined,
    query.agentId ? eq(usageRecords.agentId, query.agentId) : undefined,
    query.sessionId ? eq(usageRecords.sessionId, query.sessionId) : undefined,
    query.status ? eq(usageRecords.status, query.status) : undefined,
    query.createdFrom ? gte(usageRecords.createdAt, query.createdFrom) : undefined,
    query.createdTo ? lte(usageRecords.createdAt, query.createdTo) : undefined,
    parsedCursor
      ? or(
          lt(usageRecords.createdAt, parsedCursor.createdAt),
          and(eq(usageRecords.createdAt, parsedCursor.createdAt), lt(usageRecords.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listUsageRecords',
  tags: ['Usage'],
  summary: 'List usage records',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: { description: 'Usage records', content: { 'application/json': { schema: UsageListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const summaryRoute = createRoute({
  method: 'get',
  path: '/summary',
  operationId: 'readUsageSummary',
  tags: ['Usage'],
  summary: 'Read usage summary',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: { description: 'Usage summary', content: { 'application/json': { schema: UsageSummarySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

app.openapi(listRoute, async (c) => {
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
  const rows = await db
    .select()
    .from(usageRecords)
    .where(where)
    .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
    .limit((query.limit ?? 50) + 1)
  const page = paginateRows(rows, query.limit ?? 50)
  return c.json({ data: page.data.map(serializeUsage), pagination: page.pagination }, 200)
})

app.openapi(summaryRoute, async (c) => {
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
  const rows = await db.select().from(usageRecords).where(where)
  const groupedFields = (query.groupBy ?? 'organization,project,provider,model,agent,session')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
  const groups = new Map<string, z.infer<typeof UsageSummaryGroupSchema>>()
  const totals: z.infer<typeof UsageSummaryGroupSchema> = {
    key: {},
    records: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    costMicros: 0,
    currency: 'USD',
  }
  for (const row of rows) {
    const item = serializeUsage(row)
    const key = Object.fromEntries(
      groupedFields.map((field) => [
        field,
        field === 'organization'
          ? item.organizationId
          : field === 'project'
            ? item.projectId
            : field === 'provider'
              ? item.providerType
              : field === 'model'
                ? item.modelId
                : field === 'agent'
                  ? item.agentId
                  : field === 'session'
                    ? item.sessionId
                    : field === 'status'
                      ? item.status
                      : null,
      ]),
    )
    const keyString = JSON.stringify(key)
    const group =
      groups.get(keyString) ??
      ({
        key,
        records: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        costMicros: 0,
        currency: item.currency,
      } satisfies z.infer<typeof UsageSummaryGroupSchema>)
    for (const target of [group, totals]) {
      target.records += 1
      target.promptTokens += item.promptTokens
      target.completionTokens += item.completionTokens
      target.totalTokens += item.totalTokens
      target.durationMs += item.durationMs
      target.costMicros += item.costMicros
      target.currency = item.currency
    }
    groups.set(keyString, group)
  }
  return c.json(
    { totals, groups: [...groups.values()].sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key))) },
    200,
  )
})

export default app
