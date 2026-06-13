import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { CONNECTOR_APPROVAL_MODES, CONNECTOR_AVAILABILITIES } from '@server/domain/connector'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import type { ConnectorRecord } from '../usecases/ports'

type ConnectorRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

export const ConnectorToolSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    inputSchema: JsonObjectSchema,
    approvalMode: z.enum(CONNECTOR_APPROVAL_MODES),
    policyMetadata: JsonObjectSchema,
  })
  .openapi('ConnectorTool')

const ConnectorSchema = z
  .object({
    // The connector slug (e.g. "github") is the id.
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    trustLevel: z.string(),
    capabilities: z.array(z.string()),
    supportedAuthModes: z.array(z.string()),
    setupRequirements: z.array(z.string()),
    tools: z.array(ConnectorToolSchema),
    metadata: JsonObjectSchema,
    availability: z.enum(CONNECTOR_AVAILABILITIES),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Connector')

const ConnectorParamsSchema = z.object({
  connectorId: z.string().openapi({ param: { name: 'connectorId', in: 'path' }, example: 'github' }),
})

const ConnectorListQuerySchema = z.object({
  search: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .openapi({ param: { name: 'search', in: 'query' } }),
  category: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .openapi({ param: { name: 'category', in: 'query' } }),
  trustLevel: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .openapi({ param: { name: 'trustLevel', in: 'query' } }),
  capability: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .openapi({ param: { name: 'capability', in: 'query' } }),
  availability: z
    .enum(CONNECTOR_AVAILABILITIES)
    .optional()
    .openapi({ param: { name: 'availability', in: 'query' } }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' } }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})

const ConnectorListResponseSchema = listResponseSchema('ConnectorListResponse', ConnectorSchema)

function validation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

function serializeConnector(record: ConnectorRecord) {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    category: record.category,
    trustLevel: record.trustLevel,
    capabilities: record.capabilities,
    supportedAuthModes: record.supportedAuthModes,
    setupRequirements: record.setupRequirements,
    tools: record.tools,
    metadata: record.metadata,
    availability: record.availability,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listConnectorsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listConnectors',
  tags: ['Connectors'],
  summary: 'List connectors',
  ...AuthenticatedOperation,
  request: { query: ConnectorListQuerySchema },
  responses: {
    200: {
      description: 'Connector list',
      content: { 'application/json': { schema: ConnectorListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readConnectorRoute = createRoute({
  method: 'get',
  path: '/{connectorId}',
  operationId: 'readConnector',
  tags: ['Connectors'],
  summary: 'Read connector',
  ...AuthenticatedOperation,
  request: { params: ConnectorParamsSchema },
  responses: {
    200: { description: 'Connector', content: { 'application/json': { schema: ConnectorSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Connector not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the connectors resource's original mount position.
export function registerConnectorRoutes(routes: ConnectorRoutes) {
  return routes
    .openapi(listConnectorsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await deps.connectors.seedCatalog()
      const { search, category, trustLevel, capability, availability, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.connectors.list({
        ...(search ? { search } : {}),
        ...(category ? { category } : {}),
        ...(trustLevel ? { trustLevel } : {}),
        ...(capability ? { capability } : {}),
        ...(availability ? { availability } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeConnector), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readConnectorRoute, async (c) => {
      const { connectorId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await deps.connectors.seedCatalog()
      const connector = await deps.connectors.find(connectorId)
      if (!connector) {
        return c.json({ error: { type: 'not_found', message: 'Connector not found' } }, 404)
      }
      return c.json(serializeConnector(connector), 200)
    })
}
