import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, isRunnerOidcAuth, requireAuth } from '../auth/session'
import { environments, runners, vaultCredentials, vaultCredentialVersions } from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  CredentialRefSchema,
  createApiRouter,
  ErrorResponseSchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import { redactSensitiveValue } from '../redaction'

const app = createApiRouter()

export const RUNNER_STATES = ['active', 'draining', 'disabled', 'offline'] as const

export const JsonObjectSchema = z.record(z.string(), z.unknown())
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
    authMode: z.string().openapi({ example: 'oidc' }),
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
    authMode: z.enum(['bearer', 'mtls', 'oidc', 'federated']).optional().openapi({ example: 'bearer' }),
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

export type Db = ReturnType<typeof drizzle>
export type RunnerRow = typeof runners.$inferSelect

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function now() {
  return new Date().toISOString()
}

export function parseJson<T>(value: string | null) {
  return value ? (redactSensitiveValue(JSON.parse(value)) as T) : null
}

export function parseRawJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

export function stringify(value: unknown) {
  return JSON.stringify(redactSensitiveValue(value))
}

function secretKey(key: string) {
  return /secret|token|password|api[_-]?key/i.test(key)
}

export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

export function serializeRunner(row: RunnerRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    capabilities: parseJson<string[]>(row.capabilities) ?? [],
    environmentId: row.environmentId,
    credentialRef: row.credentialId
      ? { credentialId: row.credentialId, ...(row.credentialVersionId ? { versionId: row.credentialVersionId } : {}) }
      : null,
    authMode: row.authMode,
    state: row.state as (typeof RUNNER_STATES)[number],
    currentLoad: row.currentLoad,
    maxConcurrent: row.maxConcurrent,
    runtimeUsage: parseRawJson<z.infer<typeof RuntimeUsageSchema>[]>(row.runtimeUsage) ?? [],
    runtimeInventory: parseRawJson<z.infer<typeof RuntimeInventorySchema>[]>(row.runtimeInventory) ?? [],
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
    lastHeartbeatAt: row.lastHeartbeatAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeHeartbeat(row: RunnerRow) {
  return {
    runnerId: row.id,
    state: row.state as (typeof RUNNER_STATES)[number],
    currentLoad: row.currentLoad,
    runtimeUsage: parseRawJson<z.infer<typeof RuntimeUsageSchema>[]>(row.runtimeUsage) ?? [],
    runtimeInventory: parseRawJson<z.infer<typeof RuntimeInventorySchema>[]>(row.runtimeInventory) ?? [],
    lastHeartbeatAt: row.lastHeartbeatAt,
  }
}

export async function findRunner(db: Db, auth: AuthContext, runnerId: string) {
  return (
    (await db
      .select()
      .from(runners)
      .where(and(eq(runners.id, runnerId), eq(runners.projectId, auth.project.id)))
      .get()) ?? null
  )
}

export function runnerOperationAuthorized(env: Env, auth: AuthContext, runner: RunnerRow) {
  if (isRunnerOidcAuth(env, auth)) {
    if (runner.authMode === 'federated') {
      return runner.oidcSubject === auth.oidc.subject
    }
    return (
      runner.authMode === 'oidc' &&
      runner.oidcSubject === auth.oidc.subject &&
      !!runner.oidcClientId &&
      runner.oidcClientId === auth.oidc.clientId
    )
  }
  if (runner.authMode !== 'oidc') {
    return true
  }
  if (!runner.oidcSubject || !runner.oidcClientId) {
    return false
  }
  return runner.oidcSubject === auth.oidc.subject && runner.oidcClientId === auth.oidc.clientId
}

export function runnerForbidden(c: Context<{ Bindings: Env }>) {
  return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this runner')
}

function runnerOidcBindingFields(env: Env, auth: AuthContext, authMode: string) {
  if (!isRunnerOidcAuth(env, auth)) {
    return null
  }
  if (auth.oidc.runnerProjectId || auth.oidc.externalTenantId || auth.oidc.runnerEnvironmentId) {
    if (authMode !== 'federated') {
      return { authMode: 'Federated runner tokens can only register federated runners.' }
    }
    if (!auth.oidc.runnerProjectId && !auth.oidc.externalTenantId) {
      return { authorization: 'Federated runner token did not include a project or external tenant binding.' }
    }
    return null
  }
  if (authMode !== 'oidc') {
    return { authMode: 'Runner device-login tokens can only register OIDC-authenticated runners.' }
  }
  if (!auth.oidc.clientId) {
    return { authorization: 'Runner OIDC token did not include a bindable client id.' }
  }
  return null
}

function runnerAuthModeForRegistration(auth: AuthContext, requested: string | undefined) {
  return (
    requested ??
    (auth.oidc.runnerProjectId || auth.oidc.externalTenantId || auth.oidc.runnerEnvironmentId ? 'federated' : 'oidc')
  )
}

function runnerMachineId(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.machineId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function findRunnerForMachineRegistration(
  db: Db,
  auth: AuthContext,
  authMode: string,
  environmentId: string | undefined,
  machineId: string | null,
) {
  if (!machineId || (authMode !== 'federated' && authMode !== 'oidc')) {
    return null
  }
  return (
    (await db
      .select()
      .from(runners)
      .where(
        and(
          eq(runners.projectId, auth.project.id),
          eq(runners.authMode, authMode),
          eq(runners.oidcSubject, auth.oidc.subject),
          environmentId ? eq(runners.environmentId, environmentId) : isNull(runners.environmentId),
          sql`json_extract(${runners.metadata}, '$.machineId') = ${machineId}`,
        ),
      )
      .get()) ?? null
  )
}

function environmentIdForRegistration(auth: AuthContext, requested: string | undefined) {
  return auth.oidc.runnerEnvironmentId ?? requested
}

async function validateEnvironment(db: Db, auth: AuthContext, environmentId: string | undefined) {
  if (!environmentId) {
    return true
  }
  const environment = await db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.id, environmentId),
        eq(environments.projectId, auth.project.id),
        isNull(environments.archivedAt),
      ),
    )
    .get()
  return Boolean(environment)
}

async function validateRunnerCredentialRef(
  db: Db,
  auth: AuthContext,
  credentialRef: { credentialId: string; versionId?: string | undefined } | undefined,
) {
  if (!credentialRef) {
    return null
  }
  const credential = await db
    .select({ id: vaultCredentials.id })
    .from(vaultCredentials)
    .where(
      and(
        eq(vaultCredentials.id, credentialRef.credentialId),
        eq(vaultCredentials.organizationId, auth.organization.id),
        or(eq(vaultCredentials.projectId, auth.project.id), isNull(vaultCredentials.projectId)),
        eq(vaultCredentials.state, 'active'),
      ),
    )
    .get()
  if (!credential) {
    return { credentialRef: 'Runner credential reference is not an active vault credential.' }
  }
  if (credentialRef.versionId) {
    const version = await db
      .select({ id: vaultCredentialVersions.id })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, credentialRef.versionId),
          eq(vaultCredentialVersions.credentialId, credentialRef.credentialId),
          eq(vaultCredentialVersions.state, 'active'),
        ),
      )
      .get()
    if (!version) {
      return { credentialRef: 'Runner credential reference is not an active credential version.' }
    }
  }
  return null
}

// Self-hosted runner session channels live in a per-session Durable Object.
// Both helpers are consumed by app.ts and the sessions domain; their
// signatures are part of the cross-domain contract and must not change.
export async function hasAcceptedRunnerSessionChannel(env: Env, sessionId: string) {
  const id = env.RUNNER_SESSION_CHANNEL.idFromName(sessionId)
  const stub = env.RUNNER_SESSION_CHANNEL.get(id)
  const response = await stub.fetch('https://runner-session-channel/status')
  if (!response.ok) {
    return false
  }
  const body = (await response.json()) as { active?: boolean }
  return body.active === true
}

export async function dispatchRunnerSessionCommand(env: Env, sessionId: string, command: Record<string, unknown>) {
  const id = env.RUNNER_SESSION_CHANNEL.idFromName(sessionId)
  const stub = env.RUNNER_SESSION_CHANNEL.get(id)
  const response = await stub.fetch('https://runner-session-channel/dispatch', {
    method: 'POST',
    body: JSON.stringify(command),
  })
  return response.status === 202
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

const routes = app
  .openapi(createRunnerRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    if (hasSecretMaterial(body.metadata) || hasSecretMaterial(body.capabilities)) {
      return errorResponse(c, 400, 'validation_error', 'Runner metadata must not contain raw secret material')
    }
    const environmentId = environmentIdForRegistration(auth, body.environmentId)
    if (!(await validateEnvironment(db, auth, environmentId))) {
      return errorResponse(c, 409, 'conflict', 'Runner environment is unavailable')
    }
    const authMode = runnerAuthModeForRegistration(auth, body.authMode)
    const oidcBindingFields = runnerOidcBindingFields(c.env, auth, authMode)
    if (oidcBindingFields) {
      return errorResponse(c, 400, 'validation_error', 'Runner OIDC token is missing required binding claims', {
        fields: oidcBindingFields,
      })
    }
    const credentialFields = await validateRunnerCredentialRef(db, auth, body.credentialRef)
    if (credentialFields) {
      return errorResponse(c, 400, 'validation_error', 'Runner credential reference is invalid', {
        fields: credentialFields,
      })
    }
    const timestamp = now()
    const machineId = runnerMachineId(body.metadata)
    const reusableRunner = await findRunnerForMachineRegistration(db, auth, authMode, environmentId, machineId)
    const runnerId = reusableRunner?.id ?? newId('runner')
    const existingRunner = reusableRunner ?? (await db.select().from(runners).where(eq(runners.id, runnerId)).get())
    const runner = {
      id: runnerId,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      name: body.name,
      capabilities: stringify(body.capabilities ?? []),
      environmentId: environmentId ?? null,
      credentialId: body.credentialRef?.credentialId ?? null,
      credentialVersionId: body.credentialRef?.versionId ?? null,
      authMode,
      oidcSubject: auth.oidc.subject,
      oidcClientId: auth.oidc.clientId,
      state: 'offline',
      currentLoad: 0,
      maxConcurrent: body.maxConcurrent ?? 1,
      runtimeUsage: '[]',
      runtimeInventory: '[]',
      metadata: stringify(body.metadata ?? {}),
      lastHeartbeatAt: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (existingRunner) {
      if (
        existingRunner.projectId !== auth.project.id ||
        existingRunner.authMode !== 'federated' ||
        existingRunner.oidcSubject !== auth.oidc.subject
      ) {
        return errorResponse(c, 409, 'conflict', 'Runner id is already registered')
      }
      await db
        .update(runners)
        .set({
          organizationId: runner.organizationId,
          projectId: runner.projectId,
          name: runner.name,
          capabilities: runner.capabilities,
          environmentId: runner.environmentId,
          credentialId: runner.credentialId,
          credentialVersionId: runner.credentialVersionId,
          authMode: runner.authMode,
          oidcSubject: runner.oidcSubject,
          oidcClientId: runner.oidcClientId,
          maxConcurrent: runner.maxConcurrent,
          metadata: runner.metadata,
          archivedAt: null,
          updatedAt: runner.updatedAt,
        })
        .where(and(eq(runners.id, runner.id), eq(runners.projectId, auth.project.id)))
      const updatedRunner = await findRunner(db, auth, runner.id)
      if (!updatedRunner) {
        throw new Error('Federated runner registration update did not return a runner')
      }
      await recordAudit(db, {
        auth,
        action: 'runner.update',
        resourceType: 'runner',
        resourceId: updatedRunner.id,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { environmentId: updatedRunner.environmentId },
      })
      return c.json(serializeRunner(updatedRunner), 201)
    }
    await db.insert(runners).values(runner)
    await recordAudit(db, {
      auth,
      action: 'runner.create',
      resourceType: 'runner',
      resourceId: runner.id,
      outcome: 'success',
      requestId: requestId(c),
      metadata: { environmentId: runner.environmentId },
    })
    return c.json(serializeRunner(runner), 201)
  })
  .openapi(listRunnersRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { archived, state, search, createdFrom, createdTo, limit = 50, cursor, environmentId } = c.req.valid('query')
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
    const filters = [
      eq(runners.projectId, auth.project.id),
      runnerToken && auth.oidc.runnerId ? eq(runners.id, auth.oidc.runnerId) : undefined,
      runnerToken && !auth.oidc.runnerId ? eq(runners.oidcSubject, auth.oidc.subject) : undefined,
      runnerToken && !auth.oidc.runnerId && auth.oidc.clientId
        ? eq(runners.oidcClientId, auth.oidc.clientId)
        : undefined,
      archived === 'true' ? isNotNull(runners.archivedAt) : isNull(runners.archivedAt),
      state ? eq(runners.state, state) : undefined,
      environmentId ? eq(runners.environmentId, environmentId) : undefined,
      search ? like(runners.name, `%${search}%`) : undefined,
      createdFrom ? gte(runners.createdAt, createdFrom) : undefined,
      createdTo ? lte(runners.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(runners.createdAt, parsedCursor.createdAt),
            and(eq(runners.createdAt, parsedCursor.createdAt), lt(runners.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(runners)
      .where(and(...filters))
      .orderBy(desc(runners.createdAt), desc(runners.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeRunner), pagination: page.pagination }, 200)
  })
  .openapi(readRunnerRoute, async (c) => {
    const { runnerId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const runner = await findRunner(db, auth, runnerId)
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
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const runner = await findRunner(db, auth, runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
    }
    if (hasSecretMaterial(body.metadata) || hasSecretMaterial(body.capabilities)) {
      return errorResponse(c, 400, 'validation_error', 'Runner metadata must not contain raw secret material')
    }
    const timestamp = now()
    const updated = {
      name: body.name ?? runner.name,
      capabilities: body.capabilities ? stringify(body.capabilities) : runner.capabilities,
      state: body.state ?? runner.state,
      maxConcurrent: body.maxConcurrent ?? runner.maxConcurrent,
      metadata: body.metadata ? stringify(body.metadata) : runner.metadata,
      archivedAt:
        body.archived === undefined ? runner.archivedAt : body.archived ? (runner.archivedAt ?? timestamp) : null,
      updatedAt: timestamp,
    }
    await db
      .update(runners)
      .set(updated)
      .where(and(eq(runners.id, runnerId), eq(runners.projectId, auth.project.id)))
    const row = await findRunner(db, auth, runnerId)
    if (!row) {
      throw new Error('Updated runner row is required')
    }
    return c.json(serializeRunner(row), 200)
  })
  .openapi(readHeartbeatRoute, async (c) => {
    const { runnerId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const runner = await findRunner(db, auth, runnerId)
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
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const runner = await findRunner(db, auth, runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
    }
    if (runner.archivedAt) {
      return errorResponse(c, 409, 'conflict', 'Archived runners cannot heartbeat')
    }
    if (runner.state === 'disabled') {
      return errorResponse(c, 409, 'conflict', 'Disabled runners cannot heartbeat until re-enabled by an operator')
    }
    if (hasSecretMaterial(body.metadata) || hasSecretMaterial(body.runtimeInventory)) {
      return errorResponse(c, 400, 'validation_error', 'Runner heartbeat metadata must not contain raw secret material')
    }
    const timestamp = now()
    // Inventory entries are stored as safe metadata only: stringify() redacts
    // token-like values so provider tokens or local credential values never
    // reach D1 even if a runner misreports them in diagnostic detail.
    await db
      .update(runners)
      .set({
        state: body.state ?? 'active',
        capabilities: body.capabilities ? stringify(body.capabilities) : runner.capabilities,
        currentLoad: body.currentLoad ?? runner.currentLoad,
        runtimeUsage: body.runtimeUsage ? stringify(body.runtimeUsage) : runner.runtimeUsage,
        runtimeInventory: body.runtimeInventory ? stringify(body.runtimeInventory) : runner.runtimeInventory,
        metadata: body.metadata ? stringify(body.metadata) : runner.metadata,
        lastHeartbeatAt: timestamp,
        updatedAt: timestamp,
      })
      .where(and(eq(runners.id, runnerId), eq(runners.projectId, auth.project.id)))
    const row = await findRunner(db, auth, runnerId)
    if (!row) {
      throw new Error('Heartbeat runner row is required')
    }
    return c.json(serializeHeartbeat(row), 200)
  })

export default routes
