import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ResourceMetadataSchema, ResourcePhaseSchema } from '@server/contracts/resource-contracts'
import { requireAuth } from '../auth/session'
import { RuntimeSchema } from '../contracts/environment-contracts'
import { VolumeMountSchema, VolumeSchema } from '../contracts/execution-spec'
import {
  AuthenticatedOperation,
  type DepsEnv,
  EnvFromEntrySchema,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { dispatchHttpTrigger } from '../usecases/dispatch-triggers'
import { type EnvFromEntry, TriggerConflictError, TriggerValidationError } from '../usecases/ports'
import { createTrigger, deleteTrigger, type UpdateTriggerPatch, updateTrigger } from '../usecases/triggers'
import { requestId } from './request-context'

type TriggerRoutes = OpenAPIHono<DepsEnv>

const RUN_STATES = ['claimed', 'dispatched', 'failed'] as const
const TRIGGER_TYPES = ['scheduled', 'http'] as const
const JsonObjectSchema = z.record(z.string(), z.unknown())
const EnvSchema = z.record(z.string(), z.string())

const TriggerScheduleSchema = z
  .object({
    type: z.literal('interval'),
    intervalSeconds: z.number().int().openapi({ example: 86400 }),
    windowSeconds: z.number().int().openapi({ example: 0 }),
  })
  .openapi('TriggerSchedule')

const TriggerSpecSchema = z
  .object({
    type: z.enum(TRIGGER_TYPES).openapi({ example: 'scheduled' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    promptTemplate: z.string().openapi({ example: 'Research current Canadian banking bonus offers.' }),
    env: EnvSchema.openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    envFrom: z.array(EnvFromEntrySchema).openapi({
      example: [
        {
          type: 'secret',
          name: 'AK_AGENT_KEY',
          secretRef: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123',
        },
      ],
    }),
    volumes: z.array(VolumeSchema).openapi({
      example: [{ name: 'project-secrets', type: 'secret', secretRef: 'ama://vaults/vault_abc123' }],
    }),
    volumeMounts: z.array(VolumeMountSchema).openapi({
      example: [{ name: 'project-secrets', mountPath: '/workspace/.ama/secrets/project', readOnly: true }],
    }),
    schedule: TriggerScheduleSchema.nullable().openapi({
      example: { type: 'interval', intervalSeconds: 86400, windowSeconds: 0 },
    }),
    enabled: z.boolean().openapi({ example: true }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'growth' } }),
  })
  .openapi('TriggerSpec')

const TriggerStatusSchema = z
  .object({
    phase: ResourcePhaseSchema,
    nextDueAt: z.string().datetime().nullable().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    lastDispatchedAt: z.string().datetime().nullable().openapi({ example: null }),
    lastRunId: z.string().nullable().openapi({ example: 'trigrun_abc123' }),
  })
  .openapi('TriggerStatus')

const TriggerSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: TriggerSpecSchema,
    status: TriggerStatusSchema,
  })
  .openapi('Trigger')

const TriggerRunSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: z
      .object({
        triggerId: z.string().openapi({ example: 'trigger_abc123' }),
        scheduledFor: z.string().datetime().nullable().openapi({ example: '2026-05-26T12:00:00.000Z' }),
        idempotencyKey: z.string().openapi({ example: 'trigger_abc123:2026-05-26T12:00:00.000Z' }),
        correlationId: z.string().openapi({ example: 'schedule:trigger_abc123:2026-05-26T12:00:00.000Z' }),
        metadata: JsonObjectSchema.openapi({ example: { source: 'trigger' } }),
      })
      .openapi('TriggerRunSpec'),
    status: z
      .object({
        phase: z.enum(RUN_STATES).openapi({ example: 'dispatched' }),
        heartbeatAt: z.string().datetime().nullable().openapi({ example: '2026-05-26T12:01:00.000Z' }),
        triggeredAt: z.string().datetime().openapi({ example: '2026-05-26T12:01:00.000Z' }),
        sessionId: z.string().nullable().openapi({ example: 'session_abc123' }),
        errorMessage: z.string().nullable().openapi({ example: null }),
      })
      .openapi('TriggerRunStatus'),
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
    type: z.enum(TRIGGER_TYPES).optional().openapi({ example: 'scheduled' }),
    agentId: z.string().min(1).openapi({ example: 'agent_abc123' }),
    // Optional: omit to leave the trigger unpinned and let each dispatch resolve
    // a runner-capable environment for the runtime.
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.openapi({ example: 'codex' }),
    name: z.string().min(1).max(160).openapi({ example: 'Daily research heartbeat' }),
    promptTemplate: z.string().trim().min(1).max(16000).openapi({
      example: 'Research current Canadian banking bonus offers.',
    }),
    env: EnvSchema.optional().openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    envFrom: z
      .array(EnvFromEntrySchema)
      .max(50)
      .optional()
      .openapi({
        example: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123',
          },
        ],
      }),
    volumes: z.array(VolumeSchema).max(50).optional(),
    volumeMounts: z.array(VolumeMountSchema).max(50).optional(),
    schedule: SchedulePayloadSchema.nullable().optional(),
    enabled: z.boolean().optional().openapi({ example: true }),
    nextDueAt: z.string().datetime().optional().openapi({ example: '2026-05-26T12:00:00.000Z' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'growth' } }),
  })
  .strict()
  .openapi('CreateTriggerRequest')

const UpdateTriggerSchema = z
  .object({
    type: z.enum(TRIGGER_TYPES).optional().openapi({ example: 'http' }),
    agentId: z.string().min(1).optional().openapi({ example: 'agent_abc123' }),
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    runtime: RuntimeSchema.optional().openapi({ example: 'codex' }),
    name: z.string().min(1).max(160).optional().openapi({ example: 'Daily research heartbeat' }),
    promptTemplate: z.string().trim().min(1).max(16000).optional().openapi({
      example: 'Research current Canadian banking bonus offers.',
    }),
    env: EnvSchema.optional().openapi({ example: { AK_API_URL: 'https://ak.example.com' } }),
    envFrom: z
      .array(EnvFromEntrySchema)
      .max(50)
      .optional()
      .openapi({
        example: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: 'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123',
          },
        ],
      }),
    volumes: z.array(VolumeSchema).max(50).optional(),
    volumeMounts: z.array(VolumeMountSchema).max(50).optional(),
    schedule: SchedulePayloadSchema.nullable().optional(),
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
    example: 'dispatched',
  })

const ListQuerySchema = listQuerySchema().extend({ enabled: enabledQuery })
const RunsQuerySchema = listQuerySchema().omit({ archived: true }).extend({ state: runStateQuery })
const TriggerListResponseSchema = listResponseSchema('TriggerListResponse', TriggerSchema)
const TriggerRunListResponseSchema = listResponseSchema('TriggerRunListResponse', TriggerRunSchema)
const CreateHttpTriggerRunRequestSchema = JsonObjectSchema.openapi('CreateHttpTriggerRunRequest', {
  example: { customer: { name: 'Ada' }, ticketId: 'T-123' },
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function normalizeEnvFrom(entries: z.infer<typeof EnvFromEntrySchema>[]): EnvFromEntry[] {
  return entries.map((entry) => ({
    type: 'secret',
    name: entry.name,
    secretRef: entry.secretRef,
    ...(entry.key ? { key: entry.key } : {}),
  }))
}

const TEMPLATE_HEADER_DENYLIST = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

function promptHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (!TEMPLATE_HEADER_DENYLIST.has(normalized)) {
      safe[normalized] = value
    }
  })
  return safe
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

const deleteRouteDefinition = createRoute({
  method: 'delete',
  path: '/{triggerId}',
  operationId: 'deleteTrigger',
  tags: ['Triggers'],
  summary: 'Delete a trigger',
  description: 'Permanently deletes the trigger and its run history.',
  ...AuthenticatedOperation,
  request: { params: TriggerParamsSchema },
  responses: {
    204: { description: 'Trigger deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
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

const createRunRouteDefinition = createRoute({
  method: 'post',
  path: '/{triggerId}/runs',
  operationId: 'createTriggerRun',
  tags: ['Triggers'],
  summary: 'Create an HTTP trigger run',
  description:
    'Creates a run for an HTTP trigger using the JSON body, query string, and allowed request headers as prompt template variables.',
  ...AuthenticatedOperation,
  request: {
    params: TriggerParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateHttpTriggerRunRequestSchema } } },
  },
  responses: {
    201: { description: 'Created trigger run', content: { 'application/json': { schema: TriggerRunSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Trigger not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
      const scope = auth
      try {
        const triggerType = body.type ?? 'scheduled'
        const trigger = await createTrigger(deps, scope, {
          agentId: body.agentId,
          environmentId: body.environmentId ?? null,
          config: {
            type: triggerType,
            runtime: body.runtime,
            name: body.name,
            promptTemplate: body.promptTemplate,
            env: body.env ?? {},
            envFrom: normalizeEnvFrom(body.envFrom ?? []),
            volumes: body.volumes ?? [],
            volumeMounts: body.volumeMounts ?? [],
            schedule:
              triggerType === 'scheduled' && body.schedule
                ? {
                    intervalSeconds: body.schedule.intervalSeconds,
                    windowSeconds: body.schedule.windowSeconds ?? 0,
                  }
                : null,
            enabled: body.enabled ?? true,
            nextDueAt: body.nextDueAt ?? null,
            metadata: body.metadata ?? {},
          },
        })
        await deps.audit.record(scope, {
          action: 'trigger.create',
          resourceType: 'trigger',
          resourceId: trigger.metadata.uid,
          outcome: 'success',
          requestId: requestId(c),
          after: trigger,
        })
        return c.json(trigger, 201)
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
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json({ data: page.rows, pagination: { limit, nextCursor, hasMore: page.hasMore } }, 200)
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
      return c.json(trigger, 200)
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
      const scope = auth
      try {
        const result = await updateTrigger(deps, scope, trigger, patchFromBody(body))
        await deps.audit.record(scope, {
          action: result.archived ? 'trigger.archive' : 'trigger.update',
          resourceType: 'trigger',
          resourceId: trigger.metadata.uid,
          outcome: 'success',
          requestId: requestId(c),
          before: trigger,
          after: result.trigger,
        })
        return c.json(result.trigger, 200)
      } catch (error) {
        return conflictOrValidation(c, error)
      }
    })
    .openapi(deleteRouteDefinition, async (c) => {
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
      const scope = auth
      await deleteTrigger(deps, scope, triggerId)
      await deps.audit.record(scope, {
        action: 'trigger.delete',
        resourceType: 'trigger',
        resourceId: trigger.metadata.uid,
        outcome: 'success',
        requestId: requestId(c),
        before: trigger,
      })
      return c.body(null, 204)
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
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json({ data: page.rows, pagination: { limit, nextCursor, hasMore: page.hasMore } }, 200)
    })
    .openapi(createRunRouteDefinition, async (c) => {
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
      try {
        const result = await dispatchHttpTrigger(deps, auth, {
          trigger,
          context: {
            body: c.req.valid('json'),
            query: c.req.query(),
            headers: promptHeaders(c.req.raw.headers),
          },
          idempotencyKey: c.req.header('idempotency-key') ?? null,
        })
        const run = await deps.triggers.findRun(auth.project.id, triggerId, result.runId)
        if (!run) {
          throw new Error('HTTP trigger run was not persisted')
        }
        return c.json(run, 201)
      } catch (error) {
        return conflictOrValidation(c, error)
      }
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
      return c.json(run, 200)
    })
}

// --- helpers ---

function patchFromBody(body: z.infer<typeof UpdateTriggerSchema>): UpdateTriggerPatch {
  return {
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
    ...(body.environmentId !== undefined ? { environmentId: body.environmentId } : {}),
    ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.promptTemplate !== undefined ? { promptTemplate: body.promptTemplate } : {}),
    ...(body.env !== undefined ? { env: body.env } : {}),
    ...(body.envFrom !== undefined ? { envFrom: normalizeEnvFrom(body.envFrom) } : {}),
    ...(body.volumes !== undefined ? { volumes: body.volumes } : {}),
    ...(body.volumeMounts !== undefined ? { volumeMounts: body.volumeMounts } : {}),
    ...(body.schedule === null
      ? { schedule: null }
      : body.schedule !== undefined
        ? {
            schedule: {
              ...(body.schedule.intervalSeconds !== undefined
                ? { intervalSeconds: body.schedule.intervalSeconds }
                : {}),
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
