import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  CONNECTION_APPROVAL_MODES,
  CONNECTION_STATES,
  credentialRef,
  TOOL_AVAILABILITIES,
  TOOL_CALL_STATES,
} from '@server/domain/connection'
import { requireAuth } from '../auth/session'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  CredentialRefSchema,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import {
  createConnection,
  executeToolCall,
  listConnectionTools,
  type UpdateConnectionPatch,
  updateConnection,
} from '../usecases/connections'
import {
  type AuthScope,
  ConnectionConflictError,
  ConnectionPolicyDeniedError,
  type ConnectionRecord,
  type ConnectionToolRecord,
  ConnectionValidationError,
  type ToolCallRecord,
} from '../usecases/ports'
import { requestId } from './request-context'

type ConnectionRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

const ConnectionSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    connectorId: z.string(),
    credentialRef: CredentialRefSchema.nullable(),
    endpointUrl: z.string().nullable(),
    approvalMode: z.enum(CONNECTION_APPROVAL_MODES),
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
    approvalMode: z.enum(CONNECTION_APPROVAL_MODES),
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
    approvalMode: z.enum(CONNECTION_APPROVAL_MODES).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreateConnectionRequest')

const UpdateConnectionSchema = z
  .object({
    endpointUrl: z.string().url().nullable().optional(),
    credentialRef: CredentialRefSchema.nullable().optional(),
    approvalMode: z.enum(CONNECTION_APPROVAL_MODES).optional(),
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

function validation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

function serializeConnection(record: ConnectionRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    connectorId: record.connectorId,
    credentialRef: credentialRef(record),
    endpointUrl: record.endpointUrl,
    approvalMode: record.approvalMode,
    state: record.state,
    lastError: record.lastError,
    metadata: record.metadata,
    connectedAt: record.connectedAt,
    disconnectedAt: record.disconnectedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeTool(record: ConnectionToolRecord) {
  return {
    id: record.id,
    connectionId: record.connectionId,
    connectorId: record.connectorId,
    name: record.name,
    description: record.description,
    inputSchema: record.inputSchema,
    approvalMode: record.approvalMode,
    policyMetadata: record.policyMetadata,
    availability: record.availability,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeToolCall(record: ToolCallRecord) {
  return {
    id: record.id,
    connectionId: record.connectionId,
    connectorId: record.connectorId,
    toolName: record.toolName,
    sessionId: record.sessionId,
    state: record.state,
    input: record.input,
    output: record.output,
    error: record.error,
    durationMs: record.durationMs,
    createdAt: record.createdAt,
  }
}

function toolCallLocation(record: { id: string; connectionId: string; toolName: string }) {
  return `/api/v1/connections/${record.connectionId}/tools/${encodeURIComponent(record.toolName)}/calls/${record.id}`
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
    200: { description: 'Connection list', content: { 'application/json': { schema: ConnectionListResponseSchema } } },
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

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the connections resource's original mount position.
export function registerConnectionRoutes(routes: ConnectionRoutes) {
  return routes
    .openapi(listConnectionsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { state, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.connections.list({
        projectId: auth.project.id,
        ...(state ? { state } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeConnection), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createConnectionRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = auth
      await deps.connectors.seedCatalog()
      const catalog = await deps.connectors.find(body.connectorId)
      if (!catalog) {
        return errorResponse(c, 404, 'not_found', 'Connector not found')
      }
      let connection: ConnectionRecord
      try {
        connection = await createConnection(deps, scope, catalog, {
          connectorId: body.connectorId,
          endpointUrl: body.endpointUrl ?? null,
          credentialRef: body.credentialRef ?? null,
          approvalMode: body.approvalMode,
          metadata: body.metadata ?? {},
        })
      } catch (error) {
        return createConnectionError(c, scope, deps, error)
      }
      await deps.audit.record(scope, {
        action: 'connection.create',
        resourceType: 'connection',
        resourceId: connection.id,
        outcome: 'success',
        requestId: requestId(c),
        after: serializeConnection(connection),
      })
      return c.json(serializeConnection(connection), 201, { Location: `/api/v1/connections/${connection.id}` })
    })
    .openapi(readConnectionRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const connection = await deps.connections.find(auth.project.id, c.req.valid('param').connectionId)
      if (!connection) {
        return errorResponse(c, 404, 'not_found', 'Connection not found')
      }
      return c.json(serializeConnection(connection), 200)
    })
    .openapi(updateConnectionRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = auth
      const connection = await deps.connections.find(auth.project.id, c.req.valid('param').connectionId)
      if (!connection) {
        return errorResponse(c, 404, 'not_found', 'Connection not found')
      }
      const catalog = await deps.connectors.find(connection.connectorId)
      if (!catalog) {
        return errorResponse(c, 404, 'not_found', 'Connector not found')
      }
      let updated: ConnectionRecord
      try {
        updated = await updateConnection(deps, scope, connection, catalog, patchFromBody(body))
      } catch (error) {
        return updateConnectionError(c, error)
      }
      await deps.audit.record(scope, {
        action: 'connection.update',
        resourceType: 'connection',
        resourceId: updated.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeConnection(connection),
        after: serializeConnection(updated),
      })
      return c.json(serializeConnection(updated), 200)
    })
    .openapi(listToolsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const connection = await deps.connections.find(auth.project.id, c.req.valid('param').connectionId)
      if (!connection) {
        return errorResponse(c, 404, 'not_found', 'Connection not found')
      }
      let tools: ConnectionToolRecord[]
      try {
        tools = await listConnectionTools(deps, connection)
      } catch (error) {
        if (error instanceof ConnectionConflictError) {
          return errorResponse(c, 409, 'conflict', error.message)
        }
        const normalized = deps.mcp.normalizeError(error)
        return errorResponse(c, 502, 'mcp_error', normalized.message, { mcpError: normalized })
      }
      return c.json(
        { data: tools.map(serializeTool), pagination: { limit: tools.length, nextCursor: null, hasMore: false } },
        200,
      )
    })
    .openapi(listToolCallsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { connectionId, toolName } = c.req.valid('param')
      const { limit = 50, cursor } = c.req.valid('query')
      const connection = await deps.connections.find(auth.project.id, connectionId)
      if (!connection) {
        return errorResponse(c, 404, 'not_found', 'Connection not found')
      }
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(validation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.connections.listToolCalls({
        projectId: auth.project.id,
        connectionId: connection.id,
        toolName,
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeToolCall), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createToolCallRoute, async (c) => {
      const body = c.req.valid('json')
      const { connectionId, toolName } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = auth
      const connection = await deps.connections.find(auth.project.id, connectionId)
      if (!connection) {
        return errorResponse(c, 404, 'not_found', 'Connection not found')
      }
      const session = await deps.connections.findSession(auth.project.id, body.sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const tool = await deps.connections.findTool(connection.id, toolName)
      if (tool?.availability !== 'available') {
        return errorResponse(c, 404, 'not_found', 'Connection tool not found')
      }
      const outcome = await executeToolCall(deps, scope, connection, session, tool, toolName, body.input ?? {})
      if (outcome.kind === 'denied') {
        const decision = outcome.decision
        await deps.audit.record(scope, {
          action: 'connection_tool.call',
          resourceType: 'connection_tool',
          resourceId: outcome.toolId,
          outcome: 'denied',
          requestId: requestId(c),
          sessionId: session.id,
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
      if (outcome.kind === 'endpoint_missing') {
        await deps.audit.record(scope, {
          action: 'connection_tool.call',
          resourceType: 'connection_tool',
          resourceId: outcome.toolId,
          outcome: 'failure',
          requestId: requestId(c),
          sessionId: session.id,
          metadata: {
            connectorId: connection.connectorId,
            toolName,
            reason: 'endpoint_not_configured',
          },
        })
        return errorResponse(c, 409, 'conflict', 'Connection endpoint is not configured.')
      }
      const record = outcome.record
      await deps.audit.record(scope, {
        action: 'connection_tool.call',
        resourceType: 'connection_tool',
        resourceId: tool.id,
        outcome: record.state === 'success' ? 'success' : 'failure',
        requestId: requestId(c),
        sessionId: session.id,
        metadata: {
          connectorId: connection.connectorId,
          toolName,
          state: record.state,
          durationMs: record.durationMs,
          ...(record.state === 'success' ? { inputSummary: Object.keys(record.input) } : { error: record.error }),
        },
      })
      return c.json(serializeToolCall(record), 201, { Location: toolCallLocation(record) })
    })
    .openapi(readToolCallRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { connectionId, toolName, callId } = c.req.valid('param')
      const record = await deps.connections.findToolCall(auth.project.id, connectionId, toolName, callId)
      if (!record) {
        return errorResponse(c, 404, 'not_found', 'Tool call not found')
      }
      return c.json(serializeToolCall(record), 200)
    })
}

// --- helpers ---

function patchFromBody(body: z.infer<typeof UpdateConnectionSchema>): UpdateConnectionPatch {
  return {
    ...(body.endpointUrl !== undefined ? { endpointUrl: body.endpointUrl } : {}),
    ...(body.credentialRef !== undefined ? { credentialRef: body.credentialRef } : {}),
    ...(body.approvalMode !== undefined ? { approvalMode: body.approvalMode } : {}),
    ...(body.state !== undefined ? { state: body.state } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  }
}

async function createConnectionError(
  c: Parameters<Parameters<ConnectionRoutes['openapi']>[1]>[0],
  scope: AuthScope,
  deps: ReturnType<Parameters<Parameters<ConnectionRoutes['openapi']>[1]>[0]['get']>,
  error: unknown,
) {
  if (error instanceof ConnectionPolicyDeniedError) {
    await deps.audit.record(scope, {
      action: 'connection.create',
      resourceType: 'connector',
      resourceId: error.connectorId,
      outcome: 'denied',
      requestId: requestId(c),
      metadata: { connectorId: error.connectorId },
    })
    return errorResponse(c, 403, 'policy_denied', error.message, {
      category: 'mcp',
      resourceType: 'mcp_connector',
      resourceId: error.connectorId,
    })
  }
  if (error instanceof ConnectionValidationError) {
    return c.json(validation(error.message, error.fields), 400)
  }
  if (error instanceof ConnectionConflictError) {
    return errorResponse(c, 409, 'conflict', error.message, error.details)
  }
  throw error
}

function updateConnectionError(c: Parameters<Parameters<ConnectionRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof ConnectionValidationError) {
    return c.json(validation(error.message, error.fields), 400)
  }
  if (error instanceof ConnectionConflictError) {
    return errorResponse(c, 409, 'conflict', error.message, error.details)
  }
  throw error
}
