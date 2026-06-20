import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { AMA_SESSION_EVENT_TYPES } from '@shared/session-events'
import type { Context } from 'hono'
import { isRunnerOidcAuth, requireAuth, requireSessionEventsAuth } from '../auth/session'
import {
  EnvironmentHostingModeSchema,
  EnvironmentNetworkPolicySchema,
  RuntimeSchema,
} from '../contracts/environment-contracts'
import { ResourceRefSchema } from '../contracts/execution-spec'
import { type PendingSessionApproval, sessionApprovalState } from '../domain/runtime/approval-state'
import { type ErrorType, errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  csvResponse,
  type DepsEnv,
  ErrorResponseSchema,
  eventListQuerySchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  negotiateMediaType,
  parseListCursor,
  SecretEnvEntrySchema,
} from '../openapi'
import { redactSensitiveValue } from '../redaction'
import {
  type SessionApprovalRecord,
  type SessionConnectionRecord,
  type SessionEventRecord,
  type SessionMessageRecord,
  type SessionRecord,
  type SessionRuntimeError,
  SessionValidationError,
} from '../usecases/ports'
import {
  createSession as createRuntimeSession,
  decideApproval as decideRuntimeApproval,
  markExpiredPending as markRuntimeExpiredPending,
} from '../usecases/runtime/sessions'
import { sendSessionMessage, type UpdateSessionPatch, updateSession } from '../usecases/sessions'
import { requestId } from './request-context'

type SessionRoutes = OpenAPIHono<DepsEnv>

const SESSION_STATES = ['pending', 'running', 'idle', 'stopped', 'error'] as const
const EVENT_VISIBILITIES = ['runtime', 'transcript', 'debug', 'audit'] as const
const MESSAGE_DELIVERIES = ['live', 'queued'] as const
const MESSAGE_STATES = ['accepted', 'delivered', 'failed'] as const
const APPROVAL_STATES = ['pending', 'approved', 'denied'] as const
const MAX_EVENT_BATCH = 100

const JsonObjectSchema = z.record(z.string(), z.unknown())

const AgentVersionSnapshotSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    instructions: z.string().nullable(),
    providerId: z.string().openapi({ example: 'workers-ai' }),
    model: z.string().nullable(),
    skills: z.array(z.string()),
    subagents: z.array(JsonObjectSchema),
    role: z.string().nullable(),
    capabilityTags: z.array(z.string()),
    handoffPolicy: JsonObjectSchema,
    memoryPolicy: JsonObjectSchema,
    tools: z.array(JsonObjectSchema),
    mcpConnectors: z.array(z.string()),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionAgentSnapshot')

const EnvironmentVersionSnapshotSchema = z
  .object({
    id: z.string(),
    environmentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    packages: z.array(JsonObjectSchema),
    variables: JsonObjectSchema,
    credentialRefs: z.array(JsonObjectSchema),
    hostingMode: EnvironmentHostingModeSchema,
    networkPolicy: EnvironmentNetworkPolicySchema,
    mcpPolicy: JsonObjectSchema,
    packageManagerPolicy: JsonObjectSchema,
    resourceLimits: JsonObjectSchema,
    runtimeConfig: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionEnvironmentSnapshot')

const SessionRuntimeMetadataSchema = z
  .object({
    hostingMode: EnvironmentHostingModeSchema,
    runtime: RuntimeSchema,
    runtimeConfig: JsonObjectSchema,
    provider: z.string().openapi({ example: 'workers-ai' }),
    model: z.string().nullable().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    driver: z.string().nullable().openapi({ example: 'ama-cloud' }),
    backend: z.string().nullable().openapi({ example: 'ama-cloud' }),
    protocol: z.string().nullable().openapi({ example: 'ama-runtime-rpc' }),
  })
  .openapi('SessionRuntimeMetadata')

const SessionSchema = z
  .object({
    id: z.string().openapi({ example: 'session_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    agentVersionId: z.string().openapi({ example: 'agentver_abc123' }),
    agentSnapshot: AgentVersionSnapshotSchema,
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    environmentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    environmentSnapshot: EnvironmentVersionSnapshotSchema.nullable(),
    title: z.string().nullable().openapi({ example: 'Implement billing export' }),
    resourceRefs: z
      .array(ResourceRefSchema)
      .openapi({ example: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }] }),
    env: z.record(z.string(), z.string()).openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    secretEnv: z.array(SecretEnvEntrySchema).openapi({
      example: [
        { name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'vaultcred_abc123', versionId: 'vaultver_abc123' } },
      ],
    }),
    runtimeMetadata: SessionRuntimeMetadataSchema,
    state: z.enum(SESSION_STATES).openapi({ example: 'idle' }),
    stateReason: z.string().nullable(),
    metadata: JsonObjectSchema,
    startedAt: z.string().datetime().nullable(),
    stoppedAt: z.string().datetime().nullable(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Session')

const SessionEventSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    sessionId: z.string(),
    sequence: z.number().int(),
    type: z.enum(AMA_SESSION_EVENT_TYPES),
    visibility: z.enum(EVENT_VISIBILITIES),
    role: z.string().nullable(),
    parentEventId: z.string().nullable(),
    correlationId: z.string().nullable(),
    payload: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionEvent')

const CreateSessionSchema = z
  .object({
    agentId: z.string().min(1).openapi({ example: 'agent_abc123' }),
    // Optional: omit to let the session resolve a runner-capable environment
    // for the runtime instead of pinning one.
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    runtimeConfig: JsonObjectSchema.optional().openapi({ example: { sandboxMode: 'workspace-write' } }),
    title: z.string().min(1).max(160).optional().openapi({ example: 'Implement billing export' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { ticket: 'AMA-123' } }),
    resourceRefs: z
      .array(ResourceRefSchema)
      .max(50)
      .optional()
      .openapi({ example: [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }] }),
    env: z
      .record(z.string(), z.string())
      .optional()
      .openapi({ example: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_abc123' } }),
    secretEnv: z
      .array(SecretEnvEntrySchema)
      .max(50)
      .optional()
      .openapi({ example: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'vaultcred_abc123' } }] }),
    initialPrompt: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .optional()
      .openapi({ example: 'Research Canadian banking bonus offers and summarize current opportunities.' }),
    providerAccessOverride: z.boolean().optional().openapi({ example: false }),
  })
  .strict()
  .openapi('CreateSessionRequest')

const UpdateSessionSchema = z
  .object({
    title: z.string().min(1).max(160).nullable().optional().openapi({ example: 'Implement billing export' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { ticket: 'AMA-123' } }),
    state: z.literal('stopped').optional().openapi({ example: 'stopped' }),
    archived: z.boolean().optional().openapi({ example: true }),
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined ||
      body.metadata !== undefined ||
      body.state !== undefined ||
      body.archived !== undefined,
    { message: 'Provide at least one of title, metadata, state, or archived.' },
  )
  .openapi('UpdateSessionRequest')

const SessionConnectionSchema = z
  .object({
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    transport: z.string().nullable().openapi({
      example: 'ama-runtime-rpc',
      description: 'Runtime protocol the connection path speaks.',
    }),
    path: z.string().nullable().openapi({
      example: '/api/v1/runtime/sessions/session_abc123/rpc',
      description: 'Public runtime proxy path to reconnect to; null while no runtime endpoint is attached.',
    }),
    state: z.enum(SESSION_STATES).openapi({ example: 'idle' }),
    stateReason: z.string().nullable(),
  })
  .openapi('SessionConnection')

const SessionMessageSchema = z
  .object({
    id: z.string().openapi({ example: 'msg_abc123' }),
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    content: z.string().openapi({ example: 'Please continue the task and summarize the current blocker.' }),
    delivery: z.enum(MESSAGE_DELIVERIES).openapi({ example: 'queued' }),
    state: z.enum(MESSAGE_STATES).openapi({ example: 'accepted' }),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('SessionMessage')

const CreateSessionMessageSchema = z
  .object({
    type: z.literal('prompt').openapi({ example: 'prompt' }),
    content: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .openapi({ example: 'Please continue the task and summarize the current blocker.' }),
  })
  .strict()
  .openapi('CreateSessionMessageRequest')

const SessionEventInputSchema = z
  .object({ type: z.string().min(1).max(120), payload: JsonObjectSchema, metadata: JsonObjectSchema.optional() })
  .strict()
  .openapi('SessionEventInput')

const CreateSessionEventsSchema = z
  .object({ events: z.array(SessionEventInputSchema).min(1).max(MAX_EVENT_BATCH) })
  .strict()
  .openapi('CreateSessionEventsRequest')

const SessionEventsAcceptedSchema = z
  .object({ accepted: z.number().int().openapi({ example: 3 }) })
  .openapi('SessionEventsAccepted')

const SessionApprovalSchema = z
  .object({
    id: z.string().openapi({ example: 'approval_abc123' }),
    sessionId: z.string().openapi({ example: 'session_abc123' }),
    toolCallId: z.string().openapi({ example: 'call_git_status' }),
    toolName: z.string().openapi({ example: 'sandbox.exec' }),
    input: JsonObjectSchema,
    relatedEventIds: z.array(z.string()).openapi({ example: ['event_abc123'] }),
    state: z.enum(APPROVAL_STATES).openapi({ example: 'pending' }),
    reason: z.string().nullable().openapi({ example: 'Looks safe' }),
    result: JsonObjectSchema.nullable().openapi({
      description: 'Caller-provided custom tool result recorded instead of executing the tool.',
    }),
    requestedAt: z.string().datetime().openapi({ example: '2026-06-12T12:00:00.000Z' }),
    decidedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('SessionApproval')

const SessionApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'deny']).openapi({ example: 'approve' }),
    reason: z.string().max(500).optional().openapi({ example: 'Looks safe' }),
    result: JsonObjectSchema.optional().openapi({
      description: 'Caller-provided custom tool result recorded instead of executing the tool',
    }),
  })
  .strict()
  .openapi('SessionApprovalDecisionRequest')

const ParamsSchema = z.object({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' }, example: 'session_abc123' }),
})
const MessageParamsSchema = ParamsSchema.extend({
  messageId: z.string().openapi({ param: { name: 'messageId', in: 'path' }, example: 'msg_abc123' }),
})
const ApprovalParamsSchema = ParamsSchema.extend({
  approvalId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'approvalId', in: 'path' }, example: 'approval_abc123' }),
})

const ListQuerySchema = listQuerySchema().extend({
  state: z
    .enum(SESSION_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'idle' }),
})
const MessageListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 50 }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({ param: { name: 'cursor', in: 'query' } }),
})
const EventsQuerySchema = eventListQuerySchema().extend({
  type: z
    .enum(AMA_SESSION_EVENT_TYPES)
    .optional()
    .openapi({ param: { name: 'type', in: 'query' }, example: 'message_end' }),
  visibility: z
    .enum(EVENT_VISIBILITIES)
    .optional()
    .openapi({ param: { name: 'visibility', in: 'query' }, example: 'runtime' }),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdFrom', in: 'query' }, example: '2026-05-01T00:00:00.000Z' }),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .openapi({ param: { name: 'createdTo', in: 'query' }, example: '2026-05-31T23:59:59.999Z' }),
})
const SessionListResponseSchema = listResponseSchema('SessionListResponse', SessionSchema)
const SessionEventListResponseSchema = listResponseSchema('SessionEventListResponse', SessionEventSchema)
const SessionMessageListResponseSchema = listResponseSchema('SessionMessageListResponse', SessionMessageSchema)
const SessionApprovalListResponseSchema = listResponseSchema('SessionApprovalListResponse', SessionApprovalSchema)

// --- serialization (identity from records) ---
// The DTO records carry loosely-typed nested objects (Record<string, unknown>),
// while the OpenAPI response schemas describe the concrete shape. The records
// already match those shapes structurally (the repo builds them from the same
// snapshots), so serialization is identity with a cast to the schema-inferred
// type so the typed-response routes accept them.

function serializeSession(record: SessionRecord): z.infer<typeof SessionSchema> {
  // The JSON snapshot columns are typed loosely on the record but structurally
  // match these schemas (the repo builds them from the same serializers), so each
  // loose field is narrowed at this boundary instead of laundering the whole DTO.
  return {
    id: record.id,
    projectId: record.projectId,
    agentId: record.agentId,
    agentVersionId: record.agentVersionId,
    agentSnapshot: record.agentSnapshot as z.infer<typeof AgentVersionSnapshotSchema>,
    environmentId: record.environmentId,
    environmentVersionId: record.environmentVersionId,
    environmentSnapshot: record.environmentSnapshot as z.infer<typeof EnvironmentVersionSnapshotSchema> | null,
    title: record.title,
    resourceRefs: record.resourceRefs as z.infer<typeof ResourceRefSchema>[],
    env: record.env,
    secretEnv: record.secretEnv,
    runtimeMetadata: record.runtimeMetadata as z.infer<typeof SessionRuntimeMetadataSchema>,
    state: record.state as z.infer<typeof SessionSchema>['state'],
    stateReason: record.stateReason,
    metadata: record.metadata,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeConnection(record: SessionConnectionRecord): z.infer<typeof SessionConnectionSchema> {
  return record as z.infer<typeof SessionConnectionSchema>
}

function serializeMessage(record: SessionMessageRecord): z.infer<typeof SessionMessageSchema> {
  return record as z.infer<typeof SessionMessageSchema>
}

function serializeApprovalRecord(record: SessionApprovalRecord): z.infer<typeof SessionApprovalSchema> {
  return record as z.infer<typeof SessionApprovalSchema>
}

function serializeEvent(record: SessionEventRecord): z.infer<typeof SessionEventSchema> {
  return record as z.infer<typeof SessionEventSchema>
}

function serializePendingApproval(
  sessionId: string,
  pending: PendingSessionApproval,
): z.infer<typeof SessionApprovalSchema> {
  return {
    id: pending.id,
    sessionId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    input: pending.input,
    relatedEventIds: pending.relatedEventIds,
    state: 'pending',
    reason: null,
    result: null,
    requestedAt: pending.requestedAt,
    decidedAt: null,
    createdAt: pending.requestedAt,
    updatedAt: pending.requestedAt,
  }
}

// Maps a runtime-gateway error to an error response. The runtime status is
// dynamic, so callers cast the result to `never` (the established http escape):
// the route's OpenAPI response set stays exactly as before the migration and
// only the (un-consumed) error AppType is widened.
function runtimeErrorResponse(c: Context<DepsEnv>, error: SessionRuntimeError) {
  return errorResponse(c, error.status, error.code as ErrorType, error.message, {
    ...(error.fields ? { fields: error.fields } : {}),
    ...(error.detail ?? {}),
  })
}

// ── Events content representations ──────────────────────────────────────────

type EventsQuery = z.infer<typeof EventsQuerySchema>

function eventsQueryFor(query: EventsQuery, limit: number) {
  return {
    ...(query.type ? { type: query.type } : {}),
    visibility: query.visibility ?? 'runtime',
    ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
    ...(query.createdTo ? { createdTo: query.createdTo } : {}),
    order: (query.order ?? 'asc') as 'asc' | 'desc',
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    limit,
  }
}

async function eventsJsonResponse(c: Context<DepsEnv>, sessionId: string, query: EventsQuery) {
  const deps = c.get('deps')
  const limit = query.limit ?? 100
  const page = await deps.sessions.queryEvents(sessionId, eventsQueryFor(query, limit))
  const last = page.rows.at(-1)
  const nextCursor = page.hasMore && last ? String(last.sequence) : null
  return c.json({ data: page.rows.map(serializeEvent), pagination: { limit, nextCursor, hasMore: page.hasMore } }, 200)
}

async function eventsCsvResponse(c: Context<DepsEnv>, sessionId: string, query: EventsQuery) {
  const deps = c.get('deps')
  const limit = query.limit ?? 200
  const page = await deps.sessions.queryEvents(sessionId, eventsQueryFor(query, limit + 1))
  const rows = page.rows.slice(0, limit)
  const header = [
    'id',
    'sessionId',
    'sequence',
    'type',
    'visibility',
    'role',
    'correlationId',
    'parentEventId',
    'createdAt',
    'payload',
    'metadata',
  ]
  const csvRows = rows.map((event) => [
    event.id,
    event.sessionId,
    String(event.sequence),
    event.type,
    event.visibility,
    event.role ?? '',
    event.correlationId ?? '',
    event.parentEventId ?? '',
    event.createdAt,
    JSON.stringify(event.payload),
    JSON.stringify(event.metadata),
  ])
  return csvResponse(c, `session-${sessionId}-events.csv`, header, csvRows)
}

// SSE streams new events for ~1s of polling. The route owns the ReadableStream
// and the Response; the AbortController is fired from BOTH teardown paths (the
// request signal AND ReadableStream.cancel) so a body-consumer cancel stops the
// poll loop instead of leaking a polling cycle.
function eventsSseResponse(c: Context<DepsEnv>, sessionId: string, query: EventsQuery) {
  const limit = query.limit ?? 200
  const order = query.order ?? 'asc'
  if (order === 'desc') {
    return errorResponse(c, 400, 'validation_error', 'Descending order is not supported for live event streams', {
      fields: { order: 'Use order=asc for event streams or the JSON representation for finite historical pages.' },
    })
  }

  const deps = c.get('deps')
  const controller = new AbortController()
  const signal = controller.signal
  const onRequestAbort = () => controller.abort()
  c.req.raw.signal.addEventListener('abort', onRequestAbort)

  const encoder = new TextEncoder()
  let lastSequence = query.cursor ?? 0
  const stream = new ReadableStream({
    async start(streamController) {
      try {
        const deadline = Date.now() + 1000
        while (Date.now() <= deadline && !signal.aborted) {
          const page = await deps.sessions.queryEvents(sessionId, {
            ...(query.type ? { type: query.type } : {}),
            visibility: query.visibility ?? 'runtime',
            ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
            ...(query.createdTo ? { createdTo: query.createdTo } : {}),
            order: 'asc',
            cursor: lastSequence,
            limit: limit + 1,
          })
          const rows = page.rows.slice(0, limit)
          for (const event of rows) {
            lastSequence = event.sequence
            streamController.enqueue(
              encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
            )
          }
          if (rows.length >= limit) {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } finally {
        c.req.raw.signal.removeEventListener('abort', onRequestAbort)
        streamController.close()
      }
    },
    cancel() {
      controller.abort()
    },
  })
  return c.body(stream, 200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
}

// requireAuth path-gates runner tokens away from non-runner resources, but the
// v1 design routes runner event upload through the sessions domain, so this
// endpoint resolves its own auth context and applies lease ownership as the
// runner gate.
// ── Routes ───────────────────────────────────────────────────────────────────

const createSessionRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createSession',
  tags: ['Sessions'],
  summary: 'Create a session',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateSessionSchema } } } },
  responses: {
    201: { description: 'Created session', content: { 'application/json': { schema: SessionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSessions',
  tags: ['Sessions'],
  summary: 'List sessions',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Session list', content: { 'application/json': { schema: SessionListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}',
  operationId: 'readSession',
  tags: ['Sessions'],
  summary: 'Read a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}',
  operationId: 'updateSession',
  tags: ['Sessions'],
  summary: 'Update a session',
  description:
    'Partial update: title and metadata edits, the stop transition (state: "stopped"), and lifecycle archiving (archived: true|false).',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateSessionSchema } } },
  },
  responses: {
    200: { description: 'Updated session', content: { 'application/json': { schema: SessionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionConnectionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/connection',
  operationId: 'readSessionConnection',
  tags: ['Sessions'],
  summary: 'Read session runtime connection details',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Connection details', content: { 'application/json': { schema: SessionConnectionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionMessagesRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/messages',
  operationId: 'listSessionMessages',
  tags: ['Sessions'],
  summary: 'List session messages',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: MessageListQuerySchema },
  responses: {
    200: {
      description: 'Session messages',
      content: { 'application/json': { schema: SessionMessageListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionMessageRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/messages',
  operationId: 'createSessionMessage',
  tags: ['Sessions'],
  summary: 'Send a prompt message to a session',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionMessageSchema } } },
  },
  responses: {
    201: { description: 'Message accepted', content: { 'application/json': { schema: SessionMessageSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Runtime error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionMessageRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/messages/{messageId}',
  operationId: 'readSessionMessage',
  tags: ['Sessions'],
  summary: 'Read a session message delivery state',
  ...AuthenticatedOperation,
  request: { params: MessageParamsSchema },
  responses: {
    200: { description: 'Session message', content: { 'application/json': { schema: SessionMessageSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or message not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events',
  operationId: 'listSessionEvents',
  tags: ['Sessions'],
  summary: 'List session events',
  description:
    'Content negotiation: application/json returns a paginated list, text/csv exports the filtered events, text/event-stream streams new events as SSE.',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events',
      content: {
        'application/json': { schema: SessionEventListResponseSchema },
        'text/csv': { schema: z.string() },
        'text/event-stream': { schema: z.string() },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createSessionEventsRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/events',
  operationId: 'createSessionEvents',
  tags: ['Sessions'],
  summary: 'Batch-create session events',
  description:
    'Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an active lease attached to the session.',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateSessionEventsSchema } } },
  },
  responses: {
    201: { description: 'Events accepted', content: { 'application/json': { schema: SessionEventsAcceptedSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listSessionApprovalsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/approvals',
  operationId: 'listSessionApprovals',
  tags: ['Sessions'],
  summary: 'List tool approvals for a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: {
      description: 'Session approvals',
      content: { 'application/json': { schema: SessionApprovalListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readSessionApprovalRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/approvals/{approvalId}',
  operationId: 'readSessionApproval',
  tags: ['Sessions'],
  summary: 'Read a tool approval',
  ...AuthenticatedOperation,
  request: { params: ApprovalParamsSchema },
  responses: {
    200: { description: 'Session approval', content: { 'application/json': { schema: SessionApprovalSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or approval not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const decideSessionApprovalRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}/approvals/{approvalId}',
  operationId: 'decideSessionApproval',
  tags: ['Sessions'],
  summary: 'Approve or deny a pending tool call',
  description:
    'Records the human decision for a paused tool call. Approval resumes the runtime and executes the tool (or records the provided custom result); denial resumes the runtime with the denial.',
  ...AuthenticatedOperation,
  request: {
    params: ApprovalParamsSchema,
    body: { required: true, content: { 'application/json': { schema: SessionApprovalDecisionSchema } } },
  },
  responses: {
    200: { description: 'Decision recorded', content: { 'application/json': { schema: SessionApprovalSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Session or pending approval not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: { description: 'Approval already decided', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the sessions resource's original mount position.
export function registerSessionRoutes(routes: SessionRoutes) {
  return routes
    .openapi(createSessionRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      // Create is a single forward to the runtime boundary (snapshot,
      // provider/policy/runtime checks, session-row build, sandbox boot or
      // self-hosted work-item enqueue all live behind the runtime usecase), so
      // the route calls the runtime usecase with deps directly.
      const outcome = await createRuntimeSession(deps, auth, {
        agentId: body.agentId,
        ...(body.environmentId !== undefined ? { environmentId: body.environmentId } : {}),
        options: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          ...(body.resourceRefs !== undefined ? { resourceRefs: body.resourceRefs } : {}),
          runtime: body.runtime,
          ...(body.runtimeConfig !== undefined ? { runtimeConfig: body.runtimeConfig } : {}),
          ...(body.env !== undefined ? { env: body.env } : {}),
          ...(body.secretEnv !== undefined ? { secretEnv: body.secretEnv as SessionRecord['secretEnv'] } : {}),
          ...(body.initialPrompt !== undefined ? { initialPrompt: body.initialPrompt } : {}),
          ...(body.providerAccessOverride !== undefined ? { providerAccessOverride: body.providerAccessOverride } : {}),
        },
        requestId: requestId(c),
      })
      if (!outcome.ok) {
        return runtimeErrorResponse(c, outcome.error) as never
      }
      return c.json(serializeSession(outcome.value), 201)
    })
    .openapi(listSessionsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await markRuntimeExpiredPending(deps, auth)
      const { archived, state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.sessions.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(state ? { state } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeSession), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readSessionRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      await markRuntimeExpiredPending(deps, auth)
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      return c.json(serializeSession(session), 200)
    })
    .openapi(updateSessionRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const patch: UpdateSessionPatch = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.archived !== undefined ? { archived: body.archived } : {}),
      }
      try {
        const outcome = await updateSession(deps, auth as never, session, patch, requestId(c))
        if (!outcome.ok) {
          return runtimeErrorResponse(c, outcome.error) as never
        }
        return c.json(serializeSession(outcome.value), 200)
      } catch (error) {
        return sessionValidationOr(c, error)
      }
    })
    .openapi(readSessionConnectionRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const connection = await deps.sessions.readConnection(auth.project.id, sessionId)
      if (!connection) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      return c.json(serializeConnection(connection), 200)
    })
    .openapi(listSessionMessagesRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const { limit = 50, cursor } = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.sessions.listMessages({
        projectId: auth.project.id,
        sessionId,
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeMessage), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createSessionMessageRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const { content } = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const outcome = await sendSessionMessage(deps, auth as never, session, content)
      if (!outcome.ok) {
        return errorResponse(
          c,
          outcome.status,
          outcome.status === 500 ? 'internal_error' : 'conflict',
          outcome.message,
          {
            ...('runtimeError' in outcome && outcome.runtimeError ? { runtime: outcome.runtimeError } : {}),
          },
        )
      }
      return c.json(serializeMessage(outcome.message), 201)
    })
    .openapi(readSessionMessageRoute, async (c) => {
      const { sessionId, messageId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const message = await deps.sessions.findMessage(auth.project.id, sessionId, messageId)
      if (!message) {
        return errorResponse(c, 404, 'not_found', 'Session message not found')
      }
      return c.json(serializeMessage(message), 200)
    })
    .openapi(listEventsRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const query = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.find(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const mediaType = negotiateMediaType(c, ['text/csv', 'text/event-stream'] as const)
      if (mediaType === 'text/csv') {
        return (await eventsCsvResponse(c, sessionId, query)) as never
      }
      if (mediaType === 'text/event-stream') {
        return eventsSseResponse(c, sessionId, query) as never
      }
      return await eventsJsonResponse(c, sessionId, query)
    })
    .openapi(createSessionEventsRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const { events } = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireSessionEventsAuth(c)
      if (auth instanceof Response) {
        return auth
      }

      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }

      let runnerLeaseMetadata: Record<string, unknown> | null = null
      if (isRunnerOidcAuth(c.env, auth)) {
        const ownedLease = await deps.sessions.activeSessionLeaseForRunner(auth.project.id, sessionId, {
          runnerId: auth.oidc.runnerId,
          subject: auth.oidc.subject,
        })
        if (!ownedLease) {
          return errorResponse(c, 403, 'forbidden', 'Runner token does not hold an active lease for this session')
        }
        runnerLeaseMetadata = ownedLease
      }

      const accepted = await deps.sessions.insertEvents(
        {
          organizationId: session.organizationId ?? auth.organization.id,
          projectId: auth.project.id,
          sessionId: session.id,
        },
        events.map((event) => ({
          type: event.type,
          payload: event.payload,
          metadata: runnerLeaseMetadata
            ? { source: 'self-hosted-runner', ...(event.metadata ?? {}), ...runnerLeaseMetadata }
            : { source: 'api', ...(event.metadata ?? {}) },
        })),
      )
      return c.json({ accepted }, 201)
    })
    .openapi(listSessionApprovalsRoute, async (c) => {
      const { sessionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const { pending } = sessionApprovalState(session.metadata)
      const decided = await deps.sessions.listApprovals(auth.project.id, sessionId)
      const data = [
        ...(pending ? [serializePendingApproval(sessionId, pending)] : []),
        ...decided.map(serializeApprovalRecord),
      ]
      return c.json({ data, pagination: { limit: data.length, nextCursor: null, hasMore: false } }, 200)
    })
    .openapi(readSessionApprovalRoute, async (c) => {
      const { sessionId, approvalId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      const decided = await deps.sessions.findApproval(auth.project.id, sessionId, approvalId)
      if (decided) {
        return c.json(serializeApprovalRecord(decided), 200)
      }
      const { pending } = sessionApprovalState(session.metadata)
      if (pending?.id === approvalId) {
        return c.json(serializePendingApproval(sessionId, pending), 200)
      }
      return errorResponse(c, 404, 'not_found', 'Session approval not found')
    })
    .openapi(decideSessionApprovalRoute, async (c) => {
      const { sessionId, approvalId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const session = await deps.sessions.findRuntimeRow(auth.project.id, sessionId)
      if (!session) {
        return errorResponse(c, 404, 'not_found', 'Session not found')
      }
      // Decide is a single forward to the runtime boundary (it executes the
      // approved tool or records the denial, persists the decided approval, and
      // resumes the turn), so the route calls the runtime usecase with deps directly.
      const outcome = await decideRuntimeApproval(deps, auth, session, approvalId, {
        decision: body.decision,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(body.result !== undefined ? { result: body.result } : {}),
      })
      if (!outcome.ok) {
        return runtimeErrorResponse(c, outcome.error) as never
      }
      return c.json(serializeApprovalRecord(outcome.value), 200)
    })
}

// --- helpers ---

// Extracts a redacted human message from a runtime error payload, for the
// runtime error-message contract test and any runtime-failure surfacing.
export function runtimeErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error
  let message: string
  if (typeof error === 'string') {
    message = error
  } else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    message = error.message
  } else if (typeof payload.message === 'string') {
    message = payload.message
  } else {
    message = 'Runtime command failed'
  }
  return redactSensitiveValue(message) as string
}

function sessionValidationOr(c: Context<DepsEnv>, error: unknown) {
  if (error instanceof SessionValidationError) {
    return errorResponse(c, 400, 'validation_error', error.message, { fields: error.fields })
  }
  throw error
}
