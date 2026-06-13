import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { agents, environments, triggerRuns, triggers } from '../db/schema'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
  SecretEnvEntrySchema,
} from '../openapi'
import { RuntimeSchema } from './environment-contracts'

const app = createApiRouter()

const RUN_STATES = ['claimed', 'session_created', 'failed'] as const
const JsonObjectSchema = z.record(z.string(), z.unknown())
const EnvSchema = z.record(z.string(), z.string())

const TriggerSchema = z
  .object({
    id: z.string().openapi({ example: 'trigger_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    environmentId: z.string().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    name: z.string().openapi({ example: 'Daily research heartbeat' }),
    promptTemplate: z.string().openapi({ example: 'Research current Canadian banking bonus offers.' }),
    resourceRefs: z.array(JsonObjectSchema).openapi({
      example: [{ type: 'github_repository', owner: 'openai', repo: 'openai' }],
    }),
    env: EnvSchema.openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    secretEnv: z.array(SecretEnvEntrySchema).openapi({
      example: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'vaultcred_abc123' } }],
    }),
    schedule: z
      .object({
        type: z.literal('interval'),
        intervalSeconds: z.number().int().openapi({ example: 86400 }),
        windowSeconds: z.number().int().openapi({ example: 0 }),
      })
      .openapi({ example: { type: 'interval', intervalSeconds: 86400, windowSeconds: 0 } }),
    enabled: z.boolean().openapi({ example: true }),
    nextDueAt: z.string().datetime().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    lastDispatchedAt: z.string().datetime().nullable().openapi({ example: null }),
    lastRunId: z.string().nullable().openapi({ example: 'trigrun_abc123' }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'growth' } }),
    createdByUserId: z.string().nullable().openapi({ example: 'user_abc123' }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Trigger')

const TriggerRunSchema = z
  .object({
    id: z.string().openapi({ example: 'trigrun_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    triggerId: z.string().openapi({ example: 'trigger_abc123' }),
    scheduledFor: z.string().datetime().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    heartbeatAt: z.string().datetime().openapi({ example: '2026-05-26T12:01:00.000Z' }),
    state: z.enum(RUN_STATES).openapi({ example: 'session_created' }),
    idempotencyKey: z.string().openapi({ example: 'trigger_abc123:2026-05-26T12:00:00.000Z' }),
    sessionId: z.string().nullable().openapi({ example: 'session_abc123' }),
    correlationId: z.string().openapi({ example: 'schedule:trigger_abc123:2026-05-26T12:00:00.000Z' }),
    errorMessage: z.string().nullable().openapi({ example: null }),
    metadata: JsonObjectSchema.openapi({ example: { source: 'trigger' } }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('TriggerRun')

const SchedulePayloadSchema = z
  .object({
    type: z.literal('interval').optional().openapi({ example: 'interval' }),
    intervalSeconds: z.number().int().min(60).max(31_536_000).openapi({ example: 86400 }),
    windowSeconds: z.number().int().min(0).max(86_400).optional().openapi({ example: 0 }),
  })
  .strict()

const CreateTriggerSchema = z
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
    env: EnvSchema.optional().openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    secretEnv: z
      .array(SecretEnvEntrySchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'vaultcred_abc123' } }],
      }),
    schedule: SchedulePayloadSchema,
    enabled: z.boolean().optional().openapi({ example: true }),
    nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'growth' } }),
  })
  .strict()
  .openapi('CreateTriggerRequest')

const UpdateTriggerSchema = z
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
    env: EnvSchema.optional().openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    secretEnv: z
      .array(SecretEnvEntrySchema)
      .max(50)
      .optional()
      .openapi({
        example: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'vaultcred_abc123' } }],
      }),
    schedule: SchedulePayloadSchema.optional(),
    enabled: z.boolean().optional().openapi({ example: false }),
    archived: z.boolean().optional().openapi({ example: true }),
    nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-27T12:00:00.000Z' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'growth' } }),
  })
  .strict()
  .openapi('UpdateTriggerRequest')

const TriggerParamsSchema = z.object({
  triggerId: z.string().openapi({ param: { name: 'triggerId', in: 'path' }, example: 'trigger_abc123' }),
})

const RunParamsSchema = TriggerParamsSchema.extend({
  runId: z.string().openapi({ param: { name: 'runId', in: 'path' }, example: 'trigrun_abc123' }),
})

const enabledQuery = z
  .enum(['true', 'false'])
  .optional()
  .openapi({
    param: { name: 'enabled', in: 'query' },
    description: 'Filter by the operational toggle.',
    example: 'true',
  })

const runStateQuery = z
  .enum(RUN_STATES)
  .optional()
  .openapi({
    param: { name: 'state', in: 'query' },
    example: 'session_created',
  })

const ListQuerySchema = listQuerySchema().extend({ enabled: enabledQuery })
const RunsQuerySchema = listQuerySchema().omit({ archived: true }).extend({ state: runStateQuery })
const TriggerListResponseSchema = listResponseSchema('TriggerListResponse', TriggerSchema)
const TriggerRunListResponseSchema = listResponseSchema('TriggerRunListResponse', TriggerRunSchema)

type TriggerRow = typeof triggers.$inferSelect
type RunRow = typeof triggerRuns.$inferSelect
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
  return errorResponse(c, 400, 'validation_error', 'Invalid trigger metadata', {
    fields: {
      metadata: 'Secret material must be stored in vault references.',
    },
  })
}

function rejectSecretSessionConfig(
  c: Parameters<Parameters<typeof app.openapi>[1]>[0],
  resourceRefs: unknown,
  env: unknown,
) {
  if (!hasSecretMaterial(resourceRefs) && !hasSecretMaterial(env)) {
    return null
  }
  return errorResponse(c, 400, 'validation_error', 'Invalid trigger session configuration', {
    fields: {
      resourceRefs: 'Resource references must not contain secret material.',
      env: 'Environment variables must not contain raw secret material.',
    },
  })
}

function nextDueFromInterval(intervalSeconds: number) {
  return new Date(Date.now() + intervalSeconds * 1000).toISOString()
}

function serializeTrigger(row: TriggerRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    environmentId: row.environmentId,
    runtime: RuntimeSchema.parse(row.runtime),
    name: row.name,
    promptTemplate: row.promptTemplate,
    resourceRefs: parseJson<Record<string, unknown>[]>(row.resourceRefs, []),
    env: parseJson<Record<string, string>>(row.env, {}),
    secretEnv: parseJson<Array<z.infer<typeof SecretEnvEntrySchema>>>(row.secretEnv, []),
    schedule: {
      type: 'interval' as const,
      intervalSeconds: row.intervalSeconds,
      windowSeconds: row.windowSeconds,
    },
    enabled: row.enabled,
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
    projectId: row.projectId,
    triggerId: row.triggerId,
    scheduledFor: row.scheduledFor,
    heartbeatAt: row.heartbeatAt,
    state: row.state as (typeof RUN_STATES)[number],
    idempotencyKey: row.idempotencyKey,
    sessionId: row.sessionId,
    correlationId: row.correlationId,
    errorMessage: row.errorMessage,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function assertLiveAgentAndEnvironment(db: Db, projectId: string, agentId: string, environmentId: string) {
  const agent = await db
    .select({ id: agents.id, archivedAt: agents.archivedAt })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    .get()
  if (!agent) {
    return { status: 404 as const, message: 'Agent not found' }
  }
  if (agent.archivedAt !== null) {
    return { status: 409 as const, message: 'Archived agents cannot be scheduled' }
  }
  const environment = await db
    .select({
      id: environments.id,
      archivedAt: environments.archivedAt,
      currentVersionId: environments.currentVersionId,
    })
    .from(environments)
    .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    .get()
  if (!environment || environment.archivedAt !== null || !environment.currentVersionId) {
    return { status: 409 as const, message: 'Selected environment is archived or unavailable' }
  }
  return null
}

async function findTrigger(db: Db, projectId: string, triggerId: string) {
  return (
    (await db
      .select()
      .from(triggers)
      .where(and(eq(triggers.id, triggerId), eq(triggers.projectId, projectId)))
      .get()) ?? null
  )
}

function triggerCursorFilter(cursor: string | undefined) {
  if (!cursor) {
    return undefined
  }
  const parsedCursor = parseListCursor(cursor)
  return or(
    lt(triggers.createdAt, parsedCursor.createdAt),
    and(eq(triggers.createdAt, parsedCursor.createdAt), lt(triggers.id, parsedCursor.id)),
  )
}

function runCursorFilter(cursor: string | undefined) {
  if (!cursor) {
    return undefined
  }
  const parsedCursor = parseListCursor(cursor)
  return or(
    lt(triggerRuns.createdAt, parsedCursor.createdAt),
    and(eq(triggerRuns.createdAt, parsedCursor.createdAt), lt(triggerRuns.id, parsedCursor.id)),
  )
}

const createRouteDefinition = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createTrigger',
  tags: ['Triggers'],
  summary: 'Create a trigger',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateTriggerSchema } } } },
  responses: {
    201: { description: 'Created trigger', content: { 'application/json': { schema: TriggerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listRouteDefinition = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listTriggers',
  tags: ['Triggers'],
  summary: 'List triggers',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Triggers', content: { 'application/json': { schema: TriggerListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}',
  operationId: 'readTrigger',
  tags: ['Triggers'],
  summary: 'Read a trigger',
  ...AuthenticatedOperation,
  request: { params: TriggerParamsSchema },
  responses: {
    200: { description: 'Trigger', content: { 'application/json': { schema: TriggerSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRouteDefinition = createRoute({
  method: 'patch',
  path: '/{triggerId}',
  operationId: 'updateTrigger',
  tags: ['Triggers'],
  summary: 'Update, pause, or archive a trigger',
  description:
    'Partial update. Pause with `enabled: false`; archive with `archived: true`; restore with `archived: false`.',
  ...AuthenticatedOperation,
  request: {
    params: TriggerParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateTriggerSchema } } },
  },
  responses: {
    200: { description: 'Updated trigger', content: { 'application/json': { schema: TriggerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listRunsRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}/runs',
  operationId: 'listTriggerRuns',
  tags: ['Triggers'],
  summary: 'List trigger runs',
  ...AuthenticatedOperation,
  request: { params: TriggerParamsSchema, query: RunsQuerySchema },
  responses: {
    200: { description: 'Trigger runs', content: { 'application/json': { schema: TriggerRunListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRunRouteDefinition = createRoute({
  method: 'get',
  path: '/{triggerId}/runs/{runId}',
  operationId: 'readTriggerRun',
  tags: ['Triggers'],
  summary: 'Read a trigger run',
  ...AuthenticatedOperation,
  request: { params: RunParamsSchema },
  responses: {
    200: { description: 'Trigger run', content: { 'application/json': { schema: TriggerRunSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger run not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    const secretConfigResponse = rejectSecretSessionConfig(c, body.resourceRefs, body.env)
    if (secretConfigResponse) {
      return secretConfigResponse
    }
    const invalidDependency = await assertLiveAgentAndEnvironment(db, auth.project.id, body.agentId, body.environmentId)
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
      id: newId('trigger'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      agentId: body.agentId,
      environmentId: body.environmentId,
      runtime: body.runtime,
      name: body.name,
      promptTemplate: body.promptTemplate,
      resourceRefs: stringify(body.resourceRefs ?? []),
      env: stringify(body.env ?? {}),
      secretEnv: stringify(body.secretEnv ?? []),
      intervalSeconds: body.schedule.intervalSeconds,
      windowSeconds: body.schedule.windowSeconds ?? 0,
      enabled: body.enabled ?? true,
      nextDueAt: body.nextDueAt ?? nextDueFromInterval(body.schedule.intervalSeconds),
      lastDispatchedAt: null,
      lastRunId: null,
      metadata: stringify(body.metadata ?? {}),
      createdByUserId: auth.user.id,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(triggers).values(row)
    await recordAudit(db, {
      auth,
      action: 'trigger.create',
      resourceType: 'trigger',
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
    const { archived, enabled, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursorFilter: ReturnType<typeof triggerCursorFilter>
    try {
      parsedCursorFilter = triggerCursorFilter(cursor)
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(triggers.projectId, auth.project.id),
      archived === 'true' ? isNotNull(triggers.archivedAt) : isNull(triggers.archivedAt),
      enabled !== undefined ? eq(triggers.enabled, enabled === 'true') : undefined,
      search ? like(triggers.name, `%${search}%`) : undefined,
      createdFrom ? gte(triggers.createdAt, createdFrom) : undefined,
      createdTo ? lte(triggers.createdAt, createdTo) : undefined,
      parsedCursorFilter,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(triggers)
      .where(and(...filters))
      .orderBy(desc(triggers.createdAt), desc(triggers.id))
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
      return errorResponse(c, 404, 'not_found', 'Trigger not found')
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
      return errorResponse(c, 404, 'not_found', 'Trigger not found')
    }
    if (trigger.archivedAt !== null && body.archived !== false) {
      return errorResponse(c, 409, 'conflict', 'Archived triggers cannot be updated')
    }
    const secretMetadataResponse = rejectSecretMetadata(c, body.metadata)
    if (secretMetadataResponse) {
      return secretMetadataResponse
    }
    const secretConfigResponse = rejectSecretSessionConfig(c, body.resourceRefs, body.env)
    if (secretConfigResponse) {
      return secretConfigResponse
    }
    const agentId = body.agentId ?? trigger.agentId
    const environmentId = body.environmentId ?? trigger.environmentId
    if (body.agentId !== undefined || body.environmentId !== undefined) {
      const invalidDependency = await assertLiveAgentAndEnvironment(db, auth.project.id, agentId, environmentId)
      if (invalidDependency) {
        return errorResponse(
          c,
          invalidDependency.status,
          invalidDependency.status === 404 ? 'not_found' : 'conflict',
          invalidDependency.message,
        )
      }
    }
    const timestamp = now()
    const archivedAt =
      body.archived === true ? (trigger.archivedAt ?? timestamp) : body.archived === false ? null : trigger.archivedAt
    const update = {
      agentId,
      environmentId,
      runtime: body.runtime ?? trigger.runtime,
      name: body.name ?? trigger.name,
      promptTemplate: body.promptTemplate ?? trigger.promptTemplate,
      resourceRefs: body.resourceRefs !== undefined ? stringify(body.resourceRefs) : trigger.resourceRefs,
      env: body.env !== undefined ? stringify(body.env) : trigger.env,
      secretEnv: body.secretEnv !== undefined ? stringify(body.secretEnv) : trigger.secretEnv,
      intervalSeconds: body.schedule?.intervalSeconds ?? trigger.intervalSeconds,
      windowSeconds: body.schedule?.windowSeconds ?? trigger.windowSeconds,
      enabled: body.enabled ?? trigger.enabled,
      archivedAt,
      nextDueAt: body.nextDueAt ?? trigger.nextDueAt,
      metadata: stringify(body.metadata ?? parseJson<Record<string, unknown>>(trigger.metadata, {})),
      updatedAt: timestamp,
    }
    await db.update(triggers).set(update).where(eq(triggers.id, trigger.id))
    const updated = await findTrigger(db, auth.project.id, trigger.id)
    if (!updated) {
      throw new Error('Updated trigger row is required')
    }
    await recordAudit(db, {
      auth,
      action: body.archived === true && trigger.archivedAt === null ? 'trigger.archive' : 'trigger.update',
      resourceType: 'trigger',
      resourceId: trigger.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeTrigger(trigger),
      after: serializeTrigger(updated),
    })
    return c.json(serializeTrigger(updated), 200)
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
      return errorResponse(c, 404, 'not_found', 'Trigger not found')
    }
    const { state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    let parsedCursorFilter: ReturnType<typeof runCursorFilter>
    try {
      parsedCursorFilter = runCursorFilter(cursor)
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(triggerRuns.triggerId, triggerId),
      eq(triggerRuns.projectId, auth.project.id),
      state ? eq(triggerRuns.state, state) : undefined,
      search ? like(triggerRuns.correlationId, `%${search}%`) : undefined,
      createdFrom ? gte(triggerRuns.createdAt, createdFrom) : undefined,
      createdTo ? lte(triggerRuns.createdAt, createdTo) : undefined,
      parsedCursorFilter,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(triggerRuns)
      .where(and(...filters))
      .orderBy(desc(triggerRuns.createdAt), desc(triggerRuns.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeRun), pagination: page.pagination }, 200)
  })
  .openapi(readRunRouteDefinition, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { triggerId, runId } = c.req.valid('param')
    const trigger = await findTrigger(db, auth.project.id, triggerId)
    if (!trigger) {
      return errorResponse(c, 404, 'not_found', 'Trigger not found')
    }
    const run = await db
      .select()
      .from(triggerRuns)
      .where(
        and(
          eq(triggerRuns.id, runId),
          eq(triggerRuns.triggerId, triggerId),
          eq(triggerRuns.projectId, auth.project.id),
        ),
      )
      .get()
    if (!run) {
      return errorResponse(c, 404, 'not_found', 'Trigger run not found')
    }
    return c.json(serializeRun(run), 200)
  })

export default routes
