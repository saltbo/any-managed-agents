import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requestId } from '../audit'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
  SecretEnvEntrySchema,
} from '../openapi'
import { RuntimeSchema } from '../routes/environment-contracts'
import {
  type AuthScope,
  type SecretEnvEntry,
  TriggerConflictError,
  type TriggerRecord,
  type TriggerRunRecord,
  TriggerValidationError,
} from '../usecases/ports'
import { createTrigger, type UpdateTriggerPatch, updateTrigger } from '../usecases/triggers'

type TriggerRoutes = OpenAPIHono<DepsEnv>

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

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

// Drops the absent versionId entirely so the entry matches the exactOptional
// SecretEnvEntry contract (no explicit undefined on the wire-facing type).
function normalizeSecretEnv(entries: z.infer<typeof SecretEnvEntrySchema>[]): SecretEnvEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    credentialRef: {
      credentialId: entry.credentialRef.credentialId,
      ...(entry.credentialRef.versionId ? { versionId: entry.credentialRef.versionId } : {}),
    },
  }))
}

function serializeTrigger(record: TriggerRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    agentId: record.agentId,
    environmentId: record.environmentId,
    runtime: record.runtime,
    name: record.name,
    promptTemplate: record.promptTemplate,
    resourceRefs: record.resourceRefs,
    env: record.env,
    secretEnv: record.secretEnv,
    schedule: {
      type: 'interval' as const,
      intervalSeconds: record.schedule.intervalSeconds,
      windowSeconds: record.schedule.windowSeconds,
    },
    enabled: record.enabled,
    nextDueAt: record.nextDueAt,
    lastDispatchedAt: record.lastDispatchedAt,
    lastRunId: record.lastRunId,
    metadata: record.metadata,
    createdByUserId: record.createdByUserId,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeRun(record: TriggerRunRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    triggerId: record.triggerId,
    scheduledFor: record.scheduledFor,
    heartbeatAt: record.heartbeatAt,
    state: record.state,
    idempotencyKey: record.idempotencyKey,
    sessionId: record.sessionId,
    correlationId: record.correlationId,
    errorMessage: record.errorMessage,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
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

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the triggers resource's original mount position.
export function registerTriggerRoutes(routes: TriggerRoutes) {
  return routes
    .openapi(createRouteDefinition, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = authScope(auth)
      try {
        const trigger = await createTrigger(deps, scope, {
          agentId: body.agentId,
          environmentId: body.environmentId,
          config: {
            runtime: body.runtime,
            name: body.name,
            promptTemplate: body.promptTemplate,
            resourceRefs: body.resourceRefs ?? [],
            env: body.env ?? {},
            secretEnv: normalizeSecretEnv(body.secretEnv ?? []),
            schedule: {
              intervalSeconds: body.schedule.intervalSeconds,
              windowSeconds: body.schedule.windowSeconds ?? 0,
            },
            enabled: body.enabled ?? true,
            nextDueAt: body.nextDueAt ?? null,
            metadata: body.metadata ?? {},
          },
        })
        await deps.audit.record(scope, {
          action: 'trigger.create',
          resourceType: 'trigger',
          resourceId: trigger.id,
          outcome: 'success',
          requestId: requestId(c),
          after: serializeTrigger(trigger),
        })
        return c.json(serializeTrigger(trigger), 201)
      } catch (error) {
        return conflictOrValidation(c, error)
      }
    })
    .openapi(listRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, enabled, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(
          errorBody('validation_error', 'Invalid list cursor', { fields: { cursor: 'Cursor is invalid.' } }),
          400,
        )
      }
      const page = await deps.triggers.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(enabled !== undefined ? { enabled: enabled === 'true' } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeTrigger), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const trigger = await deps.triggers.find(auth.project.id, c.req.valid('param').triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      return c.json(serializeTrigger(trigger), 200)
    })
    .openapi(updateRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const scope = authScope(auth)
      try {
        const result = await updateTrigger(deps, scope, trigger, patchFromBody(body))
        await deps.audit.record(scope, {
          action: result.archived ? 'trigger.archive' : 'trigger.update',
          resourceType: 'trigger',
          resourceId: trigger.id,
          outcome: 'success',
          requestId: requestId(c),
          before: serializeTrigger(trigger),
          after: serializeTrigger(result.trigger),
        })
        return c.json(serializeTrigger(result.trigger), 200)
      } catch (error) {
        return conflictOrValidation(c, error)
      }
    })
    .openapi(listRunsRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId } = c.req.valid('param')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const { state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(
          errorBody('validation_error', 'Invalid list cursor', { fields: { cursor: 'Cursor is invalid.' } }),
          400,
        )
      }
      const page = await deps.triggers.listRuns({
        projectId: auth.project.id,
        triggerId,
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
        { data: page.rows.map(serializeRun), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readRunRouteDefinition, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { triggerId, runId } = c.req.valid('param')
      const trigger = await deps.triggers.find(auth.project.id, triggerId)
      if (!trigger) {
        return c.json(errorBody('not_found', 'Trigger not found'), 404)
      }
      const run = await deps.triggers.findRun(auth.project.id, triggerId, runId)
      if (!run) {
        return c.json(errorBody('not_found', 'Trigger run not found'), 404)
      }
      return c.json(serializeRun(run), 200)
    })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}

function patchFromBody(body: z.infer<typeof UpdateTriggerSchema>): UpdateTriggerPatch {
  return {
    ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
    ...(body.environmentId !== undefined ? { environmentId: body.environmentId } : {}),
    ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.promptTemplate !== undefined ? { promptTemplate: body.promptTemplate } : {}),
    ...(body.resourceRefs !== undefined ? { resourceRefs: body.resourceRefs } : {}),
    ...(body.env !== undefined ? { env: body.env } : {}),
    ...(body.secretEnv !== undefined ? { secretEnv: normalizeSecretEnv(body.secretEnv) } : {}),
    ...(body.schedule !== undefined
      ? {
          schedule: {
            ...(body.schedule.intervalSeconds !== undefined ? { intervalSeconds: body.schedule.intervalSeconds } : {}),
            ...(body.schedule.windowSeconds !== undefined ? { windowSeconds: body.schedule.windowSeconds } : {}),
          },
        }
      : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
    ...(body.nextDueAt !== undefined ? { nextDueAt: body.nextDueAt } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  }
}

function conflictOrValidation(c: Parameters<Parameters<TriggerRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof TriggerValidationError) {
    return c.json(errorBody('validation_error', error.message, { fields: error.fields }), 400)
  }
  if (error instanceof TriggerConflictError) {
    return c.json(errorBody(error.status === 404 ? 'not_found' : 'conflict', error.message), error.status)
  }
  throw error
}
