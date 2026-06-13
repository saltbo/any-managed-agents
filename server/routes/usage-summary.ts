import { createRoute, z } from '@hono/zod-openapi'
import { and, eq, gte, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { usageRecords } from '../db/schema'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema } from '../openapi'

const app = createApiRouter()

const GROUP_BY_VALUES = ['provider', 'model', 'agent'] as const
type GroupBy = (typeof GROUP_BY_VALUES)[number]

const UsageSummaryTotalsSchema = z
  .object({
    records: z.number().int(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
    durationMs: z.number().int(),
    costMicros: z.number().int(),
    currency: z.string().openapi({ example: 'USD' }),
  })
  .openapi('UsageSummaryTotals')

const UsageSummaryGroupSchema = UsageSummaryTotalsSchema.extend({
  key: z.record(z.string(), z.string().nullable()).openapi({ example: { provider: 'workers-ai' } }),
}).openapi('UsageSummaryGroup')

const UsageSummarySchema = z
  .object({
    groupBy: z.enum(GROUP_BY_VALUES),
    totals: UsageSummaryTotalsSchema,
    groups: z.array(UsageSummaryGroupSchema),
  })
  .openapi('UsageSummary')

const QuerySchema = z.object({
  groupBy: z
    .enum(GROUP_BY_VALUES)
    .optional()
    .openapi({ param: { name: 'groupBy', in: 'query' }, example: 'provider' }),
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
})

type UsageRow = typeof usageRecords.$inferSelect
type Totals = z.infer<typeof UsageSummaryTotalsSchema>
type Group = z.infer<typeof UsageSummaryGroupSchema>

function emptyTotals(): Totals {
  return {
    records: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    costMicros: 0,
    currency: 'USD',
  }
}

function accumulate(target: Totals, row: UsageRow) {
  target.records += 1
  target.promptTokens += row.promptTokens
  target.completionTokens += row.completionTokens
  target.totalTokens += row.totalTokens
  target.durationMs += row.durationMs
  target.costMicros += row.costMicros
  target.currency = row.currency
}

function groupKeyValue(groupBy: GroupBy, row: UsageRow) {
  switch (groupBy) {
    case 'provider':
      return row.providerId ?? row.providerType
    case 'model':
      return row.modelId
    case 'agent':
      return row.agentId
  }
}

function summarize(rows: UsageRow[], groupBy: GroupBy) {
  const totals = emptyTotals()
  const groups = new Map<string, Group>()
  for (const row of rows) {
    accumulate(totals, row)
    const value = groupKeyValue(groupBy, row)
    const keyString = JSON.stringify(value)
    const group = groups.get(keyString) ?? { key: { [groupBy]: value }, ...emptyTotals() }
    accumulate(group, row)
    groups.set(keyString, group)
  }
  return {
    groupBy,
    totals,
    groups: [...groups.values()].sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key))),
  }
}

const readRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'readUsageSummary',
  tags: ['Usage'],
  summary: 'Read aggregated usage',
  description: 'Read-only aggregation of usage records grouped by provider, model, or agent.',
  ...AuthenticatedOperation,
  request: { query: QuerySchema },
  responses: {
    200: { description: 'Usage summary', content: { 'application/json': { schema: UsageSummarySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app.openapi(readRoute, async (c) => {
  const query = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const where = and(
    ...[
      eq(usageRecords.projectId, auth.project.id),
      query.from ? gte(usageRecords.createdAt, query.from) : undefined,
      query.to ? lte(usageRecords.createdAt, query.to) : undefined,
    ].filter((filter) => filter !== undefined),
  )
  const rows = await db.select().from(usageRecords).where(where)
  return c.json(summarize(rows, query.groupBy ?? 'provider'), 200)
})

export default routes
