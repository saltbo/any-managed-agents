import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gt, inArray, isNull, lt, lte, max, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import type { AuthContext } from '../auth/session'
import { isRunnerOidcAuth, requireAuth } from '../auth/session'
import { leases, runners, sessionChannels, sessionEvents, sessions, workItems } from '../db/schema'
import { insertCanonicalSessionEvent } from '../db/session-event-store'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import { transitionalRuntimeLevelRuntimes } from '../runtime/catalog'
import { safeRuntimeError } from '../runtime/runtime-error'
import { resolveRuntimeSecretEnv } from '../runtime/secret-env'
import {
  type Db,
  findRunner,
  JsonObjectSchema,
  newId,
  now,
  parseJson,
  parseRawJson,
  runnerForbidden,
  runnerOperationAuthorized,
  stringify,
} from './runners'

const app = createApiRouter()

export const LEASE_STATES = ['active', 'completed', 'failed', 'cancelled', 'expired'] as const
const DEFAULT_LEASE_DURATION_SECONDS = 60
const MAX_LEASE_DURATION_SECONDS = 900
const RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX = 'runtime-provider-model'

type LeaseRow = typeof leases.$inferSelect
type WorkItemRow = typeof workItems.$inferSelect

const LeaseSchema = z
  .object({
    id: z.string().openapi({ example: 'lease_abc123' }),
    workItemId: z.string().openapi({ example: 'work_abc123' }),
    runnerId: z.string().openapi({ example: 'runner_abc123' }),
    state: z.enum(LEASE_STATES).openapi({ example: 'active' }),
    expiresAt: z.string().datetime(),
    renewedAt: z.string().datetime().nullable(),
    resumeToken: z.string().nullable().openapi({ example: 'runtime-session-uuid' }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Lease')

const CreateLeaseSchema = z
  .object({
    workItemId: z.string().min(1).openapi({ example: 'work_abc123' }),
    runnerId: z.string().min(1).openapi({ example: 'runner_abc123' }),
    leaseDurationSeconds: z.number().int().min(15).max(MAX_LEASE_DURATION_SECONDS).optional().openapi({ example: 60 }),
  })
  .strict()
  .openapi('CreateLeaseRequest')

const UpdateLeaseSchema = z
  .object({
    state: z.enum(['active', 'completed', 'failed', 'cancelled', 'interrupted']).optional(),
    leaseDurationSeconds: z.number().int().min(15).max(MAX_LEASE_DURATION_SECONDS).optional().openapi({ example: 60 }),
    expiresAt: z.string().datetime().optional(),
    resumeToken: z.string().min(1).max(2048).optional().openapi({ example: 'runtime-session-uuid' }),
    result: JsonObjectSchema.optional().openapi({ example: { exitCode: 0 } }),
    error: JsonObjectSchema.optional().openapi({ example: { message: 'Command failed' } }),
  })
  .strict()
  .openapi('UpdateLeaseRequest')

const LeaseChannelMetadataSchema = z
  .object({
    upgrade: z.literal('websocket').openapi({ example: 'websocket' }),
  })
  .openapi('LeaseChannelMetadata')

const LeaseParamsSchema = z.object({
  leaseId: z.string().openapi({ param: { name: 'leaseId', in: 'path' }, example: 'lease_abc123' }),
})

const LeaseListQuerySchema = z.object({
  runnerId: z
    .string()
    .optional()
    .openapi({ param: { name: 'runnerId', in: 'query' }, example: 'runner_abc123' }),
  state: z
    .enum(LEASE_STATES)
    .optional()
    .openapi({ param: { name: 'state', in: 'query' }, example: 'active' }),
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

const LeaseListResponseSchema = listResponseSchema('LeaseListResponse', LeaseSchema)

function serializeLease(lease: LeaseRow) {
  return {
    id: lease.id,
    workItemId: lease.workItemId,
    runnerId: lease.runnerId,
    state: lease.state as (typeof LEASE_STATES)[number],
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
    resumeToken: lease.resumeToken,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  }
}

function requiredRunnerCapability(payload: Record<string, unknown>) {
  return typeof payload.requiredRunnerCapability === 'string' ? payload.requiredRunnerCapability : null
}

function runnerCapabilityEligible(capabilities: string[], payload: Record<string, unknown>) {
  const required = requiredRunnerCapability(payload)
  if (required === null) {
    // Unscoped work is claimable by anyone except session starts, which always
    // carry a runtime requirement.
    return payload.type !== 'session.start'
  }
  const eligible = new Set(capabilities)
  for (const capability of capabilities) {
    if (capability.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:`)) {
      const runtime = capability.split(':')[1]
      if (runtime) {
        eligible.add(runtime)
      }
    }
  }
  if (eligible.has(required)) {
    return true
  }
  // TRANSITIONAL: runners deployed before host model enumeration declare the
  // bare runtime name. A declared bare runtime capability still claims
  // model-specific session work for wildcard-model runtimes so those runners
  // don't strand work. Removable once the runner fleet advertises enumerated
  // per-model capabilities.
  return transitionalRuntimeLevelRuntimes().some(
    (runtime) =>
      capabilities.includes(runtime) && required.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:`),
  )
}

// Lease readiness gate: once a runner reports runtime inventory, runtime
// session work is leased only when the required runtime has a ready inventory
// entry. Runners that have not reported inventory yet are transitional and
// fall back to capability matching alone.
function runnerRuntimeReady(inventory: Array<{ runtime: string; state: string }>, payload: Record<string, unknown>) {
  if (inventory.length === 0) {
    return true
  }
  const required = requiredRunnerCapability(payload)
  if (required === null) {
    return true
  }
  const readyRuntimes = [...new Set(inventory.filter((entry) => entry.state === 'ready').map((entry) => entry.runtime))]
  return readyRuntimes.some(
    (runtime) => required === runtime || required.startsWith(`${RUNTIME_PROVIDER_MODEL_CAPABILITY_PREFIX}:${runtime}:`),
  )
}

async function releaseRunnerLoad(db: Db, projectId: string, runnerId: string, timestamp: string) {
  await db
    .update(runners)
    .set({ currentLoad: sql`max(0, ${runners.currentLoad} - 1)`, updatedAt: timestamp })
    .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
}

async function hasNewerActiveSessionWork(db: Db, projectId: string, workItem: WorkItemRow) {
  if (!workItem.sessionId) {
    return false
  }
  const newerWork = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.sessionId, workItem.sessionId),
        inArray(workItems.state, ['available', 'leased']),
        gt(workItems.createdAt, workItem.createdAt),
      ),
    )
    .get()
  return Boolean(newerWork)
}

async function sessionHasRunnerStarted(db: Db, projectId: string, sessionId: string): Promise<boolean> {
  const row = await db
    .select({ sequence: max(sessionEvents.sequence) })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.projectId, projectId), eq(sessionEvents.sessionId, sessionId)))
    .get()
  return typeof row?.sequence === 'number'
}

// The runner reports the freshest runtime resume token on lease renewals and
// interrupts. Persisting it on the work item payload lets a recovery requeue
// (and any later queued resume) continue the runtime conversation instead of
// resuming from the last completed work item. Returns null when there is
// nothing new to write.
function payloadWithResumeToken(workItem: WorkItemRow, resumeToken: string | undefined): string | null {
  if (!resumeToken) {
    return null
  }
  const payload = parseJson<Record<string, unknown>>(workItem.payload)
  if (!payload || payload.resumeToken === resumeToken) {
    return null
  }
  return stringify({ ...payload, resumeToken })
}

// Re-queues a work item whose runner stopped mid-flight so the session can be
// picked up again. For a started self-hosted runtime session the payload is
// rewritten to resume so the agent continues where it left off rather than
// restarting from scratch; once retries are exhausted the work fails terminally.
async function requeueWorkItemForRecovery(
  db: Db,
  projectId: string,
  workItem: WorkItemRow,
  timestamp: string,
): Promise<'requeued' | 'failed' | 'superseded'> {
  if (await hasNewerActiveSessionWork(db, projectId, workItem)) {
    // Newer work for the session is already queued (e.g. a queued session
    // command). Requeueing this item too would hand the same session to two
    // runtimes, so cancel it and let the newer work item drive recovery. The
    // state guard keeps a concurrent completion from being overwritten.
    await db
      .update(workItems)
      .set({
        state: 'cancelled',
        runnerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        error: stringify({ message: 'Superseded by newer queued work for the session' }),
        updatedAt: timestamp,
      })
      .where(and(eq(workItems.id, workItem.id), eq(workItems.state, 'leased')))
    return 'superseded'
  }
  const shouldRetry = workItem.attempts < workItem.maxAttempts
  if (!shouldRetry) {
    await db
      .update(workItems)
      .set({
        state: 'failed',
        runnerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        error: stringify({ message: 'Runner stopped and retries are exhausted' }),
        updatedAt: timestamp,
      })
      .where(eq(workItems.id, workItem.id))
    if (workItem.sessionId) {
      await db
        .update(sessions)
        .set({ state: 'error', stateReason: 'runner-lease-expired', updatedAt: timestamp })
        .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, projectId)))
    }
    return 'failed'
  }

  let payloadJson = workItem.payload
  let runnerStarted = false
  if (workItem.sessionId) {
    runnerStarted = await sessionHasRunnerStarted(db, projectId, workItem.sessionId)
    const payload = parseJson<Record<string, unknown>>(workItem.payload)
    if (payload?.type === 'session.start' && !payload.resume && runnerStarted) {
      // Resume the runtime in place. claude-code resumes from its own session id
      // (the AMA session id), so a null token still continues the conversation;
      // other runtimes fall back to a fresh start when no token was captured.
      payload.resume = true
      payloadJson = stringify(payload)
    }
  }
  await db
    .update(workItems)
    .set({
      state: 'available',
      runnerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      payload: payloadJson,
      error: null,
      availableAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(workItems.id, workItem.id))
  if (workItem.sessionId) {
    // A runner that never started the session leaves nothing to recover: the
    // session simply goes back to waiting for a runner.
    await db
      .update(sessions)
      .set({
        state: 'pending',
        stateReason: runnerStarted ? 'waiting-for-runner-recovery' : 'waiting-for-runner',
        updatedAt: timestamp,
      })
      .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, projectId)))
  }
  return 'requeued'
}

export async function expireStaleLeases(db: Db, auth: AuthContext) {
  const timestamp = now()
  const staleLeases = await db
    .select()
    .from(leases)
    .where(and(eq(leases.projectId, auth.project.id), eq(leases.state, 'active'), lt(leases.expiresAt, timestamp)))
    .limit(100)
  for (const lease of staleLeases) {
    const workItem = await db
      .select()
      .from(workItems)
      .where(and(eq(workItems.id, lease.workItemId), eq(workItems.projectId, auth.project.id)))
      .get()
    const expired = await db
      .update(leases)
      .set({ state: 'expired', updatedAt: timestamp })
      .where(and(eq(leases.id, lease.id), eq(leases.state, 'active')))
      .returning({ id: leases.id })
      .get()
    if (!expired) {
      continue
    }
    await releaseRunnerLoad(db, auth.project.id, lease.runnerId, timestamp)
    if (workItem?.state === 'leased' && workItem.leaseId === lease.id) {
      await requeueWorkItemForRecovery(db, auth.project.id, workItem, timestamp)
    }
  }
}

// Official-runtime auth/authz failures surface as stable, displayable state
// reasons derived from the canonical runtime.error code the runner streamed —
// never from raw provider error text.
const RUNTIME_AUTH_STATE_REASONS: Record<string, string> = {
  runtime_auth_missing_login: 'runtime-auth-missing-login',
  runtime_auth_unauthorized: 'runtime-auth-unauthorized',
  runtime_auth_product_disabled: 'runtime-auth-product-disabled',
  runtime_auth_expired: 'runtime-auth-expired',
}

async function runtimeFailureStateReason(db: Db, sessionId: string | null): Promise<string | null> {
  if (!sessionId) {
    return null
  }
  const errorEvents = await db
    .select({ payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, 'runtime.error')))
    .orderBy(desc(sessionEvents.sequence))
    .limit(20)
    .all()
  for (const row of errorEvents) {
    const payload = parseJson<Record<string, unknown>>(row.payload)
    const code = typeof payload?.code === 'string' ? payload.code : null
    const reason = code ? RUNTIME_AUTH_STATE_REASONS[code] : undefined
    if (reason) {
      return reason
    }
  }
  return null
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
  await insertCanonicalSessionEvent(
    db,
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      sessionId,
    },
    canonicalEvent,
  )
}

function workItemRuntimeMetadata(workItem: WorkItemRow) {
  const payload = parseJson<Record<string, unknown>>(workItem.payload) ?? {}
  return {
    workItemId: workItem.id,
    ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
    ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
  }
}

async function findLease(db: Db, auth: AuthContext, leaseId: string) {
  return (
    (await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.projectId, auth.project.id)))
      .get()) ?? null
  )
}

async function activeLeaseWorkItem(db: Db, auth: AuthContext, lease: LeaseRow): Promise<WorkItemRow | null> {
  if (lease.state !== 'active' || lease.expiresAt <= now()) {
    return null
  }
  const workItem = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.id, lease.workItemId), eq(workItems.projectId, auth.project.id)))
    .get()
  if (workItem?.state !== 'leased' || workItem.leaseId !== lease.id || workItem.runnerId !== lease.runnerId) {
    return null
  }
  return workItem
}

async function acceptLeaseSessionChannel(c: Context<{ Bindings: Env }>) {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return errorResponse(c, 426, 'conflict', 'Runner session channel requires a WebSocket upgrade')
  }
  const leaseId = c.req.param('leaseId')
  if (!leaseId) {
    return errorResponse(c, 400, 'validation_error', 'Lease id is required')
  }
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }
  const lease = await findLease(db, auth, leaseId)
  if (!lease) {
    return errorResponse(c, 404, 'not_found', 'Lease not found')
  }
  const runner = await findRunner(db, auth, lease.runnerId)
  if (!runner) {
    return errorResponse(c, 404, 'not_found', 'Runner not found')
  }
  if (!runnerOperationAuthorized(c.env, auth, runner)) {
    return runnerForbidden(c)
  }
  await expireStaleLeases(db, auth)
  const refreshedLease = await findLease(db, auth, leaseId)
  const workItem = refreshedLease ? await activeLeaseWorkItem(db, auth, refreshedLease) : null
  if (!workItem) {
    return errorResponse(c, 409, 'conflict', 'Runner lease no longer owns a self-hosted session')
  }
  if (!workItem.sessionId) {
    return errorResponse(c, 409, 'conflict', 'Runner work item is not attached to a session')
  }
  const runnerId = lease.runnerId
  const waitingSession = await db
    .select({ id: sessions.id, state: sessions.state, stateReason: sessions.stateReason })
    .from(sessions)
    .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id)))
    .get()
  if (
    !(
      (waitingSession?.state === 'pending' &&
        (waitingSession.stateReason === 'waiting-for-runner' ||
          waitingSession.stateReason === 'waiting-for-runner-recovery')) ||
      (waitingSession?.state === 'running' && waitingSession.stateReason === null)
    )
  ) {
    return errorResponse(c, 409, 'conflict', 'Session is not waiting for a runner channel')
  }

  const timestamp = now()
  await db
    .update(sessionChannels)
    .set({ state: 'stale', closedAt: timestamp, closeReason: 'superseded', updatedAt: timestamp })
    .where(
      and(
        eq(sessionChannels.projectId, auth.project.id),
        eq(sessionChannels.state, 'active'),
        or(eq(sessionChannels.sessionId, workItem.sessionId), eq(sessionChannels.leaseId, leaseId)),
      ),
    )

  const channel = {
    id: newId('channel'),
    sessionId: workItem.sessionId,
    workItemId: workItem.id,
    leaseId,
    runnerId,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    state: 'active',
    acceptedAt: timestamp,
    lastSeenAt: timestamp,
    closedAt: null,
    closeReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const acceptedSession = await db
    .update(sessions)
    .set({
      state: 'running',
      stateReason: null,
      runtimeEndpointPath: `/api/v1/runtime/sessions/${workItem.sessionId}/rpc`,
      startedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(sessions.id, workItem.sessionId),
        eq(sessions.projectId, auth.project.id),
        or(
          and(
            eq(sessions.state, 'pending'),
            or(eq(sessions.stateReason, 'waiting-for-runner'), eq(sessions.stateReason, 'waiting-for-runner-recovery')),
          ),
          and(eq(sessions.state, 'running'), isNull(sessions.stateReason)),
        ),
      ),
    )
    .returning({ id: sessions.id })
    .get()
  if (!acceptedSession) {
    return errorResponse(c, 409, 'conflict', 'Session is not waiting for a runner channel')
  }
  await db.insert(sessionChannels).values(channel)
  await appendSessionRunnerEvent(db, auth, workItem.sessionId, {
    type: 'runner.channel.accepted',
    payload: { runnerId, leaseId, workItemId: workItem.id },
    metadata: {
      source: 'self-hosted-runner-channel',
      ...workItemRuntimeMetadata(workItem),
      channelId: channel.id,
      runnerId,
      leaseId,
      workItemId: workItem.id,
    },
  })

  const id = c.env.RUNNER_SESSION_CHANNEL.idFromName(workItem.sessionId)
  const stub = c.env.RUNNER_SESSION_CHANNEL.get(id)
  const url = new URL('https://runner-session-channel/connect')
  url.searchParams.set('channelId', channel.id)
  url.searchParams.set('sessionId', workItem.sessionId)
  url.searchParams.set('workItemId', workItem.id)
  url.searchParams.set('leaseId', leaseId)
  url.searchParams.set('runnerId', runnerId)
  url.searchParams.set('organizationId', auth.organization.id)
  url.searchParams.set('projectId', auth.project.id)
  const response = await stub.fetch(new Request(url, c.req.raw))
  if (response.status === 101) {
    return response
  }
  await db
    .update(sessionChannels)
    .set({ state: 'closed', closedAt: timestamp, closeReason: 'channel-upgrade-failed', updatedAt: timestamp })
    .where(eq(sessionChannels.id, channel.id))
  await db
    .update(sessions)
    .set({ state: 'pending', stateReason: 'waiting-for-runner-recovery', updatedAt: timestamp })
    .where(
      and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.state, 'running')),
    )
  return response
}

const createLeaseRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createLease',
  tags: ['Leases'],
  summary: 'Claim a specific available work item for a runner',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateLeaseSchema } } } },
  responses: {
    201: { description: 'Created lease', content: { 'application/json': { schema: LeaseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Work item or runner not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: {
      description: 'Work item is no longer available',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listLeasesRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listLeases',
  tags: ['Leases'],
  summary: 'List work leases',
  ...AuthenticatedOperation,
  request: { query: LeaseListQuerySchema },
  responses: {
    200: { description: 'Lease list', content: { 'application/json': { schema: LeaseListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readLeaseRoute = createRoute({
  method: 'get',
  path: '/{leaseId}',
  operationId: 'readLease',
  tags: ['Leases'],
  summary: 'Read a work lease',
  ...AuthenticatedOperation,
  request: { params: LeaseParamsSchema },
  responses: {
    200: { description: 'Lease', content: { 'application/json': { schema: LeaseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateLeaseRoute = createRoute({
  method: 'patch',
  path: '/{leaseId}',
  operationId: 'updateLease',
  tags: ['Leases'],
  summary: 'Renew or finish a work lease',
  ...AuthenticatedOperation,
  request: {
    params: LeaseParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateLeaseSchema } } },
  },
  responses: {
    200: { description: 'Updated lease', content: { 'application/json': { schema: LeaseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const leaseChannelRoute = createRoute({
  method: 'get',
  path: '/{leaseId}/channel',
  operationId: 'connectLeaseSessionChannel',
  tags: ['Leases'],
  summary: 'Open a claimed runner session WebSocket channel',
  ...AuthenticatedOperation,
  request: { params: LeaseParamsSchema },
  responses: {
    101: { description: 'Runner session channel accepted as a WebSocket upgrade' },
    200: {
      description: 'Runner session channel metadata for OpenAPI clients',
      content: { 'application/json': { schema: LeaseChannelMetadataSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    426: {
      description: 'WebSocket upgrade required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const routes = app
  .openapi(createLeaseRoute, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await expireStaleLeases(db, auth)
    const runner = await findRunner(db, auth, body.runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
    }
    if (runner.archivedAt || runner.state !== 'active') {
      return errorResponse(c, 409, 'conflict', 'Runner is not active')
    }
    const workItem = await db
      .select()
      .from(workItems)
      .where(and(eq(workItems.id, body.workItemId), eq(workItems.projectId, auth.project.id)))
      .get()
    if (!workItem) {
      return errorResponse(c, 404, 'not_found', 'Work item not found')
    }
    const timestamp = now()
    if (workItem.state !== 'available' || workItem.availableAt > timestamp) {
      return errorResponse(c, 409, 'conflict', 'Work item is not available')
    }
    if (runner.environmentId && workItem.environmentId && workItem.environmentId !== runner.environmentId) {
      return errorResponse(c, 409, 'conflict', 'Runner is not eligible for this work item')
    }
    const payload = parseRawJson<Record<string, unknown>>(workItem.payload) ?? {}
    const runnerCapabilities = parseJson<string[]>(runner.capabilities) ?? []
    const runnerInventory = parseRawJson<Array<{ runtime: string; state: string }>>(runner.runtimeInventory) ?? []
    if (!runnerCapabilityEligible(runnerCapabilities, payload) || !runnerRuntimeReady(runnerInventory, payload)) {
      return errorResponse(c, 409, 'conflict', 'Runner is not eligible for this work item')
    }
    const reserved = await db
      .update(runners)
      .set({ currentLoad: sql`${runners.currentLoad} + 1`, updatedAt: timestamp })
      .where(
        and(
          eq(runners.id, runner.id),
          eq(runners.projectId, auth.project.id),
          eq(runners.state, 'active'),
          lt(runners.currentLoad, runners.maxConcurrent),
        ),
      )
      .returning({ id: runners.id })
      .get()
    if (!reserved) {
      return errorResponse(c, 409, 'conflict', 'Runner is at capacity')
    }
    const leaseDurationSeconds = body.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS
    const lease = {
      id: newId('lease'),
      workItemId: workItem.id,
      runnerId: runner.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      state: 'active',
      expiresAt: new Date(Date.now() + leaseDurationSeconds * 1000).toISOString(),
      renewedAt: null,
      resumeToken: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const claimed = await db
      .update(workItems)
      .set({
        state: 'leased',
        runnerId: runner.id,
        leaseId: lease.id,
        leaseExpiresAt: lease.expiresAt,
        attempts: workItem.attempts + 1,
        updatedAt: timestamp,
      })
      .where(
        and(eq(workItems.id, workItem.id), eq(workItems.state, 'available'), lte(workItems.availableAt, timestamp)),
      )
      .returning({ id: workItems.id })
      .get()
    if (!claimed) {
      await releaseRunnerLoad(db, auth.project.id, runner.id, timestamp)
      return errorResponse(c, 409, 'conflict', 'Work item was claimed by another runner')
    }
    await db.insert(leases).values(lease)
    if (workItem.sessionId) {
      await db
        .update(sessions)
        .set({ state: 'pending', stateReason: 'waiting-for-runner', updatedAt: timestamp })
        .where(
          and(
            eq(sessions.id, workItem.sessionId),
            eq(sessions.projectId, auth.project.id),
            eq(sessions.state, 'pending'),
          ),
        )
    }
    // Claim-time secret validation: the lease must not be handed out when the
    // work item's secret env cannot be resolved (for example a revoked
    // credential version). Resolved values are delivered to the runner via
    // GET /work-items/{id}; nothing secret is stored here.
    if (
      payload.type === 'session.start' &&
      Array.isArray(payload.runtimeSecretEnv) &&
      payload.runtimeSecretEnv.length > 0
    ) {
      try {
        await resolveRuntimeSecretEnv(
          c.env,
          db,
          { organizationId: auth.organization.id, projectId: auth.project.id },
          payload.runtimeSecretEnv,
        )
      } catch (error) {
        const safeError = safeRuntimeError(error)
        const failedAt = now()
        await db.update(leases).set({ state: 'failed', updatedAt: failedAt }).where(eq(leases.id, lease.id))
        await db
          .update(workItems)
          .set({
            state: 'failed',
            runnerId: null,
            leaseId: null,
            leaseExpiresAt: null,
            error: stringify({ message: safeError.message }),
            updatedAt: failedAt,
          })
          .where(eq(workItems.id, workItem.id))
        if (workItem.sessionId) {
          await db
            .update(sessions)
            .set({ state: 'error', stateReason: safeError.message, updatedAt: failedAt })
            .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id)))
        }
        await releaseRunnerLoad(db, auth.project.id, runner.id, failedAt)
        return errorResponse(c, 409, 'conflict', safeError.message)
      }
    }
    return c.json(serializeLease(lease), 201)
  })
  .openapi(listLeasesRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { runnerId, state, limit = 50, cursor } = c.req.valid('query')
    if (isRunnerOidcAuth(c.env, auth)) {
      if (!runnerId) {
        return errorResponse(c, 400, 'validation_error', 'Runner tokens must filter leases by runnerId')
      }
      const runner = await findRunner(db, auth, runnerId)
      if (!runner || !runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
    }
    await expireStaleLeases(db, auth)
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(leases.projectId, auth.project.id),
      runnerId ? eq(leases.runnerId, runnerId) : undefined,
      state ? eq(leases.state, state) : undefined,
      parsedCursor
        ? or(
            lt(leases.createdAt, parsedCursor.createdAt),
            and(eq(leases.createdAt, parsedCursor.createdAt), lt(leases.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(leases)
      .where(and(...filters))
      .orderBy(desc(leases.createdAt), desc(leases.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeLease), pagination: page.pagination }, 200)
  })
  .openapi(readLeaseRoute, async (c) => {
    const { leaseId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const lease = await findLease(db, auth, leaseId)
    if (!lease) {
      return errorResponse(c, 404, 'not_found', 'Lease not found')
    }
    if (isRunnerOidcAuth(c.env, auth)) {
      const runner = await findRunner(db, auth, lease.runnerId)
      if (!runner || !runnerOperationAuthorized(c.env, auth, runner)) {
        return runnerForbidden(c)
      }
    }
    return c.json(serializeLease(lease), 200)
  })
  .openapi(updateLeaseRoute, async (c) => {
    const { leaseId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    await expireStaleLeases(db, auth)
    const lease = await findLease(db, auth, leaseId)
    if (!lease) {
      return errorResponse(c, 404, 'not_found', 'Lease not found')
    }
    const runner = await findRunner(db, auth, lease.runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
    }
    const workItem = await db
      .select()
      .from(workItems)
      .where(and(eq(workItems.id, lease.workItemId), eq(workItems.projectId, auth.project.id)))
      .get()
    if (!workItem) {
      return errorResponse(c, 404, 'not_found', 'Work item not found')
    }
    if (
      lease.state !== 'active' ||
      lease.expiresAt <= now() ||
      workItem.state !== 'leased' ||
      workItem.leaseId !== lease.id ||
      workItem.runnerId !== lease.runnerId
    ) {
      return errorResponse(c, 409, 'conflict', 'Lease is no longer active')
    }
    const timestamp = now()
    const requestedState = body.state ?? 'active'
    if (requestedState === 'active') {
      let expiresAt: string
      if (body.expiresAt) {
        const ceiling = new Date(Date.now() + MAX_LEASE_DURATION_SECONDS * 1000).toISOString()
        if (body.expiresAt <= timestamp || body.expiresAt > ceiling) {
          return errorResponse(
            c,
            400,
            'validation_error',
            'Lease expiry must be in the future and within the maximum lease duration',
            {
              fields: { expiresAt: 'Expiry must be in the future and within 900 seconds.' },
            },
          )
        }
        expiresAt = body.expiresAt
      } else {
        expiresAt = new Date(
          Date.now() + (body.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS) * 1000,
        ).toISOString()
      }
      const renewedPayload = payloadWithResumeToken(workItem, body.resumeToken)
      const renewedWorkItem = await db
        .update(workItems)
        .set({
          leaseExpiresAt: expiresAt,
          updatedAt: timestamp,
          ...(renewedPayload !== null ? { payload: renewedPayload } : {}),
        })
        .where(
          and(
            eq(workItems.id, workItem.id),
            eq(workItems.state, 'leased'),
            eq(workItems.leaseId, lease.id),
            eq(workItems.runnerId, lease.runnerId),
          ),
        )
        .returning({ id: workItems.id })
        .get()
      if (!renewedWorkItem) {
        return errorResponse(c, 409, 'conflict', 'Lease no longer owns the work item')
      }
      await db
        .update(leases)
        .set({
          expiresAt,
          renewedAt: timestamp,
          updatedAt: timestamp,
          ...(body.resumeToken ? { resumeToken: body.resumeToken } : {}),
        })
        .where(and(eq(leases.id, leaseId), eq(leases.state, 'active')))
      if (renewedPayload !== null && workItem.sessionId) {
        // A fresh runtime resume token marks a safe resume point. Record it as
        // a canonical lifecycle event carrying only the safe work-item
        // reference — the raw provider token stays inside the work payload.
        await appendSessionRunnerEvent(db, auth, workItem.sessionId, {
          type: 'session_checkpoint',
          payload: { resumeTokenRef: `work-item:${workItem.id}`, scope: 'runtime-resume-token' },
          metadata: workItemRuntimeMetadata(workItem),
        })
      }
    } else if (requestedState === 'interrupted') {
      // The runner stopped mid-flight (e.g. graceful shutdown). End the lease but
      // keep the work recoverable so a restarted runner resumes the session.
      const released = await db
        .update(leases)
        .set({
          state: 'expired',
          updatedAt: timestamp,
          ...(body.resumeToken ? { resumeToken: body.resumeToken } : {}),
        })
        .where(and(eq(leases.id, leaseId), eq(leases.state, 'active')))
        .returning({ id: leases.id })
        .get()
      if (!released) {
        return errorResponse(c, 409, 'conflict', 'Lease is no longer active')
      }
      await releaseRunnerLoad(db, auth.project.id, lease.runnerId, timestamp)
      const interruptedPayload = payloadWithResumeToken(workItem, body.resumeToken)
      if (interruptedPayload !== null && workItem.sessionId) {
        await appendSessionRunnerEvent(db, auth, workItem.sessionId, {
          type: 'session_checkpoint',
          payload: { resumeTokenRef: `work-item:${workItem.id}`, scope: 'runtime-resume-token' },
          metadata: workItemRuntimeMetadata(workItem),
        })
      }
      const recovery = await requeueWorkItemForRecovery(
        db,
        auth.project.id,
        interruptedPayload !== null ? { ...workItem, payload: interruptedPayload } : workItem,
        timestamp,
      )
      if (recovery === 'requeued' && workItem.sessionId) {
        const recoveredPayload = parseJson<Record<string, unknown>>(interruptedPayload ?? workItem.payload)
        await appendSessionRunnerEvent(db, auth, workItem.sessionId, {
          type: 'session_resume',
          payload: {
            fromCheckpoint: recoveredPayload?.resumeToken ? `work-item:${workItem.id}` : null,
            reason: 'runner-recovery',
          },
          metadata: workItemRuntimeMetadata(workItem),
        })
      }
    } else {
      // Completion: the lease ends and its outcome lands on the work item —
      // the leases table carries no result/error columns.
      const result = body.result ? stringify(body.result) : null
      const error = body.error ? stringify(body.error) : null
      const completedWorkItem = await db
        .update(workItems)
        .set({
          state: requestedState === 'completed' ? 'succeeded' : requestedState,
          result,
          error,
          leaseExpiresAt: null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(workItems.id, workItem.id),
            eq(workItems.state, 'leased'),
            eq(workItems.leaseId, lease.id),
            eq(workItems.runnerId, lease.runnerId),
          ),
        )
        .returning({ id: workItems.id })
        .get()
      if (!completedWorkItem) {
        return errorResponse(c, 409, 'conflict', 'Lease no longer owns the work item')
      }
      await db
        .update(leases)
        .set({
          state: requestedState,
          updatedAt: timestamp,
          ...(body.resumeToken ? { resumeToken: body.resumeToken } : {}),
        })
        .where(and(eq(leases.id, leaseId), eq(leases.state, 'active')))
      await releaseRunnerLoad(db, auth.project.id, lease.runnerId, timestamp)
      if (workItem.sessionId && !(await hasNewerActiveSessionWork(db, auth.project.id, workItem))) {
        const activeChannel = await db
          .select({ id: sessionChannels.id })
          .from(sessionChannels)
          .where(
            and(
              eq(sessionChannels.projectId, auth.project.id),
              eq(sessionChannels.sessionId, workItem.sessionId),
              eq(sessionChannels.leaseId, lease.id),
              eq(sessionChannels.state, 'active'),
            ),
          )
          .get()
        const failureReason =
          requestedState === 'failed' ? await runtimeFailureStateReason(db, workItem.sessionId) : null
        const sessionUpdate =
          requestedState === 'cancelled'
            ? {
                state: 'stopped',
                stateReason: 'runner-cancelled',
                stoppedAt: timestamp,
                updatedAt: timestamp,
              }
            : {
                state: requestedState === 'completed' ? 'idle' : 'error',
                stateReason: requestedState === 'completed' ? null : (failureReason ?? 'runner-failed'),
                updatedAt: timestamp,
              }
        const pendingWithoutAcceptedChannel = and(
          eq(sessions.state, 'pending'),
          or(eq(sessions.stateReason, 'waiting-for-runner'), eq(sessions.stateReason, 'waiting-for-runner-recovery')),
        )
        const pendingRecoveryForAcceptedChannel = and(
          eq(sessions.state, 'pending'),
          eq(sessions.stateReason, 'waiting-for-runner-recovery'),
        )
        await db
          .update(sessions)
          .set(sessionUpdate)
          .where(
            and(
              eq(sessions.id, workItem.sessionId),
              eq(sessions.projectId, auth.project.id),
              activeChannel
                ? or(eq(sessions.state, 'running'), pendingRecoveryForAcceptedChannel)
                : or(eq(sessions.state, 'running'), pendingWithoutAcceptedChannel),
            ),
          )
      }
    }
    const updatedLease = await findLease(db, auth, leaseId)
    if (!updatedLease) {
      throw new Error('Updated lease row is required')
    }
    return c.json(serializeLease(updatedLease), 200)
  })
  .openapi(leaseChannelRoute, acceptLeaseSessionChannel)

export default routes
