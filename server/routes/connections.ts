import { type Schema, Validator } from '@cfworker/json-schema'
import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, isNull, lt, max, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, requireAuth } from '../auth/session'
import {
  connections,
  connectionTools,
  connectors,
  sessionEvents,
  sessions,
  toolCalls,
  vaultCredentials,
  vaultCredentialVersions,
} from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  CredentialRefSchema,
  createApiRouter,
  ErrorResponseSchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import { evaluateMcpToolPolicy, resolveEffectivePolicy } from '../policy'
import { redactSensitiveValue } from '../redaction'
import {
  callMcpServerTool,
  categorizeMcpClientFailure,
  listMcpServerTools,
  McpClientError,
  type McpClientErrorCategory,
  type McpClientTarget,
} from '../runtime/mcp-client'
import { resolveRuntimeSecretEnv } from '../runtime/secret-env'
import { type ConnectorCatalogTool, seedConnectorCatalog } from './connectors'

const app = createApiRouter()

const JsonObjectSchema = z.record(z.string(), z.unknown())
const CONNECTION_STATES = ['connected', 'disabled', 'disconnected', 'error'] as const
const TOOL_AVAILABILITIES = ['available', 'disabled', 'error'] as const
const TOOL_CALL_STATES = ['success', 'error'] as const
const APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

const ConnectionSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    connectorId: z.string(),
    credentialRef: CredentialRefSchema.nullable(),
    endpointUrl: z.string().nullable(),
    approvalMode: z.enum(APPROVAL_MODES),
    state: z.enum(CONNECTION_STATES),
    lastError: JsonObjectSchema.nullable(),
    metadata: JsonObjectSchema,
    connectedAt: z.string().datetime(),
    disconnectedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Connection')

const ConnectionToolSchema = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    connectorId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    inputSchema: JsonObjectSchema,
    approvalMode: z.enum(APPROVAL_MODES),
    policyMetadata: JsonObjectSchema,
    availability: z.enum(TOOL_AVAILABILITIES),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ConnectionTool')

const ToolCallErrorSchema = z
  .object({
    type: z.string(),
    message: z.string(),
  })
  .openapi('ToolCallError')

const ToolCallSchema = z
  .object({
    id: z.string(),
    connectionId: z.string(),
    connectorId: z.string(),
    toolName: z.string(),
    sessionId: z.string(),
    state: z.enum(TOOL_CALL_STATES),
    input: JsonObjectSchema,
    output: JsonObjectSchema.nullable(),
    error: ToolCallErrorSchema.nullable(),
    durationMs: z.number().int(),
    createdAt: z.string().datetime(),
  })
  .openapi('ToolCall')

const CreateConnectionSchema = z
  .object({
    connectorId: z.string().min(1).max(120),
    endpointUrl: z.string().url().optional(),
    credentialRef: CredentialRefSchema.optional(),
    approvalMode: z.enum(APPROVAL_MODES).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreateConnectionRequest')

const UpdateConnectionSchema = z
  .object({
    endpointUrl: z.string().url().nullable().optional(),
    credentialRef: CredentialRefSchema.nullable().optional(),
    approvalMode: z.enum(APPROVAL_MODES).optional(),
    state: z.enum(['connected', 'disabled', 'disconnected']).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('UpdateConnectionRequest')

const CreateToolCallSchema = z
  .object({
    sessionId: z.string().min(1),
    input: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreateToolCallRequest')

const ConnectionParamsSchema = z.object({
  connectionId: z.string().openapi({ param: { name: 'connectionId', in: 'path' }, example: 'conn_abc123' }),
})
const ToolParamsSchema = ConnectionParamsSchema.extend({
  toolName: z.string().openapi({ param: { name: 'toolName', in: 'path' }, example: 'repo.read' }),
})
const ToolCallParamsSchema = ToolParamsSchema.extend({
  callId: z.string().openapi({ param: { name: 'callId', in: 'path' }, example: 'call_abc123' }),
})
const ConnectionListQuerySchema = z.object({
  state: z
    .enum(CONNECTION_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' } }),
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
const ToolCallListQuerySchema = z.object({
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

const ConnectionListResponseSchema = listResponseSchema('ConnectionListResponse', ConnectionSchema)
const ConnectionToolListResponseSchema = listResponseSchema('ConnectionToolListResponse', ConnectionToolSchema)
const ToolCallListResponseSchema = listResponseSchema('ToolCallListResponse', ToolCallSchema)

type Db = ReturnType<typeof drizzle>
type ConnectorRow = typeof connectors.$inferSelect
type ConnectionRow = typeof connections.$inferSelect
type ToolRow = typeof connectionTools.$inferSelect
type ToolCallRow = typeof toolCalls.$inferSelect

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

function connectorPolicyEffect(mcpPolicy: Record<string, unknown>, connectorId: string) {
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

function credentialRef(row: Pick<ConnectionRow, 'credentialId' | 'credentialVersionId'>) {
  if (!row.credentialId) return null
  return {
    credentialId: row.credentialId,
    ...(row.credentialVersionId ? { versionId: row.credentialVersionId } : {}),
  }
}

function serializeConnection(row: ConnectionRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    connectorId: row.connectorId,
    credentialRef: credentialRef(row),
    endpointUrl: row.endpointUrl,
    approvalMode: row.approvalMode as (typeof APPROVAL_MODES)[number],
    state: row.state as (typeof CONNECTION_STATES)[number],
    lastError: parseJson<Record<string, unknown> | null>(row.lastError, null),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    availability: row.availability as (typeof TOOL_AVAILABILITIES)[number],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeToolCall(row: ToolCallRow) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectorId: row.connectorId,
    toolName: row.toolName,
    sessionId: row.sessionId ?? '',
    state: row.state as (typeof TOOL_CALL_STATES)[number],
    input: parseJson<Record<string, unknown>>(row.input, {}),
    output: parseJson<Record<string, unknown> | null>(row.output, null),
    error: parseJson<{ type: string; message: string } | null>(row.error, null),
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  }
}

function toolCallLocation(row: Pick<ToolCallRow, 'id' | 'connectionId' | 'toolName'>) {
  return `/api/v1/connections/${row.connectionId}/tools/${encodeURIComponent(row.toolName)}/calls/${row.id}`
}

async function findConnection(db: Db, auth: AuthContext, connectionId: string) {
  return (
    (await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.projectId, auth.project.id)))
      .get()) ?? null
  )
}

async function resolveCredential(
  db: Db,
  auth: AuthContext,
  ref: { credentialId: string; versionId?: string | undefined } | null,
) {
  if (!ref) {
    return { credentialId: null, credentialVersionId: null }
  }
  const credential = await db
    .select()
    .from(vaultCredentials)
    .where(
      and(
        eq(vaultCredentials.id, ref.credentialId),
        eq(vaultCredentials.organizationId, auth.organization.id),
        or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
      ),
    )
    .get()
  if (credential?.state !== 'active') {
    throw new Error('Credential is revoked or unavailable.')
  }
  const effectiveVersionId = ref.versionId ?? credential.activeVersionId
  if (!effectiveVersionId) {
    return { credentialId: credential.id, credentialVersionId: null }
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
  if (version?.state !== 'active') {
    throw new Error('Credential version is revoked or unavailable.')
  }
  if (version.credentialId !== credential.id) {
    throw new Error('Credential version does not belong to the credential.')
  }
  return { credentialId: credential.id, credentialVersionId: version.id }
}

async function replaceConnectionTools(db: Db, auth: AuthContext, connection: ConnectionRow, catalog: ConnectorRow) {
  const timestamp = now()
  await db.delete(connectionTools).where(eq(connectionTools.connectionId, connection.id))
  const tools = parseJson<ConnectorCatalogTool[]>(catalog.tools, [])
  if (tools.length === 0) return
  await db.insert(connectionTools).values(
    tools.map((tool) => ({
      id: newId('contool'),
      connectionId: connection.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      connectorId: connection.connectorId,
      name: tool.name,
      description: tool.description,
      inputSchema: stringify(tool.inputSchema),
      approvalMode: connection.approvalMode === 'project_policy' ? tool.approvalMode : connection.approvalMode,
      policyMetadata: stringify(tool.policyMetadata),
      availability: 'available',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  )
}

// Stable error surface for connector failures. Raw connector error text never
// reaches API responses, audit metadata, or session events.
const NORMALIZED_MCP_ERRORS: Record<McpClientErrorCategory, { type: string; message: string }> = {
  unauthorized: { type: 'mcp_unauthorized', message: 'MCP server rejected the connection credential.' },
  not_found: { type: 'mcp_not_found', message: 'MCP server or tool was not found.' },
  timeout: { type: 'mcp_timeout', message: 'MCP server did not respond before the configured timeout.' },
  invalid_schema: { type: 'mcp_invalid_schema', message: 'MCP server rejected the tool input schema.' },
  network: { type: 'mcp_network_error', message: 'MCP server could not be reached.' },
  upstream: { type: 'mcp_upstream_error', message: 'MCP tool call failed.' },
}

function normalizedMcpError(error: unknown) {
  return NORMALIZED_MCP_ERRORS[categorizeMcpClientFailure(error)]
}

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 20_000

function connectionRequestTimeoutMs(connection: ConnectionRow) {
  const metadata = parseJson<Record<string, unknown>>(connection.metadata, {})
  const value = metadata.requestTimeoutMs
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(Math.trunc(value), 100), 60_000)
  }
  return DEFAULT_MCP_REQUEST_TIMEOUT_MS
}

// Resolves the connection credential to an Authorization header value. The
// credential's active version wins over the version pinned at connect time so
// rotated credentials take effect without reconnecting.
async function resolveConnectionAuthorization(env: Env, db: Db, auth: AuthContext, connection: ConnectionRow) {
  const credentialId = connection.credentialId
  if (!credentialId) {
    return null
  }
  const credential = await db
    .select({ activeVersionId: vaultCredentials.activeVersionId })
    .from(vaultCredentials)
    .where(
      and(
        eq(vaultCredentials.id, credentialId),
        eq(vaultCredentials.organizationId, auth.organization.id),
        or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
      ),
    )
    .get()
  // The credential's active version wins over the version pinned at connect
  // time so rotated credentials take effect without reconnecting.
  const versionId = credential?.activeVersionId ?? connection.credentialVersionId ?? undefined
  let resolved: Record<string, string>
  try {
    resolved = await resolveRuntimeSecretEnv(
      env,
      db,
      { organizationId: auth.organization.id, projectId: auth.project.id },
      [{ name: 'credential', credentialRef: { credentialId, versionId } }],
    )
  } catch (error) {
    throw new McpClientError('unauthorized', error)
  }
  const value = resolved.credential
  return typeof value === 'string' ? `Bearer ${value}` : null
}

async function mcpClientTarget(
  env: Env,
  db: Db,
  auth: AuthContext,
  connection: ConnectionRow,
  endpointUrl: string,
): Promise<McpClientTarget> {
  return {
    endpointUrl,
    authorization: await resolveConnectionAuthorization(env, db, auth, connection),
    timeoutMs: connectionRequestTimeoutMs(connection),
  }
}

// Canonical session event append with the same sequence-collision retry the
// runtime event paths use; MCP policy checks, calls, and results stay
// inspectable on the session after completion.
async function appendMcpSessionEvent(
  db: Db,
  values: {
    auth: AuthContext
    sessionId: string
    type: 'policy.decision' | 'tool_execution_start' | 'tool_execution_end'
    payload: Record<string, unknown>
    parentEventId?: string | null
    correlationId?: string | null
  },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const eventId = newId('event')
    const latest = await db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, values.sessionId))
      .get()
    try {
      await db.insert(sessionEvents).values({
        id: eventId,
        organizationId: values.auth.organization.id,
        projectId: values.auth.project.id,
        sessionId: values.sessionId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: values.type,
        visibility: 'runtime',
        role: null,
        parentEventId: values.parentEventId ?? null,
        correlationId: values.correlationId ?? null,
        payload: stringify(redactSensitiveValue(values.payload)),
        metadata: stringify({ source: 'mcp-client' }),
        createdAt: now(),
      })
      return eventId
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
  throw new Error('Unable to append MCP session event')
}

// Tool input is validated against the schema the MCP server declared (synced
// at listing time, or catalog metadata before the first sync). Spec-conformant
// MCP servers report input validation failures as opaque in-band tool errors,
// so the control plane validates at its own boundary to keep the stable
// invalid_schema category.
function validateToolInput(tool: ToolRow, input: Record<string, unknown>) {
  const schema = parseJson<Record<string, unknown>>(tool.inputSchema, {})
  if (Object.keys(schema).length === 0) return
  const result = new Validator(schema as Schema, '2020-12', false).validate(input)
  if (!result.valid) {
    throw new McpClientError('invalid_schema', result.errors)
  }
}

async function syncConnectionToolsFromServer(
  db: Db,
  auth: AuthContext,
  connection: ConnectionRow,
  tools: Awaited<ReturnType<typeof listMcpServerTools>>,
) {
  const timestamp = now()
  await db.delete(connectionTools).where(eq(connectionTools.connectionId, connection.id))
  if (tools.length === 0) return
  await db.insert(connectionTools).values(
    tools.map((tool) => ({
      id: newId('contool'),
      connectionId: connection.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      connectorId: connection.connectorId,
      name: tool.name,
      description: tool.description,
      inputSchema: stringify(tool.inputSchema),
      approvalMode: connection.approvalMode,
      policyMetadata: stringify({ source: 'mcp_server' }),
      availability: 'available',
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  )
}

const listConnectionsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listConnections',
  tags: ['Connections'],
  summary: 'List connections',
  ...AuthenticatedOperation,
  request: { query: ConnectionListQuerySchema },
  responses: {
    200: {
      description: 'Connection list',
      content: { 'application/json': { schema: ConnectionListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createConnectionRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createConnection',
  tags: ['Connections'],
  summary: 'Create a connector connection',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateConnectionSchema } } } },
  responses: {
    201: { description: 'Created connection', content: { 'application/json': { schema: ConnectionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Connector not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'Connection already exists or credential unavailable',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const readConnectionRoute = createRoute({
  method: 'get',
  path: '/{connectionId}',
  operationId: 'readConnection',
  tags: ['Connections'],
  summary: 'Read connection',
  ...AuthenticatedOperation,
  request: { params: ConnectionParamsSchema },
  responses: {
    200: { description: 'Connection', content: { 'application/json': { schema: ConnectionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateConnectionRoute = createRoute({
  method: 'patch',
  path: '/{connectionId}',
  operationId: 'updateConnection',
  tags: ['Connections'],
  summary: 'Update connection state, credential, or settings',
  ...AuthenticatedOperation,
  request: {
    params: ConnectionParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateConnectionSchema } } },
  },
  responses: {
    200: { description: 'Connection', content: { 'application/json': { schema: ConnectionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Credential unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listToolsRoute = createRoute({
  method: 'get',
  path: '/{connectionId}/tools',
  operationId: 'listConnectionTools',
  tags: ['Connections'],
  summary: 'List connection tools',
  ...AuthenticatedOperation,
  request: { params: ConnectionParamsSchema },
  responses: {
    200: {
      description: 'Connection tools',
      content: { 'application/json': { schema: ConnectionToolListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Connection unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
    502: { description: 'MCP upstream error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listToolCallsRoute = createRoute({
  method: 'get',
  path: '/{connectionId}/tools/{toolName}/calls',
  operationId: 'listToolCalls',
  tags: ['Connections'],
  summary: 'List tool calls',
  ...AuthenticatedOperation,
  request: { params: ToolParamsSchema, query: ToolCallListQuerySchema },
  responses: {
    200: { description: 'Tool call list', content: { 'application/json': { schema: ToolCallListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Connection not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createToolCallRoute = createRoute({
  method: 'post',
  path: '/{connectionId}/tools/{toolName}/calls',
  operationId: 'createToolCall',
  tags: ['Connections'],
  summary: 'Execute a connection tool through the AMA policy boundary',
  ...AuthenticatedOperation,
  request: {
    params: ToolParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateToolCallSchema } } },
  },
  responses: {
    201: {
      description: 'Tool call executed and recorded (state reports success or error)',
      headers: z.object({ Location: z.string().openapi({ description: 'URI of the created tool call resource' }) }),
      content: { 'application/json': { schema: ToolCallSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Connection, session, or tool not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: {
      description: 'Approval required or connection unavailable',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const readToolCallRoute = createRoute({
  method: 'get',
  path: '/{connectionId}/tools/{toolName}/calls/{callId}',
  operationId: 'readToolCall',
  tags: ['Connections'],
  summary: 'Read tool call',
  ...AuthenticatedOperation,
  request: { params: ToolCallParamsSchema },
  responses: {
    200: { description: 'Tool call', content: { 'application/json': { schema: ToolCallSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Tool call not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listConnectionsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const { state, limit = 50, cursor } = c.req.valid('query')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
    }
    const filters = [
      eq(connections.projectId, auth.project.id),
      state ? eq(connections.state, state) : undefined,
      parsedCursor
        ? or(
            lt(connections.createdAt, parsedCursor.createdAt),
            and(eq(connections.createdAt, parsedCursor.createdAt), lt(connections.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(connections)
      .where(and(...filters))
      .orderBy(desc(connections.createdAt), desc(connections.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeConnection), pagination: page.pagination }, 200)
  })
  .openapi(createConnectionRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    await seedConnectorCatalog(db)
    const catalog = await db.select().from(connectors).where(eq(connectors.id, body.connectorId)).get()
    if (!catalog) return errorResponse(c, 404, 'not_found', 'Connector not found')
    if (catalog.availability !== 'available') return errorResponse(c, 409, 'conflict', 'Connector is unavailable')
    const effective = await resolveEffectivePolicy(db, auth)
    if (connectorPolicyEffect(effective.mcpPolicy, body.connectorId) === 'blocked') {
      await recordAudit(db, {
        auth,
        action: 'connection.create',
        resourceType: 'connector',
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
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.projectId, auth.project.id), eq(connections.connectorId, body.connectorId)))
      .get()
    if (existing) {
      return errorResponse(c, 409, 'conflict', 'A connection for this connector already exists in the project.', {
        connectorId: body.connectorId,
        connectionId: existing.id,
      })
    }

    let credential: { credentialId: string | null; credentialVersionId: string | null }
    try {
      credential = await resolveCredential(db, auth, body.credentialRef ?? null)
    } catch (error) {
      return errorResponse(c, 409, 'conflict', error instanceof Error ? error.message : 'Credential is unavailable.', {
        fields: { credentialRef: 'Credential is unavailable.' },
      })
    }
    if (requiresVaultCredential(catalog) && !credential.credentialVersionId) {
      return c.json(
        validation('Connector requires a vault credential reference.', {
          credentialRef: 'Credential is required for this connector.',
        }),
        400,
      )
    }
    const timestamp = now()
    const row = {
      id: newId('conn'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      connectorId: body.connectorId,
      credentialId: credential.credentialId,
      credentialVersionId: credential.credentialVersionId,
      endpointUrl: body.endpointUrl ?? null,
      approvalMode: body.approvalMode ?? 'project_policy',
      state: 'connected',
      lastError: null,
      metadata: stringify(body.metadata ?? {}),
      connectedAt: timestamp,
      disconnectedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(connections).values(row)
    await replaceConnectionTools(db, auth, row, catalog)
    await recordAudit(db, {
      auth,
      action: 'connection.create',
      resourceType: 'connection',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serializeConnection(row),
    })
    return c.json(serializeConnection(row), 201, { Location: `/api/v1/connections/${row.id}` })
  })
  .openapi(readConnectionRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
    if (!connection) return errorResponse(c, 404, 'not_found', 'Connection not found')
    return c.json(serializeConnection(connection), 200)
  })
  .openapi(updateConnectionRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
    if (!connection) return errorResponse(c, 404, 'not_found', 'Connection not found')
    const catalog = await db.select().from(connectors).where(eq(connectors.id, connection.connectorId)).get()
    if (!catalog) return errorResponse(c, 404, 'not_found', 'Connector not found')
    let credential = {
      credentialId: connection.credentialId,
      credentialVersionId: connection.credentialVersionId,
    }
    if (body.credentialRef !== undefined) {
      try {
        credential = await resolveCredential(db, auth, body.credentialRef)
      } catch (error) {
        return errorResponse(
          c,
          409,
          'conflict',
          error instanceof Error ? error.message : 'Credential is unavailable.',
          { fields: { credentialRef: 'Credential is unavailable.' } },
        )
      }
    }
    if (requiresVaultCredential(catalog) && !credential.credentialVersionId) {
      return c.json(
        validation('Connector requires a vault credential reference.', {
          credentialRef: 'Credential is required for this connector.',
        }),
        400,
      )
    }
    const timestamp = now()
    const state = body.state ?? connection.state
    const row = {
      ...connection,
      credentialId: credential.credentialId,
      credentialVersionId: credential.credentialVersionId,
      endpointUrl: body.endpointUrl === undefined ? connection.endpointUrl : body.endpointUrl,
      approvalMode: body.approvalMode ?? connection.approvalMode,
      state,
      // Disconnect is a state transition, not a delete: the connection stays
      // addressable and can be reconnected with PATCH {state:'connected'}.
      disconnectedAt:
        body.state === 'disconnected' ? timestamp : body.state === 'connected' ? null : connection.disconnectedAt,
      metadata: stringify(body.metadata ?? parseJson(connection.metadata, {})),
      updatedAt: timestamp,
    }
    await db.update(connections).set(row).where(eq(connections.id, connection.id))
    await recordAudit(db, {
      auth,
      action: 'connection.update',
      resourceType: 'connection',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeConnection(connection),
      after: serializeConnection(row),
    })
    return c.json(serializeConnection(row), 200)
  })
  .openapi(listToolsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const connection = await findConnection(db, auth, c.req.valid('param').connectionId)
    if (!connection) return errorResponse(c, 404, 'not_found', 'Connection not found')
    if (connection.state !== 'connected') return errorResponse(c, 409, 'conflict', 'Connection is not connected')
    // Connections with a configured endpoint list tools from the live MCP
    // server through the MCP client; the synced rows become the policy surface
    // for subsequent tool calls. Endpoint-less connections keep serving the
    // catalog tool metadata captured at connect time.
    if (connection.endpointUrl) {
      try {
        const target = await mcpClientTarget(c.env, db, auth, connection, connection.endpointUrl)
        const serverTools = await listMcpServerTools(target)
        await syncConnectionToolsFromServer(db, auth, connection, serverTools)
      } catch (error) {
        const normalized = normalizedMcpError(error)
        return errorResponse(c, 502, 'mcp_error', normalized.message, { mcpError: normalized })
      }
    }
    const rows = await db
      .select()
      .from(connectionTools)
      .where(and(eq(connectionTools.connectionId, connection.id), eq(connectionTools.availability, 'available')))
      .orderBy(desc(connectionTools.createdAt), desc(connectionTools.id))
    return c.json(
      {
        data: rows.map(serializeTool),
        pagination: { limit: rows.length, nextCursor: null, hasMore: false },
      },
      200,
    )
  })
  .openapi(listToolCallsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const { connectionId, toolName } = c.req.valid('param')
    const { limit = 50, cursor } = c.req.valid('query')
    const connection = await findConnection(db, auth, connectionId)
    if (!connection) return errorResponse(c, 404, 'not_found', 'Connection not found')
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
    }
    const filters = [
      eq(toolCalls.projectId, auth.project.id),
      eq(toolCalls.connectionId, connection.id),
      eq(toolCalls.toolName, toolName),
      parsedCursor
        ? or(
            lt(toolCalls.createdAt, parsedCursor.createdAt),
            and(eq(toolCalls.createdAt, parsedCursor.createdAt), lt(toolCalls.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(toolCalls)
      .where(and(...filters))
      .orderBy(desc(toolCalls.createdAt), desc(toolCalls.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeToolCall), pagination: page.pagination }, 200)
  })
  .openapi(createToolCallRoute, async (c) => {
    const body = c.req.valid('json')
    const { connectionId, toolName } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const connection = await findConnection(db, auth, connectionId)
    if (!connection) return errorResponse(c, 404, 'not_found', 'Connection not found')
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
      .from(connectionTools)
      .where(and(eq(connectionTools.connectionId, connection.id), eq(connectionTools.name, toolName)))
      .get()
    if (tool?.availability !== 'available') return errorResponse(c, 404, 'not_found', 'Connection tool not found')

    const toolCallId = newId('call')
    const input = body.input ?? {}
    const decision = await evaluateMcpToolPolicy(db, auth, {
      connectorId: connection.connectorId,
      toolName,
      session,
    })
    await appendMcpSessionEvent(db, {
      auth,
      sessionId: session.id,
      type: 'policy.decision',
      correlationId: toolCallId,
      payload: {
        allowed: decision.allowed,
        category: decision.category,
        ruleId: decision.rule,
        resourceType: decision.category === 'tool' ? 'tool' : 'mcp_connector',
        resourceId: decision.category === 'tool' ? toolName : connection.connectorId,
        operation: 'mcp_tool_call',
        connectorId: connection.connectorId,
        toolName,
      },
    })
    if (!decision.allowed) {
      await recordAudit(db, {
        auth,
        action: 'connection_tool.call',
        resourceType: 'connection_tool',
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

    if (!connection.endpointUrl) {
      await recordAudit(db, {
        auth,
        action: 'connection_tool.call',
        resourceType: 'connection_tool',
        resourceId: tool.id,
        outcome: 'failure',
        requestId: requestId(c),
        sessionId: session.id,
        metadata: { connectorId: connection.connectorId, toolName, reason: 'endpoint_not_configured' },
      })
      return errorResponse(c, 409, 'conflict', 'Connection endpoint is not configured.')
    }

    const startEventId = await appendMcpSessionEvent(db, {
      auth,
      sessionId: session.id,
      type: 'tool_execution_start',
      correlationId: toolCallId,
      payload: { toolCallId, toolName, connectorId: connection.connectorId, input },
    })

    const started = Date.now()
    let callResult: Awaited<ReturnType<typeof callMcpServerTool>> | null = null
    let failure: { type: string; message: string } | null = null
    try {
      validateToolInput(tool, input)
      const target = await mcpClientTarget(c.env, db, auth, connection, connection.endpointUrl)
      callResult = await callMcpServerTool(target, { toolName, input })
      if (callResult.isError) {
        throw new McpClientError('upstream', callResult)
      }
    } catch (error) {
      failure = normalizedMcpError(error)
    }
    const durationMs = Date.now() - started

    if (failure || !callResult) {
      const normalized = failure ?? NORMALIZED_MCP_ERRORS.upstream
      const row = {
        id: toolCallId,
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        connectionId: connection.id,
        connectorId: connection.connectorId,
        toolName,
        sessionId: session.id,
        input: stringify(redactSensitiveValue(input)),
        output: null,
        state: 'error',
        error: stringify(normalized),
        durationMs,
        createdAt: now(),
      }
      await db.insert(toolCalls).values(row)
      await appendMcpSessionEvent(db, {
        auth,
        sessionId: session.id,
        type: 'tool_execution_end',
        parentEventId: startEventId,
        correlationId: toolCallId,
        payload: {
          toolCallId,
          toolName,
          connectorId: connection.connectorId,
          isError: true,
          durationMs,
          error: normalized,
        },
      })
      await recordAudit(db, {
        auth,
        action: 'connection_tool.call',
        resourceType: 'connection_tool',
        resourceId: tool.id,
        outcome: 'failure',
        requestId: requestId(c),
        sessionId: session.id,
        metadata: { connectorId: connection.connectorId, toolName, durationMs, error: normalized },
      })
      return c.json(serializeToolCall(row), 201, { Location: toolCallLocation(row) })
    }

    const output: Record<string, unknown> = {
      content: callResult.content,
      ...(callResult.structuredContent ? { structuredContent: callResult.structuredContent } : {}),
    }
    const row = {
      id: toolCallId,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      connectionId: connection.id,
      connectorId: connection.connectorId,
      toolName,
      sessionId: session.id,
      input: stringify(redactSensitiveValue(input)),
      output: stringify(redactSensitiveValue(output)),
      state: 'success',
      error: null,
      durationMs,
      createdAt: now(),
    }
    await db.insert(toolCalls).values(row)
    await appendMcpSessionEvent(db, {
      auth,
      sessionId: session.id,
      type: 'tool_execution_end',
      parentEventId: startEventId,
      correlationId: toolCallId,
      payload: {
        toolCallId,
        toolName,
        connectorId: connection.connectorId,
        isError: false,
        durationMs,
        outputSummary: {
          contentItems: callResult.content.length,
          hasStructuredContent: !!callResult.structuredContent,
        },
      },
    })
    await recordAudit(db, {
      auth,
      action: 'connection_tool.call',
      resourceType: 'connection_tool',
      resourceId: tool.id,
      outcome: 'success',
      requestId: requestId(c),
      sessionId: session.id,
      metadata: {
        connectorId: connection.connectorId,
        toolName,
        state: 'success',
        durationMs,
        inputSummary: Object.keys(input),
        outputSummary: { contentItems: callResult.content.length },
      },
    })
    return c.json(serializeToolCall(row), 201, { Location: toolCallLocation(row) })
  })
  .openapi(readToolCallRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const { connectionId, toolName, callId } = c.req.valid('param')
    const row = await db
      .select()
      .from(toolCalls)
      .where(
        and(
          eq(toolCalls.id, callId),
          eq(toolCalls.projectId, auth.project.id),
          eq(toolCalls.connectionId, connectionId),
          eq(toolCalls.toolName, toolName),
        ),
      )
      .get()
    if (!row) return errorResponse(c, 404, 'not_found', 'Tool call not found')
    return c.json(serializeToolCall(row), 200)
  })

export default routes
