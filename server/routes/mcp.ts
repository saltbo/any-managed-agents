import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, isNull, like, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, requireAuth } from '../auth/session'
import {
  mcpCatalogEntries,
  mcpConnections,
  mcpConnectionTools,
  sessions,
  vaultCredentials,
  vaultCredentialVersions,
} from '../db/schema'
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
import { evaluateMcpToolPolicy, resolveEffectivePolicy } from '../policy'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())
const CONNECTOR_STATUSES = ['available', 'unavailable'] as const
const CONNECTION_STATUSES = ['connected', 'disabled', 'disconnected', 'error'] as const
const TOOL_STATUSES = ['available', 'disabled', 'error'] as const
const APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

const CatalogToolSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    inputSchema: JsonObjectSchema,
    approvalMode: z.enum(APPROVAL_MODES),
    policyMetadata: JsonObjectSchema,
  })
  .openapi('McpCatalogTool')

const McpConnectorSchema = z
  .object({
    id: z.string(),
    connectorId: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    trustLevel: z.string(),
    capabilities: z.array(z.string()),
    supportedAuthModes: z.array(z.string()),
    setupRequirements: z.array(z.string()),
    tools: z.array(CatalogToolSchema),
    metadata: JsonObjectSchema,
    status: z.enum(CONNECTOR_STATUSES),
    policyStatus: z.enum(['allowed', 'blocked', 'approval_required']),
    connectionStatus: z.enum(['not_connected', ...CONNECTION_STATUSES]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('McpConnector')

const McpConnectionSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    connectorId: z.string(),
    hasCredential: z.boolean(),
    endpointUrl: z.string().nullable(),
    approvalMode: z.enum(APPROVAL_MODES),
    status: z.enum(CONNECTION_STATUSES),
    lastError: JsonObjectSchema.nullable(),
    metadata: JsonObjectSchema,
    connectedAt: z.string().datetime(),
    disconnectedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('McpConnection')

const McpToolSchema = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    connectorId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    inputSchema: JsonObjectSchema,
    approvalMode: z.enum(APPROVAL_MODES),
    policyMetadata: JsonObjectSchema,
    status: z.enum(TOOL_STATUSES),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('McpTool')

const ConnectMcpSchema = z
  .object({
    connectorId: z.string().min(1).max(120),
    endpointUrl: z.string().url().optional(),
    authMode: z.string().min(1).max(80).optional(),
    credentialId: z.string().min(1).optional(),
    credentialVersionId: z.string().min(1).optional(),
    approvalMode: z.enum(APPROVAL_MODES).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('ConnectMcpRequest')

const UpdateMcpConnectionSchema = z
  .object({
    endpointUrl: z.string().url().nullable().optional(),
    credentialId: z.string().min(1).nullable().optional(),
    credentialVersionId: z.string().min(1).nullable().optional(),
    approvalMode: z.enum(APPROVAL_MODES).optional(),
    status: z.enum(['connected', 'disabled']).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('UpdateMcpConnectionRequest')

const ToolCallSchema = z
  .object({
    sessionId: z.string().min(1),
    input: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CallMcpToolRequest')

const ToolCallResultSchema = z
  .object({
    connectorId: z.string(),
    toolName: z.string(),
    status: z.enum(['success']),
    output: JsonObjectSchema,
    durationMs: z.number().int(),
  })
  .openapi('McpToolCallResult')

const ConnectorParamsSchema = z.object({
  connectorId: z.string().openapi({ param: { name: 'connectorId', in: 'path' }, example: 'github' }),
})
const ConnectionParamsSchema = z.object({
  connectionId: z.string().openapi({ param: { name: 'connectionId', in: 'path' }, example: 'mcpconn_abc123' }),
})
const ToolParamsSchema = ConnectionParamsSchema.extend({
  toolName: z.string().openapi({ param: { name: 'toolName', in: 'path' }, example: 'repo.read' }),
})
const DeleteConnectionQuerySchema = z.object({
  confirm: z.enum(['true']).openapi({ param: { name: 'confirm', in: 'query' }, example: 'true' }),
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
  status: z
    .enum(CONNECTOR_STATUSES)
    .optional()
    .openapi({ param: { name: 'status', in: 'query' } }),
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
const ConnectionListQuerySchema = z.object({
  status: z
    .enum(CONNECTION_STATUSES)
    .optional()
    .openapi({ param: { name: 'status', in: 'query' } }),
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

const ConnectorListResponseSchema = listResponseSchema('McpConnectorListResponse', McpConnectorSchema)
const ConnectionListResponseSchema = listResponseSchema('McpConnectionListResponse', McpConnectionSchema)
const ToolListResponseSchema = listResponseSchema('McpToolListResponse', McpToolSchema)

type Db = ReturnType<typeof drizzle>
type ConnectorRow = typeof mcpCatalogEntries.$inferSelect
type ConnectionRow = typeof mcpConnections.$inferSelect
type ToolRow = typeof mcpConnectionTools.$inferSelect

const DEFAULT_CONNECTORS = [
  {
    connectorId: 'github',
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
    status: 'available',
  },
  {
    connectorId: 'linear',
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
    status: 'available',
  },
] as const

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function policyStatus(mcpPolicy: Record<string, unknown>, connectorId: string) {
  const blocked = stringArray(mcpPolicy.blockedConnectors)
  if (blocked.includes('*') || blocked.includes(connectorId)) return 'blocked' as const
  const allowed = stringArray(mcpPolicy.allowedConnectors)
  if (allowed.length > 0 && !allowed.includes('*') && !allowed.includes(connectorId)) return 'blocked' as const
  const required = stringArray(mcpPolicy.requireApprovalConnectors)
  if (required.includes('*') || required.includes(connectorId)) return 'approval_required' as const
  if (mcpPolicy.defaultEffect === 'deny') return 'blocked' as const
  return 'allowed' as const
}

function requiresVaultCredential(row: ConnectorRow) {
  return parseJson<string[]>(row.supportedAuthModes, []).includes('vault_credential')
}

async function seedCatalog(db: Db) {
  const timestamp = now()
  for (const connector of DEFAULT_CONNECTORS) {
    const existing = await db
      .select({ id: mcpCatalogEntries.id })
      .from(mcpCatalogEntries)
      .where(eq(mcpCatalogEntries.connectorId, connector.connectorId))
      .get()
    if (!existing) {
      await db.insert(mcpCatalogEntries).values({
        id: `mcpcat_${connector.connectorId}`,
        connectorId: connector.connectorId,
        name: connector.name,
        description: connector.description,
        category: connector.category,
        trustLevel: connector.trustLevel,
        capabilities: stringify(connector.capabilities),
        supportedAuthModes: stringify(connector.supportedAuthModes),
        setupRequirements: stringify(connector.setupRequirements),
        tools: stringify(connector.tools),
        metadata: stringify(connector.metadata),
        status: connector.status,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }
}

function serializeTool(row: ToolRow) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectorId: row.connectorId,
    name: row.name,
    description: row.description,
    inputSchema: parseJson<Record<string, unknown>>(row.inputSchema, {}),
    approvalMode: row.approvalMode as (typeof APPROVAL_MODES)[number],
    policyMetadata: parseJson<Record<string, unknown>>(row.policyMetadata, {}),
    status: row.status as (typeof TOOL_STATUSES)[number],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeConnection(row: ConnectionRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    connectorId: row.connectorId,
    hasCredential: Boolean(row.credentialSecretRef || row.credentialId || row.credentialVersionId),
    endpointUrl: row.endpointUrl,
    approvalMode: row.approvalMode as (typeof APPROVAL_MODES)[number],
    status: row.status as (typeof CONNECTION_STATUSES)[number],
    lastError: parseJson<Record<string, unknown> | null>(row.lastError, null),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeConnector(
  row: ConnectorRow,
  policy: Record<string, unknown>,
  connection: ConnectionRow | null | undefined,
) {
  return {
    id: row.id,
    connectorId: row.connectorId,
    name: row.name,
    description: row.description,
    category: row.category,
    trustLevel: row.trustLevel,
    capabilities: parseJson<string[]>(row.capabilities, []),
    supportedAuthModes: parseJson<string[]>(row.supportedAuthModes, []),
    setupRequirements: parseJson<string[]>(row.setupRequirements, []),
    tools: parseJson<z.infer<typeof CatalogToolSchema>[]>(row.tools, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    status: row.status as (typeof CONNECTOR_STATUSES)[number],
    policyStatus: policyStatus(policy, row.connectorId),
    connectionStatus: (connection?.status ?? 'not_connected') as 'not_connected' | (typeof CONNECTION_STATUSES)[number],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function findConnection(db: Db, auth: AuthContext, connectionId: string) {
  return (
    (await db
      .select()
      .from(mcpConnections)
      .where(and(eq(mcpConnections.id, connectionId), eq(mcpConnections.projectId, auth.project.id)))
      .get()) ?? null
  )
}

async function resolveCredential(db: Db, auth: AuthContext, credentialId?: string | null, versionId?: string | null) {
  if (!credentialId && !versionId) {
    return { credentialId: null, credentialVersionId: null, secretRef: null }
  }
  const credential = credentialId
    ? await db
        .select()
        .from(vaultCredentials)
        .where(
          and(
            eq(vaultCredentials.id, credentialId),
            eq(vaultCredentials.organizationId, auth.organization.id),
            or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
          ),
        )
        .get()
    : null
  if (credentialId && (!credential || credential.status !== 'active')) {
    throw new Error('Credential is revoked or unavailable.')
  }
  const effectiveVersionId = versionId ?? credential?.activeVersionId
  if (!effectiveVersionId) {
    return { credentialId: credential?.id ?? null, credentialVersionId: null, secretRef: null }
  }
  const version = await db
    .select()
    .from(vaultCredentialVersions)
    .where(
      and(
        eq(vaultCredentialVersions.id, effectiveVersionId),
        eq(vaultCredentialVersions.organizationId, auth.organization.id),
        or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
      ),
    )
    .get()
  if (!version || version.status !== 'active') {
    throw new Error('Credential version is revoked or unavailable.')
  }
  if (credential && version.credentialId !== credential.id) {
    throw new Error('Credential version does not belong to the credential.')
  }
  return {
    credentialId: credential?.id ?? version.credentialId,
    credentialVersionId: version.id,
    secretRef: version.secretRef,
  }
}

async function replaceConnectionTools(db: Db, auth: AuthContext, connection: ConnectionRow, catalog: ConnectorRow) {
  const timestamp = now()
  await db.delete(mcpConnectionTools).where(eq(mcpConnectionTools.connectionId, connection.id))
  const tools = parseJson<z.infer<typeof CatalogToolSchema>[]>(catalog.tools, [])
  if (tools.length === 0) return
  await db.insert(mcpConnectionTools).values(
    tools.map((tool) => ({
      id: newId('mcptool'),
      connectionId: connection.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      connectorId: connection.connectorId,
      name: tool.name,
      description: tool.description,
      inputSchema: stringify(tool.inputSchema),
      approvalMode: connection.approvalMode === 'project_policy' ? tool.approvalMode : connection.approvalMode,
      policyMetadata: stringify(tool.policyMetadata),
      status: 'available',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  )
}

function normalizedMcpError(value: unknown) {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const type = input.type
  const errorType =
    type === 'unauthorized'
      ? 'mcp_unauthorized'
      : type === 'not_found'
        ? 'mcp_not_found'
        : type === 'timeout'
          ? 'mcp_timeout'
          : type === 'invalid_schema'
            ? 'mcp_invalid_schema'
            : type === 'network'
              ? 'mcp_network_error'
              : 'mcp_upstream_error'
  return { type: errorType, message: 'MCP tool call failed.' }
}

const listConnectorsRoute = createRoute({
  method: 'get',
  path: '/connectors',
  operationId: 'listMcpConnectors',
  tags: ['MCP'],
  summary: 'List MCP connectors',
  ...AuthenticatedOperation,
  request: { query: ConnectorListQuerySchema },
  responses: {
    200: {
      description: 'MCP connector list',
      content: { 'application/json': { schema: ConnectorListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readConnectorRoute = createRoute({
  method: 'get',
  path: '/connectors/{connectorId}',
  operationId: 'readMcpConnector',
  tags: ['MCP'],
  summary: 'Read MCP connector',
  ...AuthenticatedOperation,
  request: { params: ConnectorParamsSchema },
  responses: {
    200: { description: 'MCP connector', content: { 'application/json': { schema: McpConnectorSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'MCP connector not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listConnectionsRoute = createRoute({
  method: 'get',
  path: '/connections',
  operationId: 'listMcpConnections',
  tags: ['MCP'],
  summary: 'List MCP connections',
  ...AuthenticatedOperation,
  request: { query: ConnectionListQuerySchema },
  responses: {
    200: {
      description: 'MCP connection list',
      content: { 'application/json': { schema: ConnectionListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const connectRoute = createRoute({
  method: 'post',
  path: '/connections',
  operationId: 'connectMcpConnector',
  tags: ['MCP'],
  summary: 'Connect or upsert an MCP connector',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: ConnectMcpSchema } } } },
  responses: {
    200: { description: 'Updated MCP connection', content: { 'application/json': { schema: McpConnectionSchema } } },
    201: { description: 'Created MCP connection', content: { 'application/json': { schema: McpConnectionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'MCP connector not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Credential unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readConnectionRoute = createRoute({
  method: 'get',
  path: '/connections/{connectionId}',
  operationId: 'readMcpConnection',
  tags: ['MCP'],
  summary: 'Read MCP connection',
  ...AuthenticatedOperation,
  request: { params: ConnectionParamsSchema },
  responses: {
    200: { description: 'MCP connection', content: { 'application/json': { schema: McpConnectionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'MCP connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateConnectionRoute = createRoute({
  method: 'patch',
  path: '/connections/{connectionId}',
  operationId: 'updateMcpConnection',
  tags: ['MCP'],
  summary: 'Update MCP connection',
  ...AuthenticatedOperation,
  request: {
    params: ConnectionParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateMcpConnectionSchema } } },
  },
  responses: {
    200: { description: 'MCP connection', content: { 'application/json': { schema: McpConnectionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'MCP connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Credential unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const disconnectRoute = createRoute({
  method: 'delete',
  path: '/connections/{connectionId}',
  operationId: 'disconnectMcpConnection',
  tags: ['MCP'],
  summary: 'Disconnect MCP connection',
  ...AuthenticatedOperation,
  request: { params: ConnectionParamsSchema, query: DeleteConnectionQuerySchema },
  responses: {
    204: { description: 'MCP connection disconnected' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'MCP connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listToolsRoute = createRoute({
  method: 'get',
  path: '/connections/{connectionId}/tools',
  operationId: 'listMcpTools',
  tags: ['MCP'],
  summary: 'List MCP connection tools',
  ...AuthenticatedOperation,
  request: { params: ConnectionParamsSchema },
  responses: {
    200: { description: 'MCP tools', content: { 'application/json': { schema: ToolListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'MCP connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'MCP connection unavailable',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const callToolRoute = createRoute({
  method: 'post',
  path: '/connections/{connectionId}/tools/{toolName}/calls',
  operationId: 'callMcpTool',
  tags: ['MCP'],
  summary: 'Call MCP tool through AMA policy boundary',
  ...AuthenticatedOperation,
  request: {
    params: ToolParamsSchema,
    body: { required: true, content: { 'application/json': { schema: ToolCallSchema } } },
  },
  responses: {
    200: { description: 'MCP tool result', content: { 'application/json': { schema: ToolCallResultSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'MCP connection or tool not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: {
      description: 'Approval required or unavailable',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    502: { description: 'MCP upstream error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

app.openapi(listConnectorsRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  await seedCatalog(db)

  const { search, category, trustLevel, capability, status, limit = 50, cursor } = c.req.valid('query')
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
  }
  const filters = [
    status ? eq(mcpCatalogEntries.status, status) : undefined,
    category ? eq(mcpCatalogEntries.category, category) : undefined,
    trustLevel ? eq(mcpCatalogEntries.trustLevel, trustLevel) : undefined,
    search
      ? or(like(mcpCatalogEntries.name, `%${search}%`), like(mcpCatalogEntries.description, `%${search}%`))
      : undefined,
    capability ? like(mcpCatalogEntries.capabilities, `%${capability}%`) : undefined,
    parsedCursor
      ? or(
          lt(mcpCatalogEntries.createdAt, parsedCursor.createdAt),
          and(eq(mcpCatalogEntries.createdAt, parsedCursor.createdAt), lt(mcpCatalogEntries.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(mcpCatalogEntries)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(mcpCatalogEntries.createdAt), desc(mcpCatalogEntries.id))
    .limit(limit + 1)
  const connections = await db.select().from(mcpConnections).where(eq(mcpConnections.projectId, auth.project.id))
  const connectionByConnector = new Map(connections.map((connection) => [connection.connectorId, connection]))
  const effective = await resolveEffectivePolicy(db, auth)
  const page = paginateRows(rows, limit)
  return c.json(
    {
      data: page.data.map((row) =>
        serializeConnector(row, effective.mcpPolicy, connectionByConnector.get(row.connectorId)),
      ),
      pagination: page.pagination,
    },
    200,
  )
})

app.openapi(readConnectorRoute, async (c) => {
  const { connectorId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  await seedCatalog(db)
  const connector = await db
    .select()
    .from(mcpCatalogEntries)
    .where(eq(mcpCatalogEntries.connectorId, connectorId))
    .get()
  if (!connector) return errorResponse(c, 404, 'not_found', 'MCP connector not found')
  const connection = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.projectId, auth.project.id), eq(mcpConnections.connectorId, connectorId)))
    .get()
  const effective = await resolveEffectivePolicy(db, auth)
  return c.json(serializeConnector(connector, effective.mcpPolicy, connection), 200)
})

app.openapi(listConnectionsRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const { status, limit = 50, cursor } = c.req.valid('query')
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
  }
  const filters = [
    eq(mcpConnections.projectId, auth.project.id),
    status ? eq(mcpConnections.status, status) : undefined,
    parsedCursor
      ? or(
          lt(mcpConnections.createdAt, parsedCursor.createdAt),
          and(eq(mcpConnections.createdAt, parsedCursor.createdAt), lt(mcpConnections.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(and(...filters))
    .orderBy(desc(mcpConnections.createdAt), desc(mcpConnections.id))
    .limit(limit + 1)
  const page = paginateRows(rows, limit)
  return c.json({ data: page.data.map(serializeConnection), pagination: page.pagination }, 200)
})

async function upsertConnection(c: Context<{ Bindings: Env }>, body: z.infer<typeof ConnectMcpSchema>) {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  await seedCatalog(db)
  const catalog = await db
    .select()
    .from(mcpCatalogEntries)
    .where(eq(mcpCatalogEntries.connectorId, body.connectorId))
    .get()
  if (!catalog) return errorResponse(c, 404, 'not_found', 'MCP connector not found')
  if (catalog.status !== 'available') return errorResponse(c, 409, 'conflict', 'MCP connector is unavailable')
  const effective = await resolveEffectivePolicy(db, auth)
  const status = policyStatus(effective.mcpPolicy, body.connectorId)
  if (status === 'blocked') {
    await recordAudit(db, {
      auth,
      action: 'mcp_connection.connect',
      resourceType: 'mcp_connector',
      resourceId: body.connectorId,
      outcome: 'denied',
      requestId: requestId(c),
      policyCategory: 'mcp',
      metadata: { connectorId: body.connectorId },
    })
    return errorResponse(c, 403, 'policy_denied', 'MCP connector is blocked by governance policy.', {
      category: 'mcp',
      resourceType: 'mcp_connector',
      resourceId: body.connectorId,
    })
  }

  const existing = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.projectId, auth.project.id), eq(mcpConnections.connectorId, body.connectorId)))
    .get()
  let credential: { credentialId: string | null; credentialVersionId: string | null; secretRef: string | null }
  try {
    credential =
      existing && body.credentialId === undefined && body.credentialVersionId === undefined
        ? {
            credentialId: existing.credentialId,
            credentialVersionId: existing.credentialVersionId,
            secretRef: existing.credentialSecretRef,
          }
        : await resolveCredential(db, auth, body.credentialId, body.credentialVersionId)
  } catch (error) {
    return c.json(
      validation(error instanceof Error ? error.message : 'Credential is unavailable.', {
        credential: 'Credential is unavailable.',
      }),
      409,
    )
  }
  if (requiresVaultCredential(catalog) && !credential.credentialVersionId) {
    return c.json(
      validation('MCP connector requires a vault credential reference.', {
        credentialId: 'Credential is required for this connector.',
      }),
      400,
    )
  }
  const timestamp = now()
  const row = {
    id: existing?.id ?? newId('mcpconn'),
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    connectorId: body.connectorId,
    credentialId: credential.credentialId,
    credentialVersionId: credential.credentialVersionId,
    credentialSecretRef: credential.secretRef,
    endpointUrl: body.endpointUrl ?? existing?.endpointUrl ?? null,
    approvalMode: body.approvalMode ?? existing?.approvalMode ?? 'project_policy',
    status: 'connected',
    lastError: null,
    metadata: stringify(body.metadata ?? (existing ? parseJson(existing.metadata, {}) : {})),
    connectedAt: existing?.connectedAt ?? timestamp,
    disconnectedAt: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  if (existing) {
    await db.update(mcpConnections).set(row).where(eq(mcpConnections.id, existing.id))
  } else {
    await db.insert(mcpConnections).values(row)
  }
  await replaceConnectionTools(db, auth, row, catalog)
  await recordAudit(db, {
    auth,
    action: existing ? 'mcp_connection.update' : 'mcp_connection.connect',
    resourceType: 'mcp_connection',
    resourceId: row.id,
    outcome: 'success',
    requestId: requestId(c),
    before: existing ? serializeConnection(existing) : null,
    after: serializeConnection(row),
  })
  if (existing) return c.json(serializeConnection(row), 200)
  return c.json(serializeConnection(row), 201)
}

app.openapi(connectRoute, async (c) => upsertConnection(c, c.req.valid('json')))

app.openapi(readConnectionRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
  if (!connection) return errorResponse(c, 404, 'not_found', 'MCP connection not found')
  return c.json(serializeConnection(connection), 200)
})

app.openapi(updateConnectionRoute, async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
  if (!connection) return errorResponse(c, 404, 'not_found', 'MCP connection not found')
  const catalog = await db
    .select()
    .from(mcpCatalogEntries)
    .where(eq(mcpCatalogEntries.connectorId, connection.connectorId))
    .get()
  if (!catalog) return errorResponse(c, 404, 'not_found', 'MCP connector not found')
  let credential = {
    credentialId: connection.credentialId,
    credentialVersionId: connection.credentialVersionId,
    secretRef: connection.credentialSecretRef,
  }
  if (body.credentialId !== undefined || body.credentialVersionId !== undefined) {
    try {
      credential = await resolveCredential(db, auth, body.credentialId, body.credentialVersionId)
    } catch (error) {
      return c.json(
        validation(error instanceof Error ? error.message : 'Credential is unavailable.', {
          credential: 'Credential is unavailable.',
        }),
        409,
      )
    }
  }
  if (requiresVaultCredential(catalog) && !credential.credentialVersionId) {
    return c.json(
      validation('MCP connector requires a vault credential reference.', {
        credentialId: 'Credential is required for this connector.',
      }),
      400,
    )
  }
  const timestamp = now()
  const row = {
    ...connection,
    credentialId: credential.credentialId,
    credentialVersionId: credential.credentialVersionId,
    credentialSecretRef: credential.secretRef,
    endpointUrl: body.endpointUrl === undefined ? connection.endpointUrl : body.endpointUrl,
    approvalMode: body.approvalMode ?? connection.approvalMode,
    status: body.status ?? connection.status,
    metadata: stringify(body.metadata ?? parseJson(connection.metadata, {})),
    updatedAt: timestamp,
  }
  await db.update(mcpConnections).set(row).where(eq(mcpConnections.id, connection.id))
  await recordAudit(db, {
    auth,
    action: 'mcp_connection.update',
    resourceType: 'mcp_connection',
    resourceId: row.id,
    outcome: 'success',
    requestId: requestId(c),
    before: serializeConnection(connection),
    after: serializeConnection(row),
  })
  return c.json(serializeConnection(row), 200)
})

app.openapi(disconnectRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
  if (!connection) return errorResponse(c, 404, 'not_found', 'MCP connection not found')
  const timestamp = now()
  await db
    .update(mcpConnections)
    .set({ status: 'disconnected', disconnectedAt: timestamp, updatedAt: timestamp })
    .where(eq(mcpConnections.id, connection.id))
  await recordAudit(db, {
    auth,
    action: 'mcp_connection.disconnect',
    resourceType: 'mcp_connection',
    resourceId: connection.id,
    outcome: 'success',
    requestId: requestId(c),
    before: serializeConnection(connection),
  })
  return c.body(null, 204)
})

app.openapi(listToolsRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
  if (!connection) return errorResponse(c, 404, 'not_found', 'MCP connection not found')
  if (connection.status !== 'connected') return errorResponse(c, 409, 'conflict', 'MCP connection is not connected')
  const rows = await db
    .select()
    .from(mcpConnectionTools)
    .where(and(eq(mcpConnectionTools.connectionId, connection.id), eq(mcpConnectionTools.status, 'available')))
    .orderBy(desc(mcpConnectionTools.createdAt), desc(mcpConnectionTools.id))
  return c.json(
    {
      data: rows.map(serializeTool),
      pagination: {
        limit: rows.length,
        nextCursor: null,
        hasMore: false,
        firstId: rows[0]?.id ?? null,
        lastId: rows.at(-1)?.id ?? null,
      },
    },
    200,
  )
})

app.openapi(callToolRoute, async (c) => {
  const started = Date.now()
  const body = c.req.valid('json')
  const { connectionId, toolName } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const connection = await findConnection(db, auth, connectionId)
  if (!connection) return errorResponse(c, 404, 'not_found', 'MCP connection not found')
  const session = await db
    .select({
      id: sessions.id,
      agentSnapshot: sessions.agentSnapshot,
      environmentSnapshot: sessions.environmentSnapshot,
    })
    .from(sessions)
    .where(and(eq(sessions.id, body.sessionId), eq(sessions.projectId, auth.project.id)))
    .get()
  if (!session) return errorResponse(c, 404, 'not_found', 'Session not found')
  const tool = await db
    .select()
    .from(mcpConnectionTools)
    .where(and(eq(mcpConnectionTools.connectionId, connection.id), eq(mcpConnectionTools.name, toolName)))
    .get()
  if (!tool || tool.status !== 'available') return errorResponse(c, 404, 'not_found', 'MCP tool not found')

  const decision = await evaluateMcpToolPolicy(db, auth, {
    connectorId: connection.connectorId,
    toolName,
    session,
  })
  if (!decision.allowed) {
    await recordAudit(db, {
      auth,
      action: 'mcp_tool.call',
      resourceType: 'mcp_tool',
      resourceId: tool.id,
      outcome: 'denied',
      requestId: requestId(c),
      sessionId: session.id,
      policyCategory: decision.category,
      metadata: { connectorId: connection.connectorId, toolName, decision },
    })
    const status = decision.category === 'approval' ? 409 : 403
    return errorResponse(c, status, status === 409 ? 'conflict' : 'policy_denied', decision.message, {
      category: decision.category,
      resourceType: decision.category === 'tool' ? 'tool' : 'mcp_connector',
      resourceId: decision.category === 'tool' ? toolName : connection.connectorId,
      ruleId: decision.rule,
    })
  }

  const simulatedError = body.input?.simulateError
  if (simulatedError) {
    const error = normalizedMcpError(simulatedError)
    await recordAudit(db, {
      auth,
      action: 'mcp_tool.call',
      resourceType: 'mcp_tool',
      resourceId: tool.id,
      outcome: 'failure',
      requestId: requestId(c),
      sessionId: session.id,
      metadata: { connectorId: connection.connectorId, toolName, error },
    })
    return errorResponse(c, 502, 'mcp_error', error.message, { mcpError: error })
  }

  const output = { ok: true, connectorId: connection.connectorId, toolName }
  const result = {
    connectorId: connection.connectorId,
    toolName,
    status: 'success' as const,
    output,
    durationMs: Date.now() - started,
  }
  await recordAudit(db, {
    auth,
    action: 'mcp_tool.call',
    resourceType: 'mcp_tool',
    resourceId: tool.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { ...result, inputSummary: Object.keys(body.input ?? {}) },
  })
  return c.json(result, 200)
})

export default app
