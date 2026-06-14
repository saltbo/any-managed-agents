import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { RUNNER_AUTH_MODES } from '@server/domain/runner-queue'
import { isRunnerOidcAuth, requireAuth } from '../auth/session'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  CredentialRefSchema,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { type RunnerAuthRecord, RunnerConflictError, RunnerValidationError } from '../usecases/ports'
import { recordRunnerHeartbeat, registerRunner, updateRunner } from '../usecases/runners'
import { requestId } from './request-context'
import { runnerForbidden, runnerOidcContext, runnerOperationAuthorized } from './runner-auth'

type RunnerRoutes = OpenAPIHono<DepsEnv>

const RUNNER_STATES = ['active', 'draining', 'disabled', 'offline'] as const

const JsonObjectSchema = z.record(z.string(), z.unknown())
const CapabilitySchema = z.string().min(1).max(120)

const RuntimeUsageWindowSchema = z
  .object({
    label: z.string().openapi({ example: '5-Hour' }),
    utilization: z.number().openapi({ example: 23 }),
    resetsAt: z.string().openapi({ example: '2026-06-09T08:30:00.000Z' }),
  })
  .openapi('RuntimeUsageWindow')

const RuntimeUsageSchema = z
  .object({
    runtime: z.string().openapi({ example: 'claude-code' }),
    windows: z.array(RuntimeUsageWindowSchema),
  })
  .openapi('RuntimeUsage')

const RUNTIME_INVENTORY_STATES = [
  'ready',
  'missing',
  'unauthenticated',
  'unauthorized',
  'limited',
  'unhealthy',
] as const

const RuntimeInventorySchema = z
  .object({
    runtime: z.string().min(1).max(60).openapi({ example: 'codex' }),
    version: z.string().max(120).optional().openapi({ example: '0.42.0' }),
    state: z.enum(RUNTIME_INVENTORY_STATES).openapi({ example: 'ready' }),
    detail: z.string().max(400).optional().openapi({ example: 'host CLI enumerated 2 models' }),
  })
  .strict()
  .openapi('RunnerRuntimeInventory')

const RunnerSchema = z
  .object({
    id: z.string().openapi({ example: 'runner_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'mac-mini-build-runner' }),
    capabilities: z.array(CapabilitySchema).openapi({ example: ['node', 'git', 'sandbox.exec'] }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    credentialRef: CredentialRefSchema.nullable(),
    authMode: z.enum(RUNNER_AUTH_MODES).openapi({ example: 'oidc' }),
    state: z.enum(RUNNER_STATES).openapi({ example: 'active' }),
    currentLoad: z.number().int().openapi({ example: 0 }),
    maxConcurrent: z.number().int().openapi({ example: 2 }),
    runtimeUsage: z.array(RuntimeUsageSchema).openapi({ example: [] }),
    runtimeInventory: z.array(RuntimeInventorySchema).openapi({ example: [] }),
    metadata: JsonObjectSchema.openapi({ example: { pool: 'default' } }),
    lastHeartbeatAt: z.string().datetime().nullable(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Runner')

// Singleton liveness sub-resource: the runner's current heartbeat state.
const RunnerHeartbeatSchema = z
  .object({
    runnerId: z.string().openapi({ example: 'runner_abc123' }),
    state: z.enum(RUNNER_STATES).openapi({ example: 'active' }),
    currentLoad: z.number().int().openapi({ example: 1 }),
    runtimeUsage: z.array(RuntimeUsageSchema).openapi({ example: [] }),
    runtimeInventory: z.array(RuntimeInventorySchema).openapi({ example: [] }),
    lastHeartbeatAt: z.string().datetime().nullable(),
  })
  .openapi('RunnerHeartbeat')

const CreateRunnerSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'mac-mini-build-runner' }),
    capabilities: z
      .array(CapabilitySchema)
      .max(100)
      .optional()
      .openapi({ example: ['node', 'git'] }),
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    credentialRef: CredentialRefSchema.optional(),
    authMode: z.enum(RUNNER_AUTH_MODES).optional().openapi({ example: 'bearer' }),
    maxConcurrent: z.number().int().min(1).max(100).optional().openapi({ example: 2 }),
    metadata: JsonObjectSchema.optional().openapi({ example: { pool: 'default' } }),
  })
  .strict()
  .openapi('CreateRunnerRequest')

const UpdateRunnerSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    capabilities: z.array(CapabilitySchema).max(100).optional(),
    state: z.enum(['active', 'draining', 'disabled']).optional(),
    maxConcurrent: z.number().int().min(1).max(100).optional(),
    metadata: JsonObjectSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .openapi('UpdateRunnerRequest')

const PutHeartbeatSchema = z
  .object({
    state: z.enum(['active', 'draining', 'offline']).optional().openapi({ example: 'active' }),
    capabilities: z
      .array(CapabilitySchema)
      .max(100)
      .optional()
      .openapi({ example: ['node', 'git'] }),
    currentLoad: z.number().int().min(0).max(1000).optional().openapi({ example: 1 }),
    runtimeUsage: z.array(RuntimeUsageSchema).max(20).optional(),
    runtimeInventory: z.array(RuntimeInventorySchema).max(20).optional(),
    metadata: JsonObjectSchema.optional().openapi({ example: { hostname: 'runner-1' } }),
  })
  .strict()
  .openapi('PutRunnerHeartbeatRequest')

const ParamsSchema = z.object({
  runnerId: z.string().openapi({ param: { name: 'runnerId', in: 'path' }, example: 'runner_abc123' }),
})

const RunnerListQuerySchema = listQuerySchema().extend({
  state: z
    .enum(RUNNER_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'active' }),
  environmentId: z
    .string()
    .optional()
    .openapi({ param: { name: 'environmentId', in: 'query' }, example: 'env_abc123' }),
})

const RunnerListResponseSchema = listResponseSchema('RunnerListResponse', RunnerSchema)

type RuntimeInventoryDto = z.infer<typeof RuntimeInventorySchema>

// Drops absent optional keys so the strict port RuntimeInventoryEntry shape is
// satisfied under exactOptionalPropertyTypes.
function normalizeInventory(inventory: RuntimeInventoryDto[]) {
  return inventory.map((entry) => ({
    runtime: entry.runtime,
    state: entry.state,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  }))
}

// The stored runtime inventory carries free-form state strings; the wire schema
// pins them to the inventory-state enum.
function serializeInventory(inventory: RunnerAuthRecord['runtimeInventory']): RuntimeInventoryDto[] {
  return inventory.map((entry) => ({
    runtime: entry.runtime,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    state: entry.state as RuntimeInventoryDto['state'],
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  }))
}

// The wire DTO drops tenancy + OIDC binding columns the auth record carries.
function serializeRunner(runner: RunnerAuthRecord) {
  return {
    id: runner.id,
    projectId: runner.projectId,
    name: runner.name,
    capabilities: runner.capabilities,
    environmentId: runner.environmentId,
    credentialRef: runner.credentialRef,
    authMode: runner.authMode,
    state: runner.state as (typeof RUNNER_STATES)[number],
    currentLoad: runner.currentLoad,
    maxConcurrent: runner.maxConcurrent,
    runtimeUsage: runner.runtimeUsage,
    runtimeInventory: serializeInventory(runner.runtimeInventory),
    metadata: runner.metadata,
    lastHeartbeatAt: runner.lastHeartbeatAt,
    archivedAt: runner.archivedAt,
    createdAt: runner.createdAt,
    updatedAt: runner.updatedAt,
  }
}

function serializeHeartbeat(runner: RunnerAuthRecord) {
  return {
    runnerId: runner.id,
    state: runner.state as (typeof RUNNER_STATES)[number],
    currentLoad: runner.currentLoad,
    runtimeUsage: runner.runtimeUsage,
    runtimeInventory: serializeInventory(runner.runtimeInventory),
    lastHeartbeatAt: runner.lastHeartbeatAt,
  }
}

const createRunnerRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createRunner',
  tags: ['Runners'],
  summary: 'Register a self-hosted runner',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateRunnerSchema } } } },
  responses: {
    201: { description: 'Created runner', content: { 'application/json': { schema: RunnerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listRunnersRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listRunners',
  tags: ['Runners'],
  summary: 'List self-hosted runners',
  ...AuthenticatedOperation,
  request: { query: RunnerListQuerySchema },
  responses: {
    200: { description: 'Runner list', content: { 'application/json': { schema: RunnerListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRunnerRoute = createRoute({
  method: 'get',
  path: '/{runnerId}',
  operationId: 'readRunner',
  tags: ['Runners'],
  summary: 'Read a self-hosted runner',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Runner', content: { 'application/json': { schema: RunnerSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRunnerRoute = createRoute({
  method: 'patch',
  path: '/{runnerId}',
  operationId: 'updateRunner',
  tags: ['Runners'],
  summary: 'Update or archive a self-hosted runner',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateRunnerSchema } } },
  },
  responses: {
    200: { description: 'Updated runner', content: { 'application/json': { schema: RunnerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readHeartbeatRoute = createRoute({
  method: 'get',
  path: '/{runnerId}/heartbeat',
  operationId: 'readRunnerHeartbeat',
  tags: ['Runners'],
  summary: 'Read the current runner heartbeat state',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Runner heartbeat', content: { 'application/json': { schema: RunnerHeartbeatSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const putHeartbeatRoute = createRoute({
  method: 'put',
  path: '/{runnerId}/heartbeat',
  operationId: 'putRunnerHeartbeat',
  tags: ['Runners'],
  summary: 'Replace the current runner heartbeat state',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: PutHeartbeatSchema } } },
  },
  responses: {
    200: { description: 'Runner heartbeat', content: { 'application/json': { schema: RunnerHeartbeatSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

function validationOr(c: Parameters<Parameters<RunnerRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof RunnerValidationError) {
    return c.json(
      {
        error: {
          type: 'validation_error',
          message: error.message,
          ...(error.fields ? { details: { fields: error.fields } } : {}),
        },
      },
      400,
    )
  }
  if (error instanceof RunnerConflictError) {
    return c.json({ error: { type: 'conflict', message: error.message } }, 409)
  }
  throw error
}

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the runners resource's original mount position.
export function registerRunnerRoutes(routes: RunnerRoutes) {
  return routes
    .openapi(createRunnerRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      try {
        const credentialRef = body.credentialRef
          ? {
              credentialId: body.credentialRef.credentialId,
              ...(body.credentialRef.versionId ? { versionId: body.credentialRef.versionId } : {}),
            }
          : undefined
        const { runner, reregistered } = await registerRunner(deps, auth, runnerOidcContext(c.env, auth), {
          name: body.name,
          capabilities: body.capabilities ?? [],
          ...(body.environmentId ? { environmentId: body.environmentId } : { environmentId: undefined }),
          ...(credentialRef ? { credentialRef } : { credentialRef: undefined }),
          ...(body.authMode ? { authMode: body.authMode } : { authMode: undefined }),
          maxConcurrent: body.maxConcurrent ?? 1,
          metadata: body.metadata ?? {},
        })
        await deps.audit.record(auth, {
          action: reregistered ? 'runner.update' : 'runner.create',
          resourceType: 'runner',
          resourceId: runner.id,
          outcome: 'success',
          requestId: requestId(c),
          metadata: { environmentId: runner.environmentId },
        })
        return c.json(serializeRunner(runner), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(listRunnersRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const {
        archived,
        state,
        search,
        createdFrom,
        createdTo,
        limit = 50,
        cursor,
        environmentId,
      } = c.req.valid('query')
      const runnerToken = isRunnerOidcAuth(c.env, auth)
      if (runnerToken && !auth.oidc.runnerId && !auth.oidc.clientId) {
        return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource')
      }
      let parsedCursor: ReturnType<typeof parseListCursor> | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
          fields: { cursor: 'Cursor is invalid.' },
        })
      }
      const page = await deps.runners.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(state ? { state } : {}),
        ...(environmentId ? { environmentId } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        // Runner tokens only see their own runner(s).
        ...(runnerToken && auth.oidc.runnerId ? { runnerId: auth.oidc.runnerId } : {}),
        ...(runnerToken && !auth.oidc.runnerId ? { oidcSubject: auth.oidc.subject } : {}),
        ...(runnerToken && !auth.oidc.runnerId && auth.oidc.clientId ? { oidcClientId: auth.oidc.clientId } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeRunner), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(readRunnerRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      return c.json(serializeRunner(runner), 200)
    })
    .openapi(updateRunnerRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      try {
        const result = await updateRunner(deps, auth.project.id, runner, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
          ...(body.state !== undefined ? { state: body.state } : {}),
          ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          ...(body.archived !== undefined ? { archived: body.archived } : {}),
        })
        return c.json(serializeRunner(result), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readHeartbeatRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      return c.json(serializeHeartbeat(runner), 200)
    })
    .openapi(putHeartbeatRoute, async (c) => {
      const { runnerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const runner = await deps.runners.find(auth.project.id, runnerId)
      if (!runner) {
        return errorResponse(c, 404, 'not_found', 'Runner not found')
      }
      if (!runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
      try {
        const updated = await recordRunnerHeartbeat(deps, auth.project.id, runner, {
          ...(body.state !== undefined ? { state: body.state } : {}),
          ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
          ...(body.currentLoad !== undefined ? { currentLoad: body.currentLoad } : {}),
          ...(body.runtimeUsage !== undefined ? { runtimeUsage: body.runtimeUsage } : {}),
          ...(body.runtimeInventory !== undefined
            ? { runtimeInventory: normalizeInventory(body.runtimeInventory) }
            : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        })
        return c.json(serializeHeartbeat(updated), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
}
