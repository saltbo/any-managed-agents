import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, like, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { connectors } from '../db/schema'
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
const CONNECTOR_AVAILABILITIES = ['available', 'unavailable'] as const
const APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

export const ConnectorToolSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    inputSchema: JsonObjectSchema,
    approvalMode: z.enum(APPROVAL_MODES),
    policyMetadata: JsonObjectSchema,
  })
  .openapi('ConnectorTool')

export type ConnectorCatalogTool = z.infer<typeof ConnectorToolSchema>

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

type Db = ReturnType<typeof drizzle>
type ConnectorRow = typeof connectors.$inferSelect

// Platform catalog seed data. The catalog is a static, read-only directory:
// rows are lazily seeded once and only ever read afterwards.
const DEFAULT_CONNECTORS = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository, issue, and pull request tools through an MCP server.',
    category: 'development',
    trustLevel: 'verified',
    capabilities: ['repositories', 'issues', 'pull_requests'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['github_token'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository metadata and files.',
        inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
        approvalMode: 'project_policy',
        policyMetadata: { sensitivity: 'low' },
      },
    ],
    metadata: { source: 'platform_catalog' },
    availability: 'available',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project planning tools through an MCP server.',
    category: 'planning',
    trustLevel: 'verified',
    capabilities: ['issues', 'projects'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['linear_api_key'],
    tools: [
      {
        name: 'issue.read',
        description: 'Read issue metadata.',
        inputSchema: { type: 'object', properties: { issueId: { type: 'string' } }, required: ['issueId'] },
        approvalMode: 'project_policy',
        policyMetadata: { sensitivity: 'low' },
      },
    ],
    metadata: { source: 'platform_catalog' },
    availability: 'available',
  },
] as const

// Connector ids the platform catalog ships with, exported so governance
// config validation can recognize catalog connectors before the lazily
// seeded catalog rows exist.
export const PLATFORM_CONNECTOR_IDS: readonly string[] = DEFAULT_CONNECTORS.map((connector) => connector.id)

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null | undefined, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function validation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } }
}

export async function seedConnectorCatalog(db: Db) {
  const timestamp = now()
  for (const connector of DEFAULT_CONNECTORS) {
    const existing = await db
      .select({ id: connectors.id })
      .from(connectors)
      .where(eq(connectors.id, connector.id))
      .get()
    if (!existing) {
      await db.insert(connectors).values({
        id: connector.id,
        name: connector.name,
        description: connector.description,
        category: connector.category,
        trustLevel: connector.trustLevel,
        capabilities: stringify(connector.capabilities),
        supportedAuthModes: stringify(connector.supportedAuthModes),
        setupRequirements: stringify(connector.setupRequirements),
        tools: stringify(connector.tools),
        metadata: stringify(connector.metadata),
        availability: connector.availability,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }
}

function serializeConnector(row: ConnectorRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    trustLevel: row.trustLevel,
    capabilities: parseJson<string[]>(row.capabilities, []),
    supportedAuthModes: parseJson<string[]>(row.supportedAuthModes, []),
    setupRequirements: parseJson<string[]>(row.setupRequirements, []),
    tools: parseJson<ConnectorCatalogTool[]>(row.tools, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    availability: row.availability as (typeof CONNECTOR_AVAILABILITIES)[number],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

const routes = app
  .openapi(listConnectorsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    await seedConnectorCatalog(db)

    const { search, category, trustLevel, capability, availability, limit = 50, cursor } = c.req.valid('query')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
    }
    const filters = [
      availability ? eq(connectors.availability, availability) : undefined,
      category ? eq(connectors.category, category) : undefined,
      trustLevel ? eq(connectors.trustLevel, trustLevel) : undefined,
      search ? or(like(connectors.name, `%${search}%`), like(connectors.description, `%${search}%`)) : undefined,
      capability ? like(connectors.capabilities, `%${capability}%`) : undefined,
      parsedCursor
        ? or(
            lt(connectors.createdAt, parsedCursor.createdAt),
            and(eq(connectors.createdAt, parsedCursor.createdAt), lt(connectors.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(connectors)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(connectors.createdAt), desc(connectors.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeConnector), pagination: page.pagination }, 200)
  })
  .openapi(readConnectorRoute, async (c) => {
    const { connectorId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    await seedConnectorCatalog(db)
    const connector = await db.select().from(connectors).where(eq(connectors.id, connectorId)).get()
    if (!connector) return errorResponse(c, 404, 'not_found', 'Connector not found')
    return c.json(serializeConnector(connector), 200)
  })

export default routes
