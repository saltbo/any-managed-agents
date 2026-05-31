import { createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte, max, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, requireAuth } from '../auth/session'
import {
  environments,
  runnerHeartbeats,
  runners,
  runnerWorkItems,
  runnerWorkLeases,
  sessionEvents,
  sessions,
  vaultCredentialVersions,
} from '../db/schema'
import type { Env } from '../env'
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
import { redactSensitiveValue } from '../redaction'

const app = createApiRouter()

const RUNNER_STATUSES = ['active', 'draining', 'disabled', 'offline'] as const
const WORK_STATUSES = ['available', 'leased', 'succeeded', 'failed', 'cancelled'] as const
const LEASE_STATUSES = ['active', 'completed', 'failed', 'cancelled', 'expired'] as const
const DEFAULT_LEASE_DURATION_SECONDS = 60
const MAX_EVENT_BATCH = 100

const JsonObjectSchema = z.record(z.string(), z.unknown())
const CapabilitySchema = z.string().min(1).max(120)
const RunnerCredentialSecretRefSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((ref) => isRunnerCredentialSecretRef(ref), {
    message: 'Runner credential secret reference must use an approved reference format.',
  })
  .openapi({ example: 'cloudflare-secret:runner-token' })

const RunnerSchema = z
  .object({
    id: z.string().openapi({ example: 'runner_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'mac-mini-build-runner' }),
    capabilities: z.array(CapabilitySchema).openapi({ example: ['node', 'git', 'sandbox.exec'] }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    authMode: z.string().openapi({ example: 'bearer' }),
    status: z.enum(RUNNER_STATUSES).openapi({ example: 'active' }),
    currentLoad: z.number().int().openapi({ example: 0 }),
    maxConcurrent: z.number().int().openapi({ example: 2 }),
    metadata: JsonObjectSchema.openapi({ example: { pool: 'default' } }),
    lastHeartbeatAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Runner')

const RunnerWorkItemSchema = z
  .object({
    id: z.string().openapi({ example: 'work_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    sessionId: z.string().nullable().openapi({ example: 'session_abc123' }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    runnerId: z.string().nullable().openapi({ example: 'runner_abc123' }),
    leaseId: z.string().nullable().openapi({ example: 'lease_abc123' }),
    type: z.string().openapi({ example: 'session.start' }),
    status: z.enum(WORK_STATUSES).openapi({ example: 'available' }),
    priority: z.number().int().openapi({ example: 0 }),
    attempts: z.number().int().openapi({ example: 1 }),
    maxAttempts: z.number().int().openapi({ example: 3 }),
    payload: JsonObjectSchema,
    result: JsonObjectSchema.nullable(),
    error: JsonObjectSchema.nullable(),
    availableAt: z.string().datetime(),
    leaseExpiresAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('RunnerWorkItem')

const RunnerWorkLeaseSchema = z
  .object({
    id: z.string().openapi({ example: 'lease_abc123' }),
    workItemId: z.string().openapi({ example: 'work_abc123' }),
    runnerId: z.string().openapi({ example: 'runner_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    status: z.enum(LEASE_STATUSES).openapi({ example: 'active' }),
    expiresAt: z.string().datetime(),
    renewedAt: z.string().datetime().nullable(),
    result: JsonObjectSchema.nullable(),
    error: JsonObjectSchema.nullable(),
    workItem: RunnerWorkItemSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('RunnerWorkLease')

const CreateRunnerSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'mac-mini-build-runner' }),
    capabilities: z
      .array(CapabilitySchema)
      .max(100)
      .optional()
      .openapi({ example: ['node', 'git'] }),
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    credentialSecretRef: RunnerCredentialSecretRefSchema.optional(),
    authMode: z.enum(['bearer', 'mtls', 'oidc']).optional().openapi({ example: 'bearer' }),
    maxConcurrent: z.number().int().min(1).max(100).optional().openapi({ example: 2 }),
    metadata: JsonObjectSchema.optional().openapi({ example: { pool: 'default' } }),
  })
  .strict()
  .openapi('CreateRunnerRequest')

const UpdateRunnerSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    capabilities: z.array(CapabilitySchema).max(100).optional(),
    status: z.enum(['active', 'draining', 'disabled']).optional(),
    maxConcurrent: z.number().int().min(1).max(100).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('UpdateRunnerRequest')

const HeartbeatSchema = z
  .object({
    status: z.enum(['active', 'draining', 'offline']).optional().openapi({ example: 'active' }),
    capabilities: z
      .array(CapabilitySchema)
      .max(100)
      .optional()
      .openapi({ example: ['node', 'git'] }),
    currentLoad: z.number().int().min(0).max(1000).optional().openapi({ example: 1 }),
    metadata: JsonObjectSchema.optional().openapi({ example: { hostname: 'runner-1' } }),
  })
  .strict()
  .openapi('RunnerHeartbeatRequest')

const ClaimLeaseSchema = z
  .object({
    leaseDurationSeconds: z.number().int().min(15).max(900).optional().openapi({ example: 60 }),
  })
  .strict()
  .openapi('ClaimRunnerLeaseRequest')

const UpdateLeaseSchema = z
  .object({
    status: z.enum(['active', 'completed', 'failed', 'cancelled']),
    leaseDurationSeconds: z.number().int().min(15).max(900).optional().openapi({ example: 60 }),
    result: JsonObjectSchema.optional().openapi({ example: { exitCode: 0 } }),
    error: JsonObjectSchema.optional().openapi({ example: { message: 'Command failed' } }),
  })
  .strict()
  .openapi('UpdateRunnerLeaseRequest')

const RunnerEventSchema = z
  .object({
    type: z.string().min(1).max(120),
    payload: JsonObjectSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()

const UploadLeaseEventsSchema = z
  .object({
    events: z.array(RunnerEventSchema).min(1).max(MAX_EVENT_BATCH),
  })
  .strict()
  .openapi('UploadRunnerLeaseEventsRequest')

const ParamsSchema = z.object({
  runnerId: z.string().openapi({ param: { name: 'runnerId', in: 'path' }, example: 'runner_abc123' }),
})
const LeaseParamsSchema = ParamsSchema.extend({
  leaseId: z.string().openapi({ param: { name: 'leaseId', in: 'path' }, example: 'lease_abc123' }),
})
const RunnerListQuerySchema = listQuerySchema(RUNNER_STATUSES).extend({
  environmentId: z
    .string()
    .optional()
    .openapi({ param: { name: 'environmentId', in: 'query' }, example: 'env_abc123' }),
})
const WorkListQuerySchema = listQuerySchema(WORK_STATUSES).extend({
  sessionId: z
    .string()
    .optional()
    .openapi({ param: { name: 'sessionId', in: 'query' }, example: 'session_abc123' }),
  runnerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'runnerId', in: 'query' }, example: 'runner_abc123' }),
})

const RunnerListResponseSchema = listResponseSchema('RunnerListResponse', RunnerSchema)
const RunnerWorkItemListResponseSchema = listResponseSchema('RunnerWorkItemListResponse', RunnerWorkItemSchema)

type Db = ReturnType<typeof drizzle>
type RunnerRow = typeof runners.$inferSelect
type WorkItemRow = typeof runnerWorkItems.$inferSelect
type LeaseRow = typeof runnerWorkLeases.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null) {
  return value ? (redactSensitiveValue(JSON.parse(value)) as T) : null
}

function stringify(value: unknown) {
  return JSON.stringify(redactSensitiveValue(value))
}

function secretKey(key: string) {
  return /secret|token|password|api[_-]?key/i.test(key)
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

function isRunnerCredentialSecretRef(ref: string) {
  if (ref !== ref.trim()) {
    return false
  }
  return (
    /^cloudflare-secret:[A-Za-z0-9_.-]+$/.test(ref) ||
    /^wrangler_secret:[A-Za-z0-9_.-]+$/.test(ref) ||
    /^vaultver_[A-Za-z0-9_]+$/.test(ref) ||
    /^vault:\/\/[A-Za-z0-9][A-Za-z0-9._~:/-]*$/.test(ref) ||
    /^secret:\/\/[A-Za-z0-9][A-Za-z0-9._~:/-]*$/.test(ref)
  )
}

function serializeRunner(row: RunnerRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    capabilities: parseJson<string[]>(row.capabilities) ?? [],
    environmentId: row.environmentId,
    authMode: row.authMode,
    status: row.status as (typeof RUNNER_STATUSES)[number],
    currentLoad: row.currentLoad,
    maxConcurrent: row.maxConcurrent,
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeWorkItem(row: WorkItemRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    environmentId: row.environmentId,
    runnerId: row.runnerId,
    leaseId: row.leaseId,
    type: row.type,
    status: row.status as (typeof WORK_STATUSES)[number],
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    result: parseJson<Record<string, unknown>>(row.result),
    error: parseJson<Record<string, unknown>>(row.error),
    availableAt: row.availableAt,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function runnerCapabilityEligibility(capabilities: string[]) {
  return or(
    sql`json_extract(${runnerWorkItems.payload}, '$.requiredRunnerCapability') IS NULL`,
    ...capabilities.map(
      (capability) => sql`json_extract(${runnerWorkItems.payload}, '$.requiredRunnerCapability') = ${capability}`,
    ),
  )
}

function serializeLease(lease: LeaseRow, workItem: WorkItemRow) {
  return {
    id: lease.id,
    workItemId: lease.workItemId,
    runnerId: lease.runnerId,
    organizationId: lease.organizationId,
    projectId: lease.projectId,
    status: lease.status as (typeof LEASE_STATUSES)[number],
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
    result: parseJson<Record<string, unknown>>(lease.result),
    error: parseJson<Record<string, unknown>>(lease.error),
    workItem: serializeWorkItem(workItem),
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  }
}

async function findRunner(db: Db, auth: AuthContext, runnerId: string) {
  return (
    (await db
      .select()
      .from(runners)
      .where(and(eq(runners.id, runnerId), eq(runners.projectId, auth.project.id)))
      .get()) ?? null
  )
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
        eq(environments.status, 'active'),
      ),
    )
    .get()
  return Boolean(environment)
}

async function validateRunnerCredentialSecretRef(db: Db, auth: AuthContext, credentialSecretRef: string | undefined) {
  if (!credentialSecretRef?.startsWith('vaultver_')) {
    return null
  }
  const version = await db
    .select({ id: vaultCredentialVersions.id })
    .from(vaultCredentialVersions)
    .where(
      and(
        eq(vaultCredentialVersions.id, credentialSecretRef),
        eq(vaultCredentialVersions.organizationId, auth.organization.id),
        or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
        eq(vaultCredentialVersions.status, 'active'),
      ),
    )
    .get()
  return version
    ? null
    : { credentialSecretRef: 'Runner credential secret reference is not an active credential version.' }
}

async function releaseRunnerLoad(db: Db, projectId: string, runnerId: string, timestamp: string) {
  await db
    .update(runners)
    .set({ currentLoad: sql`max(0, ${runners.currentLoad} - 1)`, updatedAt: timestamp })
    .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
}

async function expireStaleLeases(db: Db, auth: AuthContext) {
  const timestamp = now()
  const staleLeases = await db
    .select()
    .from(runnerWorkLeases)
    .where(
      and(
        eq(runnerWorkLeases.projectId, auth.project.id),
        eq(runnerWorkLeases.status, 'active'),
        lt(runnerWorkLeases.expiresAt, timestamp),
      ),
    )
    .limit(100)
  for (const lease of staleLeases) {
    const workItem = await db
      .select()
      .from(runnerWorkItems)
      .where(and(eq(runnerWorkItems.id, lease.workItemId), eq(runnerWorkItems.projectId, auth.project.id)))
      .get()
    if (!workItem || workItem.status !== 'leased' || workItem.leaseId !== lease.id) {
      const expired = await db
        .update(runnerWorkLeases)
        .set({ status: 'expired', updatedAt: timestamp })
        .where(and(eq(runnerWorkLeases.id, lease.id), eq(runnerWorkLeases.status, 'active')))
        .returning({ id: runnerWorkLeases.id })
        .get()
      if (expired) {
        await releaseRunnerLoad(db, auth.project.id, lease.runnerId, timestamp)
      }
      continue
    }
    const shouldRetry = workItem.attempts < workItem.maxAttempts
    const expired = await db
      .update(runnerWorkLeases)
      .set({ status: 'expired', updatedAt: timestamp })
      .where(and(eq(runnerWorkLeases.id, lease.id), eq(runnerWorkLeases.status, 'active')))
      .returning({ id: runnerWorkLeases.id })
      .get()
    if (!expired) {
      continue
    }
    await releaseRunnerLoad(db, auth.project.id, lease.runnerId, timestamp)
    await db
      .update(runnerWorkItems)
      .set({
        status: shouldRetry ? 'available' : 'failed',
        runnerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        error: shouldRetry ? null : stringify({ message: 'Runner lease expired' }),
        updatedAt: timestamp,
      })
      .where(eq(runnerWorkItems.id, workItem.id))
    if (workItem.sessionId) {
      await db
        .update(sessions)
        .set({
          status: shouldRetry ? 'pending' : 'error',
          statusReason: shouldRetry ? 'waiting-for-runner' : 'runner-lease-expired',
          updatedAt: timestamp,
        })
        .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id)))
    }
  }
}

async function appendSessionRunnerEvent(
  db: Db,
  auth: AuthContext,
  sessionId: string,
  event: { type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    { type: event.type, ...event.payload },
    { source: 'self-hosted-runner', ...(event.metadata ?? {}) },
  )
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const latest = await db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .get()
    try {
      await db.insert(sessionEvents).values({
        id: newId('event'),
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        sessionId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: canonicalEvent.type,
        visibility: canonicalEvent.visibility,
        role: canonicalEvent.role,
        parentEventId: null,
        correlationId: null,
        payload: stringify(redactSensitiveValue(canonicalEvent.payload)),
        metadata: stringify(redactSensitiveValue(canonicalEvent.metadata)),
        createdAt: now(),
      })
      return
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
}

async function listRunnerWorkItems(c: Context<{ Bindings: Env }>) {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }
  await expireStaleLeases(db, auth)
  const {
    includeArchived,
    status,
    search,
    createdFrom,
    createdTo,
    limit = 50,
    cursor,
    sessionId,
    runnerId,
  } = WorkListQuerySchema.parse(c.req.query())
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
      fields: { cursor: 'Cursor is invalid.' },
    })
  }
  const filters = [
    eq(runnerWorkItems.projectId, auth.project.id),
    status
      ? eq(runnerWorkItems.status, status)
      : includeArchived === 'true'
        ? undefined
        : inArray(runnerWorkItems.status, ['available', 'leased']),
    sessionId ? eq(runnerWorkItems.sessionId, sessionId) : undefined,
    runnerId ? eq(runnerWorkItems.runnerId, runnerId) : undefined,
    search ? like(runnerWorkItems.type, `%${search}%`) : undefined,
    createdFrom ? gte(runnerWorkItems.createdAt, createdFrom) : undefined,
    createdTo ? lte(runnerWorkItems.createdAt, createdTo) : undefined,
    parsedCursor
      ? or(
          lt(runnerWorkItems.createdAt, parsedCursor.createdAt),
          and(eq(runnerWorkItems.createdAt, parsedCursor.createdAt), lt(runnerWorkItems.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(runnerWorkItems)
    .where(and(...filters))
    .orderBy(desc(runnerWorkItems.createdAt), desc(runnerWorkItems.id))
    .limit(limit + 1)
  const page = paginateRows(rows, limit)
  return c.json({ data: page.data.map(serializeWorkItem), pagination: page.pagination }, 200)
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
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRunnerRoute = createRoute({
  method: 'patch',
  path: '/{runnerId}',
  operationId: 'updateRunner',
  tags: ['Runners'],
  summary: 'Update a self-hosted runner',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateRunnerSchema } } },
  },
  responses: {
    200: { description: 'Updated runner', content: { 'application/json': { schema: RunnerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const heartbeatRoute = createRoute({
  method: 'post',
  path: '/{runnerId}/heartbeats',
  operationId: 'createRunnerHeartbeat',
  tags: ['Runners'],
  summary: 'Record a runner heartbeat',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: HeartbeatSchema } } },
  },
  responses: {
    200: { description: 'Updated runner', content: { 'application/json': { schema: RunnerSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const claimLeaseRoute = createRoute({
  method: 'post',
  path: '/{runnerId}/leases',
  operationId: 'createRunnerLease',
  tags: ['Runner leases'],
  summary: 'Claim queued self-hosted runner work',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: false, content: { 'application/json': { schema: ClaimLeaseSchema } } },
  },
  responses: {
    201: { description: 'Created runner lease', content: { 'application/json': { schema: RunnerWorkLeaseSchema } } },
    204: { description: 'No eligible work is available' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Runner not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateLeaseRoute = createRoute({
  method: 'patch',
  path: '/{runnerId}/leases/{leaseId}',
  operationId: 'updateRunnerLease',
  tags: ['Runner leases'],
  summary: 'Renew or finish a runner lease',
  ...AuthenticatedOperation,
  request: {
    params: LeaseParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateLeaseSchema } } },
  },
  responses: {
    200: { description: 'Updated runner lease', content: { 'application/json': { schema: RunnerWorkLeaseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const uploadLeaseEventsRoute = createRoute({
  method: 'post',
  path: '/{runnerId}/leases/{leaseId}/events',
  operationId: 'createRunnerLeaseEvents',
  tags: ['Runner leases'],
  summary: 'Upload structured runner lease events',
  ...AuthenticatedOperation,
  request: {
    params: LeaseParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UploadLeaseEventsSchema } } },
  },
  responses: {
    202: {
      description: 'Runner events accepted',
      content: {
        'application/json': { schema: z.object({ accepted: z.number().int() }).openapi('RunnerLeaseEventsAccepted') },
      },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listWorkItemsRoute = createRoute({
  method: 'get',
  path: '/work-items',
  operationId: 'listRunnerWorkItems',
  tags: ['Runner work'],
  summary: 'List self-hosted runner work items',
  ...AuthenticatedOperation,
  request: { query: WorkListQuerySchema },
  responses: {
    200: {
      description: 'Runner work item list',
      content: { 'application/json': { schema: RunnerWorkItemListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    if (!(await validateEnvironment(db, auth, body.environmentId))) {
      return errorResponse(c, 409, 'conflict', 'Runner environment is unavailable')
    }
    const credentialFields = await validateRunnerCredentialSecretRef(db, auth, body.credentialSecretRef)
    if (credentialFields) {
      return errorResponse(c, 400, 'validation_error', 'Runner credential secret reference is invalid', {
        fields: credentialFields,
      })
    }
    const timestamp = now()
    const runner = {
      id: newId('runner'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      name: body.name,
      capabilities: stringify(body.capabilities ?? []),
      environmentId: body.environmentId ?? null,
      credentialSecretRef: body.credentialSecretRef ?? null,
      authMode: body.authMode ?? 'bearer',
      status: 'offline',
      currentLoad: 0,
      maxConcurrent: body.maxConcurrent ?? 1,
      metadata: stringify(body.metadata ?? {}),
      lastHeartbeatAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
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
    const {
      includeArchived,
      status,
      search,
      createdFrom,
      createdTo,
      limit = 50,
      cursor,
      environmentId,
    } = c.req.valid('query')
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
      status
        ? eq(runners.status, status)
        : includeArchived === 'true'
          ? undefined
          : inArray(runners.status, ['active', 'draining', 'offline']),
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
  .openapi(listWorkItemsRoute, listRunnerWorkItems)
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
    if (hasSecretMaterial(body.metadata) || hasSecretMaterial(body.capabilities)) {
      return errorResponse(c, 400, 'validation_error', 'Runner metadata must not contain raw secret material')
    }
    const timestamp = now()
    const updated = {
      name: body.name ?? runner.name,
      capabilities: body.capabilities ? stringify(body.capabilities) : runner.capabilities,
      status: body.status ?? runner.status,
      maxConcurrent: body.maxConcurrent ?? runner.maxConcurrent,
      metadata: body.metadata ? stringify(body.metadata) : runner.metadata,
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
  .openapi(heartbeatRoute, async (c) => {
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
    if (runner.status === 'disabled') {
      return errorResponse(c, 409, 'conflict', 'Disabled runners cannot heartbeat until re-enabled by an operator')
    }
    if (hasSecretMaterial(body.metadata)) {
      return errorResponse(c, 400, 'validation_error', 'Runner heartbeat metadata must not contain raw secret material')
    }
    const timestamp = now()
    const status = body.status ?? 'active'
    const capabilities = body.capabilities ? stringify(body.capabilities) : runner.capabilities
    const currentLoad = body.currentLoad ?? runner.currentLoad
    await db.insert(runnerHeartbeats).values({
      id: newId('heartbeat'),
      runnerId,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      status,
      capabilities,
      currentLoad,
      metadata: stringify(body.metadata ?? {}),
      createdAt: timestamp,
    })
    await db
      .update(runners)
      .set({
        status,
        capabilities,
        currentLoad,
        metadata: body.metadata ? stringify(body.metadata) : runner.metadata,
        lastHeartbeatAt: timestamp,
        updatedAt: timestamp,
      })
      .where(and(eq(runners.id, runnerId), eq(runners.projectId, auth.project.id)))
    const row = await findRunner(db, auth, runnerId)
    if (!row) {
      throw new Error('Heartbeat runner row is required')
    }
    return c.json(serializeRunner(row), 200)
  })
  .openapi(claimLeaseRoute, async (c) => {
    const { runnerId } = c.req.valid('param')
    const body = c.req.valid('json') ?? {}
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await expireStaleLeases(db, auth)
    const runner = await findRunner(db, auth, runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (runner.status !== 'active') {
      return errorResponse(c, 409, 'conflict', 'Runner is not active')
    }
    if (runner.currentLoad >= runner.maxConcurrent) {
      return c.body(null, 204)
    }
    const timestamp = now()
    const reserved = await db
      .update(runners)
      .set({ currentLoad: sql`${runners.currentLoad} + 1`, updatedAt: timestamp })
      .where(
        and(
          eq(runners.id, runnerId),
          eq(runners.projectId, auth.project.id),
          eq(runners.status, 'active'),
          lt(runners.currentLoad, runners.maxConcurrent),
        ),
      )
      .returning({ id: runners.id })
      .get()
    if (!reserved) {
      return c.body(null, 204)
    }
    const runnerCapabilities = parseJson<string[]>(runner.capabilities) ?? []
    const workItem = await db
      .select()
      .from(runnerWorkItems)
      .where(
        and(
          eq(runnerWorkItems.projectId, auth.project.id),
          eq(runnerWorkItems.status, 'available'),
          lte(runnerWorkItems.availableAt, timestamp),
          runner.environmentId
            ? or(eq(runnerWorkItems.environmentId, runner.environmentId), isNull(runnerWorkItems.environmentId))
            : undefined,
          runnerCapabilityEligibility(runnerCapabilities),
        ),
      )
      .orderBy(desc(runnerWorkItems.priority), asc(runnerWorkItems.createdAt), asc(runnerWorkItems.id))
      .get()
    if (!workItem) {
      await releaseRunnerLoad(db, auth.project.id, runnerId, timestamp)
      return c.body(null, 204)
    }
    const leaseDurationSeconds = body.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS
    const lease = {
      id: newId('lease'),
      workItemId: workItem.id,
      runnerId,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      status: 'active',
      expiresAt: new Date(Date.now() + leaseDurationSeconds * 1000).toISOString(),
      renewedAt: null,
      result: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const claimed = await db
      .update(runnerWorkItems)
      .set({
        status: 'leased',
        runnerId,
        leaseId: lease.id,
        leaseExpiresAt: lease.expiresAt,
        attempts: workItem.attempts + 1,
        updatedAt: timestamp,
      })
      .where(and(eq(runnerWorkItems.id, workItem.id), eq(runnerWorkItems.status, 'available')))
      .returning({ id: runnerWorkItems.id })
      .get()
    if (!claimed) {
      await releaseRunnerLoad(db, auth.project.id, runnerId, timestamp)
      return c.body(null, 204)
    }
    await db.insert(runnerWorkLeases).values(lease)
    if (workItem.sessionId) {
      await db
        .update(sessions)
        .set({ status: 'running', statusReason: null, updatedAt: timestamp })
        .where(
          and(
            eq(sessions.id, workItem.sessionId),
            eq(sessions.projectId, auth.project.id),
            eq(sessions.status, 'pending'),
          ),
        )
    }
    const leasedWorkItem = await db.select().from(runnerWorkItems).where(eq(runnerWorkItems.id, workItem.id)).get()
    if (!leasedWorkItem) {
      throw new Error('Leased work item row is required')
    }
    return c.json(serializeLease(lease, leasedWorkItem), 201)
  })
  .openapi(updateLeaseRoute, async (c) => {
    const { runnerId, leaseId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await expireStaleLeases(db, auth)
    const lease = await db
      .select()
      .from(runnerWorkLeases)
      .where(
        and(
          eq(runnerWorkLeases.id, leaseId),
          eq(runnerWorkLeases.runnerId, runnerId),
          eq(runnerWorkLeases.projectId, auth.project.id),
        ),
      )
      .get()
    if (!lease) {
      return errorResponse(c, 404, 'not_found', 'Runner lease not found')
    }
    const workItem = await db
      .select()
      .from(runnerWorkItems)
      .where(and(eq(runnerWorkItems.id, lease.workItemId), eq(runnerWorkItems.projectId, auth.project.id)))
      .get()
    if (!workItem) {
      return errorResponse(c, 404, 'not_found', 'Runner work item not found')
    }
    if (
      lease.status !== 'active' ||
      lease.expiresAt <= now() ||
      workItem.status !== 'leased' ||
      workItem.leaseId !== lease.id ||
      workItem.runnerId !== runnerId
    ) {
      return errorResponse(c, 409, 'conflict', 'Runner lease is no longer active')
    }
    const timestamp = now()
    if (body.status === 'active') {
      const expiresAt = new Date(
        Date.now() + (body.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS) * 1000,
      ).toISOString()
      const renewedWorkItem = await db
        .update(runnerWorkItems)
        .set({ leaseExpiresAt: expiresAt, updatedAt: timestamp })
        .where(
          and(
            eq(runnerWorkItems.id, workItem.id),
            eq(runnerWorkItems.status, 'leased'),
            eq(runnerWorkItems.leaseId, lease.id),
            eq(runnerWorkItems.runnerId, runnerId),
          ),
        )
        .returning({ id: runnerWorkItems.id })
        .get()
      if (!renewedWorkItem) {
        return errorResponse(c, 409, 'conflict', 'Runner lease no longer owns the work item')
      }
      await db
        .update(runnerWorkLeases)
        .set({ expiresAt, renewedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(runnerWorkLeases.id, leaseId), eq(runnerWorkLeases.status, 'active')))
    } else {
      const result = body.result ? stringify(body.result) : null
      const error = body.error ? stringify(body.error) : null
      const completedWorkItem = await db
        .update(runnerWorkItems)
        .set({
          status: body.status === 'completed' ? 'succeeded' : body.status,
          result,
          error,
          leaseExpiresAt: null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(runnerWorkItems.id, workItem.id),
            eq(runnerWorkItems.status, 'leased'),
            eq(runnerWorkItems.leaseId, lease.id),
            eq(runnerWorkItems.runnerId, runnerId),
          ),
        )
        .returning({ id: runnerWorkItems.id })
        .get()
      if (!completedWorkItem) {
        return errorResponse(c, 409, 'conflict', 'Runner lease no longer owns the work item')
      }
      await db
        .update(runnerWorkLeases)
        .set({ status: body.status, result, error, updatedAt: timestamp })
        .where(and(eq(runnerWorkLeases.id, leaseId), eq(runnerWorkLeases.status, 'active')))
      const runner = await findRunner(db, auth, runnerId)
      if (runner) {
        await releaseRunnerLoad(db, auth.project.id, runnerId, timestamp)
      }
      if (workItem.sessionId) {
        const sessionUpdate =
          body.status === 'cancelled'
            ? {
                status: 'stopped',
                statusReason: 'runner-cancelled',
                stoppedAt: timestamp,
                updatedAt: timestamp,
              }
            : {
                status: body.status === 'completed' ? 'idle' : 'error',
                statusReason: body.status === 'completed' ? null : 'runner-failed',
                updatedAt: timestamp,
              }
        await db
          .update(sessions)
          .set(sessionUpdate)
          .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id)))
      }
    }
    const updatedLease = await db.select().from(runnerWorkLeases).where(eq(runnerWorkLeases.id, leaseId)).get()
    const updatedWorkItem = await db.select().from(runnerWorkItems).where(eq(runnerWorkItems.id, workItem.id)).get()
    if (!updatedLease || !updatedWorkItem) {
      throw new Error('Updated lease row is required')
    }
    return c.json(serializeLease(updatedLease, updatedWorkItem), 200)
  })
  .openapi(uploadLeaseEventsRoute, async (c) => {
    const { runnerId, leaseId } = c.req.valid('param')
    const { events } = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const lease = await db
      .select()
      .from(runnerWorkLeases)
      .where(
        and(
          eq(runnerWorkLeases.id, leaseId),
          eq(runnerWorkLeases.runnerId, runnerId),
          eq(runnerWorkLeases.projectId, auth.project.id),
          eq(runnerWorkLeases.status, 'active'),
        ),
      )
      .get()
    if (!lease) {
      return errorResponse(c, 404, 'not_found', 'Active runner lease not found')
    }
    const workItem = await db.select().from(runnerWorkItems).where(eq(runnerWorkItems.id, lease.workItemId)).get()
    if (!workItem?.sessionId) {
      return errorResponse(c, 409, 'conflict', 'Runner work item is not attached to a session')
    }
    if (
      lease.expiresAt <= now() ||
      workItem.status !== 'leased' ||
      workItem.leaseId !== lease.id ||
      workItem.runnerId !== runnerId
    ) {
      return errorResponse(c, 409, 'conflict', 'Runner lease no longer owns the work item')
    }
    for (const event of events) {
      await appendSessionRunnerEvent(db, auth, workItem.sessionId, {
        type: event.type,
        payload: event.payload,
        ...(event.metadata ? { metadata: event.metadata } : {}),
      })
    }
    return c.json({ accepted: events.length }, 202)
  })

export default routes
