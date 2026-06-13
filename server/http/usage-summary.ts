import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { summarizeUsage, USAGE_GROUP_BY_VALUES } from '@server/domain/usage'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema } from '../openapi'

type UsageSummaryRoutes = OpenAPIHono<DepsEnv>

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
    groupBy: z.enum(USAGE_GROUP_BY_VALUES),
    totals: UsageSummaryTotalsSchema,
    groups: z.array(UsageSummaryGroupSchema),
  })
  .openapi('UsageSummary')

const QuerySchema = z.object({
  groupBy: z
    .enum(USAGE_GROUP_BY_VALUES)
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

// The grouping/totals fold is pure domain (summarizeUsage); the route only
// resolves auth, fetches the measurement rows, and serializes the result.
// Registration order is load-bearing; the assembler in app.ts calls this at the
// usage-summary resource's original mount position.
export function registerUsageSummaryRoutes(routes: UsageSummaryRoutes) {
  return routes.openapi(readRoute, async (c) => {
    const query = c.req.valid('query')
    const deps = c.get('deps')
    const auth = await requireAuth(c, drizzle(c.env.DB))
    if (auth instanceof Response) {
      return auth
    }
    const rows = await deps.usageRecords.summaryRows({
      projectId: auth.project.id,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    })
    return c.json(summarizeUsage(rows, query.groupBy ?? 'provider'), 200)
  })
}
