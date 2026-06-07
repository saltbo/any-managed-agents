import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, ne, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { agentDefinitions, environments, scheduledAgentTriggers, scheduledTriggerRuns } from '../db/schema'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import { RuntimeSchema } from './environment-contracts'

const app = createApiRouter()

const TRIGGER_STATUSES = ['active', 'paused', 'archived'] as const
const RUN_STATUSES = ['claimed', 'session_created', 'failed'] as const
const JsonObjectSchema = z.record(z.string(), z.unknown())
const RuntimeSecretEnvSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .openapi({ example: 'AK_AGENT_KEY' }),
    ref: z
      .string()
      .regex(/^vaultver_[a-zA-Z0-9]+$/)
      .openapi({ example: 'vaultver_abc123' }),
  })
  .strict()

const ScheduledAgentTriggerSchema = z
  .object({
    id: z.string().openapi({ example: 'sched_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    environmentId: z.string().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    name: z.string().openapi({ example: 'Daily research heartbeat' }),
    promptTemplate: z.string().openapi({ example: 'Research current Canadian banking bonus offers.' }),
    resourceRefs: z.array(JsonObjectSchema).openapi({
      example: [{ type: 'github_repository', owner: 'openai', repo: 'openai' }],
    }),
    runtimeEnv: JsonObjectSchema.openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    runtimeSecretEnv: z.array(RuntimeSecretEnvSchema).openapi({
      example: [{ name: 'AK_AGENT_KEY', ref: 'vaultver_abc123' }],
    }),
    schedule: z
      .object({
        type: z.literal('interval'),
        intervalSeconds: z.number().int().openapi({ example: 86400 }),
        windowSeconds: z.number().int().openapi({ example: 0 }),
      })
      .openapi({ example: { type: 'interval', intervalSeconds: 86400, windowSeconds: 0 } }),
    status: z.enum(TRIGGER_STATUSES).openapi({ example: 'active' }),
    nextDueAt: z.string().datetime().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    lastDispatchedAt: z.string().datetime().nullable().openapi({ example: null }),
    lastRunId: z.string().nullable().openapi({ example: 'schedrun_abc123' }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'growth' } }),
    createdByUserId: z.string().nullable().openapi({ example: 'user_abc123' }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ScheduledAgentTrigger')

const ScheduledTriggerRunSchema = z
  .object({
    id: z.string().openapi({ example: 'schedrun_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    triggerId: z.string().openapi({ example: 'sched_abc123' }),
    scheduledFor: z.string().datetime().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    heartbeatAt: z.string().datetime().openapi({ example: '2026-05-26T12:01:00.000Z' }),
    status: z.enum(RUN_STATUSES).openapi({ example: 'session_created' }),
    idempotencyKey: z.string().openapi({ example: 'sched_abc123:2026-05-26T12:00:00.000Z' }),
    sessionId: z.string().nullable().openapi({ example: 'session_abc123' }),
    correlationId: z.string().openapi({ example: 'schedule:sched_abc123:2026-05-26T12:00:00.000Z' }),
    errorMessage: z.string().nullable().openapi({ example: null }),
    metadata: JsonObjectSchema.openapi({ example: { source: 'scheduled-agent-trigger' } }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ScheduledTriggerRun')

const SchedulePayloadSchema = z
  .object({
    type: z.literal('interval').optional().openapi({ example: 'interval' }),
    intervalSeconds: z.number().int().min(60).max(31_536_000).openapi({ example: 86400 }),
    windowSeconds: z.number().int().min(0).max(86_400).optional().openapi({ example: 0 }),
  })
  .strict()

const CreateScheduledAgentTriggerSchema = z
  .object({
    agentId: z.string().min(1).openapi({ example: 'agent_abc123' }),
    environmentId: z.string().min(1).openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    name: z.string().min(1).max(160).openapi({ example: 'Daily research heartbeat' }),
    promptTemplate: z.string().trim().min(1).max(16000).openapi({
      example: 'Research current Canadian banking bonus offers.',
    }),
    resourceRefs: z
      .array(JsonObjectSchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ type: 'github_repository', owner: 'openai', repo: 'openai' }],
      }),
    runtimeEnv: JsonObjectSchema.optional().openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    runtimeSecretEnv: z
      .array(RuntimeSecretEnvSchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ name: 'AK_AGENT_KEY', ref: 'vaultver_abc123' }],
      }),
    schedule: SchedulePayloadSchema,
    status: z.enum(['active', 'paused']).optional().openapi({ example: 'active' }),
    nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'growth' } }),
  })
  .strict()
  .openapi('CreateScheduledAgentTriggerRequest')

const UpdateScheduledAgentTriggerSchema = z
  .object({
    agentId: z.string().min(1).optional().openapi({ example: 'agent_abc123' }),
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.optional().openapi({ example: 'codex' }),
    name: z.string().min(1).max(160).optional().openapi({ example: 'Daily research heartbeat' }),
    promptTemplate: z.string().trim().min(1).max(16000).optional().openapi({
      example: 'Research current Canadian banking bonus offers.',
    }),
    resourceRefs: z
      .array(JsonObjectSchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ type: 'github_repository', owner: 'openai', repo: 'openai' }],
      }),
    runtimeEnv: JsonObjectSchema.optional().openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    runtimeSecretEnv: z
      .array(RuntimeSecretEnvSchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ name: 'AK_AGENT_KEY', ref: 'vaultver_abc123' }],
      }),
    schedule: SchedulePayloadSchema.optional(),
    status: z.enum(['active', 'paused']).optional().openapi({ example: 'paused' }),
    nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-27T12:00:00.000Z' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'growth' } }),
  })
  .strict()
  .openapi('UpdateScheduledAgentTriggerRequest')

const ParamsSchema = z.object({
  triggerId: z.string().openapi({ param: { name: 'triggerId', in: 'path' }, example: 'sched_abc123' }),
})

const ListQuerySchema = listQuerySchema(TRIGGER_STATUSES)
const RunsQuerySchema = listQuerySchema(RUN_STATUSES)
const ScheduledAgentTriggerListResponseSchema = listResponseSchema(
  'ScheduledAgentTriggerListResponse',
  ScheduledAgentTriggerSchema,
)
const ScheduledTriggerRunListResponseSchema = listResponseSchema(
  'ScheduledTriggerRunListResponse',
  ScheduledTriggerRunSchema,
)

type TriggerRow = typeof scheduledAgentTriggers.$inferSelect
type RunRow = typeof scheduledTriggerRuns.$inferSelect
type Db = ReturnType<typeof drizzle>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

function rejectSecretMetadata(c: Parameters<Parameters<typeof app.openapi>[1]>[0], metadata: unknown) {
  if (!hasSecretMaterial(metadata)) {
    return null
  }
  return errorResponse(c, 400, 'validation_error', 'Invalid scheduled trigger metadata', {
    fields: {
      metadata: 'Secret material must be stored in vault references.',
    },
  })
}

function nextDueFromInterval(intervalSeconds: number) {
  return new Date(Date.now() + intervalSeconds * 1000).toISOString()
}

function serializeTrigger(row: TriggerRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    agentId: row.agentId,
    environmentId: row.environmentId,
    runtime: RuntimeSchema.parse(row.runtime),
    name: row.name,
    promptTemplate: row.promptTemplate,
    resourceRefs: parseJson<Record<string, unknown>[]>(row.resourceRefs, []),
    runtimeEnv: parseJson<Record<string, unknown>>(row.runtimeEnv, {}),
    runtimeSecretEnv: parseJson<Array<z.infer<typeof RuntimeSecretEnvSchema>>>(row.runtimeSecretEnv, []),
    schedule: {
      type: 'interval' as const,
      intervalSeconds: row.intervalSeconds,
      windowSeconds: row.windowSeconds,
    },
    status: row.status as (typeof TRIGGER_STATUSES)[number],
    nextDueAt: row.nextDueAt,
    lastDispatchedAt: row.lastDispatchedAt,
    lastRunId: row.lastRunId,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdByUserId: row.createdByUserId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeRun(row: RunRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    triggerId: row.triggerId,
    scheduledFor: row.scheduledFor,
    heartbeatAt: row.heartbeatAt,
    status: row.status as (typeof RUN_STATUSES)[number],
    idempotencyKey: row.idempotencyKey,
    sessionId: row.sessionId,
    correlationId: row.correlationId,
    errorMessage: row.errorMessage,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function assertActiveAgentAndEnvironment(db: Db, projectId: string, agentId: string, environmentId: string) {
  const agent = await db
    .select({ id: agentDefinitions.id, status: agentDefinitions.status })
    .from(agentDefinitions)
    .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, projectId)))
    .get()
  if (!agent) {
    return { status: 404 as const, message: 'Agent not found' }
  }
  if (agent.status !== 'active') {
    return { status: 409 as const, message: 'Archived agents cannot be scheduled' }
  }
  const environment = await db
    .select({ id: environments.id, status: environments.status, currentVersionId: environments.currentVersionId })
    .from(environments)
    .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    .get()
  if (!environment || environment.status !== 'active' || !environment.currentVersionId) {
    return { status: 409 as const, message: 'Selected environment is archived or unavailable' }
  }
  return null
}

async function findTrigger(db: Db, projectId: string, triggerId: string) {
  return (
    (await db
      .select()
      .from(scheduledAgentTriggers)
      .where(and(eq(scheduledAgentTriggers.id, triggerId), eq(scheduledAgentTriggers.projectId, projectId)))
      .get()) ?? null
  )
}

function triggerCursorFilter(cursor: string | undefined) {
  if (!cursor) {
    return undefined
  }
  const parsedCursor = parseListCursor(cursor)
  return or(
    lt(scheduledAgentTriggers.createdAt, parsedCursor.createdAt),
    and(eq(scheduledAgentTriggers.createdAt, parsedCursor.createdAt), lt(scheduledAgentTriggers.id, parsedCursor.id)),
  )
}

function runCursorFilter(cursor: string | undefined) {
  if (!cursor) {
    return undefined
  }
  const parsedCursor = parseListCursor(cursor)
  return or(
    lt(scheduledTriggerRuns.createdAt, parsedCursor.createdAt),
    and(eq(scheduledTriggerRuns.createdAt, parsedCursor.createdAt), lt(scheduledTriggerRuns.id, parsedCursor.id)),
  )
}

const createRouteDefinition = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createScheduledAgentTrigger',
  tags: ['Scheduled agent triggers'],
  summary: 'Create a scheduled agent trigger',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateScheduledAgentTriggerSchema } } } },
  responses: {
    201: {
      description: 'Created scheduled agent trigger',
      content: { 'application/json': { schema: ScheduledAgentTriggerSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listRouteDefinition = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listScheduledAgentTriggers',
  tags: ['Scheduled agent triggers'],
  summary: 'List scheduled agent triggers',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Scheduled agent triggers',
      content: { 'application/json': { schema: ScheduledAgentTriggerListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}',
  operationId: 'readScheduledAgentTrigger',
  tags: ['Scheduled agent triggers'],
  summary: 'Read a scheduled agent trigger',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: {
      description: 'Scheduled agent trigger',
      content: { 'application/json': { schema: ScheduledAgentTriggerSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Scheduled agent trigger not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const updateRouteDefinition = createRoute({
  method: 'patch',
  path: '/{triggerId}',
  operationId: 'updateScheduledAgentTrigger',
  tags: ['Scheduled agent triggers'],
  summary: 'Update a scheduled agent trigger',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateScheduledAgentTriggerSchema } } },
  },
  responses: {
    200: {
      description: 'Updated scheduled agent trigger',
      content: { 'application/json': { schema: ScheduledAgentTriggerSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Scheduled agent trigger not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveRouteDefinition = createRoute({
  method: 'delete',
  path: '/{triggerId}',
  operationId: 'archiveScheduledAgentTrigger',
  tags: ['Scheduled agent triggers'],
  summary: 'Archive a scheduled agent trigger',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    204: { description: 'Scheduled agent trigger archived' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Scheduled agent trigger not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listRunsRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}/runs',
  operationId: 'listScheduledTriggerRuns',
  tags: ['Scheduled agent triggers'],
  summary: 'List scheduled trigger runs',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: RunsQuerySchema },
  responses: {
    200: {
      description: 'Scheduled trigger runs',
      content: { 'application/json': { schema: ScheduledTriggerRunListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Scheduled agent trigger not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const routes = app
  .openapi(createRouteDefinition, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const secretMetadataResponse = rejectSecretMetadata(c, body.metadata)
    if (secretMetadataResponse) {
      return secretMetadataResponse
    }
    if (hasSecretMaterial(body.resourceRefs) || hasSecretMaterial(body.runtimeEnv)) {
      return errorResponse(c, 400, 'validation_error', 'Invalid scheduled trigger session configuration', {
        fields: {
          resourceRefs: 'Resource references must not contain secret material.',
          runtimeEnv: 'Runtime environment variables must not contain raw secret material.',
        },
      })
    }
    const invalidDependency = await assertActiveAgentAndEnvironment(
      db,
      auth.project.id,
      body.agentId,
      body.environmentId,
    )
    if (invalidDependency) {
      return errorResponse(
        c,
        invalidDependency.status,
        invalidDependency.status === 404 ? 'not_found' : 'conflict',
        invalidDependency.message,
      )
    }

    const timestamp = now()
    const row = {
      id: newId('sched'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      agentId: body.agentId,
      environmentId: body.environmentId,
      runtime: body.runtime,
      name: body.name,
      promptTemplate: body.promptTemplate,
      resourceRefs: stringify(body.resourceRefs ?? []),
      runtimeEnv: stringify(body.runtimeEnv ?? {}),
      runtimeSecretEnv: stringify(body.runtimeSecretEnv ?? []),
      intervalSeconds: body.schedule.intervalSeconds,
      windowSeconds: body.schedule.windowSeconds ?? 0,
      status: body.status ?? 'active',
      nextDueAt: body.nextDueAt ?? nextDueFromInterval(body.schedule.intervalSeconds),
      lastDispatchedAt: null,
      lastRunId: null,
      metadata: stringify(body.metadata ?? {}),
      createdByUserId: auth.user.id,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(scheduledAgentTriggers).values(row)
    await recordAudit(db, {
      auth,
      action: 'scheduled_trigger.create',
      resourceType: 'scheduled_trigger',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serializeTrigger(row),
    })
    return c.json(serializeTrigger(row), 201)
  })
  .openapi(listRouteDefinition, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursorFilter: ReturnType<typeof triggerCursorFilter>
    try {
      parsedCursorFilter = triggerCursorFilter(cursor)
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(scheduledAgentTriggers.projectId, auth.project.id),
      status
        ? eq(scheduledAgentTriggers.status, status)
        : includeArchived === 'true'
          ? undefined
          : ne(scheduledAgentTriggers.status, 'archived'),
      search ? like(scheduledAgentTriggers.name, `%${search}%`) : undefined,
      createdFrom ? gte(scheduledAgentTriggers.createdAt, createdFrom) : undefined,
      createdTo ? lte(scheduledAgentTriggers.createdAt, createdTo) : undefined,
      parsedCursorFilter,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(scheduledAgentTriggers)
      .where(and(...filters))
      .orderBy(desc(scheduledAgentTriggers.createdAt), desc(scheduledAgentTriggers.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeTrigger), pagination: page.pagination }, 200)
  })
  .openapi(readRouteDefinition, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const trigger = await findTrigger(db, auth.project.id, c.req.valid('param').triggerId)
    if (!trigger) {
      return errorResponse(c, 404, 'not_found', 'Scheduled agent trigger not found')
    }
    return c.json(serializeTrigger(trigger), 200)
  })
  .openapi(updateRouteDefinition, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { triggerId } = c.req.valid('param')
    const body = c.req.valid('json')
    const trigger = await findTrigger(db, auth.project.id, triggerId)
    if (!trigger) {
      return errorResponse(c, 404, 'not_found', 'Scheduled agent trigger not found')
    }
    if (trigger.status === 'archived') {
      return errorResponse(c, 409, 'conflict', 'Archived scheduled triggers cannot be updated')
    }
    const secretMetadataResponse = rejectSecretMetadata(c, body.metadata)
    if (secretMetadataResponse) {
      return secretMetadataResponse
    }
    if (hasSecretMaterial(body.resourceRefs) || hasSecretMaterial(body.runtimeEnv)) {
      return errorResponse(c, 400, 'validation_error', 'Invalid scheduled trigger session configuration', {
        fields: {
          resourceRefs: 'Resource references must not contain secret material.',
          runtimeEnv: 'Runtime environment variables must not contain raw secret material.',
        },
      })
    }
    const agentId = body.agentId ?? trigger.agentId
    const environmentId = body.environmentId ?? trigger.environmentId
    const invalidDependency = await assertActiveAgentAndEnvironment(db, auth.project.id, agentId, environmentId)
    if (invalidDependency) {
      return errorResponse(
        c,
        invalidDependency.status,
        invalidDependency.status === 404 ? 'not_found' : 'conflict',
        invalidDependency.message,
      )
    }
    const timestamp = now()
    const update = {
      agentId,
      environmentId,
      runtime: body.runtime ?? trigger.runtime,
      name: body.name ?? trigger.name,
      promptTemplate: body.promptTemplate ?? trigger.promptTemplate,
      resourceRefs: body.resourceRefs !== undefined ? stringify(body.resourceRefs) : trigger.resourceRefs,
      runtimeEnv: body.runtimeEnv !== undefined ? stringify(body.runtimeEnv) : trigger.runtimeEnv,
      runtimeSecretEnv:
        body.runtimeSecretEnv !== undefined ? stringify(body.runtimeSecretEnv) : trigger.runtimeSecretEnv,
      intervalSeconds: body.schedule?.intervalSeconds ?? trigger.intervalSeconds,
      windowSeconds: body.schedule?.windowSeconds ?? trigger.windowSeconds,
      status: body.status ?? trigger.status,
      nextDueAt: body.nextDueAt ?? trigger.nextDueAt,
      metadata: stringify(body.metadata ?? parseJson<Record<string, unknown>>(trigger.metadata, {})),
      updatedAt: timestamp,
    }
    await db.update(scheduledAgentTriggers).set(update).where(eq(scheduledAgentTriggers.id, trigger.id))
    const updated = await findTrigger(db, auth.project.id, trigger.id)
    if (!updated) {
      throw new Error('Updated scheduled trigger row is required')
    }
    await recordAudit(db, {
      auth,
      action: 'scheduled_trigger.update',
      resourceType: 'scheduled_trigger',
      resourceId: trigger.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeTrigger(trigger),
      after: serializeTrigger(updated),
    })
    return c.json(serializeTrigger(updated), 200)
  })
  .openapi(archiveRouteDefinition, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const trigger = await findTrigger(db, auth.project.id, c.req.valid('param').triggerId)
    if (!trigger) {
      return errorResponse(c, 404, 'not_found', 'Scheduled agent trigger not found')
    }
    if (trigger.status !== 'archived') {
      const archivedAt = now()
      await db
        .update(scheduledAgentTriggers)
        .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
        .where(eq(scheduledAgentTriggers.id, trigger.id))
      await recordAudit(db, {
        auth,
        action: 'scheduled_trigger.archive',
        resourceType: 'scheduled_trigger',
        resourceId: trigger.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeTrigger(trigger),
        after: { status: 'archived', archivedAt },
      })
    }
    return c.body(null, 204)
  })
  .openapi(listRunsRouteDefinition, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { triggerId } = c.req.valid('param')
    const trigger = await findTrigger(db, auth.project.id, triggerId)
    if (!trigger) {
      return errorResponse(c, 404, 'not_found', 'Scheduled agent trigger not found')
    }
    const { status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursorFilter: ReturnType<typeof runCursorFilter>
    try {
      parsedCursorFilter = runCursorFilter(cursor)
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(scheduledTriggerRuns.triggerId, triggerId),
      eq(scheduledTriggerRuns.projectId, auth.project.id),
      status ? eq(scheduledTriggerRuns.status, status) : undefined,
      search ? like(scheduledTriggerRuns.correlationId, `%${search}%`) : undefined,
      createdFrom ? gte(scheduledTriggerRuns.createdAt, createdFrom) : undefined,
      createdTo ? lte(scheduledTriggerRuns.createdAt, createdTo) : undefined,
      parsedCursorFilter,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(scheduledTriggerRuns)
      .where(and(...filters))
      .orderBy(desc(scheduledTriggerRuns.createdAt), desc(scheduledTriggerRuns.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeRun), pagination: page.pagination }, 200)
  })

export default routes
