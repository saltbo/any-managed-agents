import { createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte, max, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, isRunnerOidcAuth, requireAuth } from '../auth/session'
import {
  environments,
  runnerHeartbeats,
  runnerSessionChannels,
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
import { decryptSecretValue } from '../vaultCrypto'

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
    authMode: z.string().openapi({ example: 'oidc' }),
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

const RunnerSessionChannelMetadataSchema = z
  .object({
    upgrade: z.literal('websocket').openapi({ example: 'websocket' }),
  })
  .openapi('RunnerSessionChannelMetadata')

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

function parseRawJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
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
  const unscopedNonSessionWork = and(
    sql`json_extract(${runnerWorkItems.payload}, '$.type') != 'session.start'`,
    sql`json_extract(${runnerWorkItems.payload}, '$.requiredRunnerCapability') IS NULL`,
  )
  if (capabilities.length === 0) {
    return unscopedNonSessionWork
  }
  return or(
    unscopedNonSessionWork,
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

function serializeLeaseForRunner(lease: LeaseRow, workItem: WorkItemRow) {
  return {
    ...serializeLease(lease, workItem),
    workItem: {
      ...serializeWorkItem(workItem),
      payload: parseRawJson<Record<string, unknown>>(workItem.payload) ?? {},
    },
  }
}

async function materializeLeaseWorkItemForRunner(env: Env, db: Db, auth: AuthContext, workItem: WorkItemRow) {
  const payload = parseRawJson<Record<string, unknown>>(workItem.payload) ?? {}
  if (payload.type !== 'session.start') {
    return workItem
  }
  const runtimeSecretEnv = Array.isArray(payload.runtimeSecretEnv) ? payload.runtimeSecretEnv : []
  if (runtimeSecretEnv.length === 0) {
    return workItem
  }
  const runtimeEnv =
    payload.runtimeEnv && typeof payload.runtimeEnv === 'object' && !Array.isArray(payload.runtimeEnv)
      ? { ...(payload.runtimeEnv as Record<string, string>) }
      : {}
  for (const item of runtimeSecretEnv) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const { name, ref } = item as { name?: unknown; ref?: unknown }
    if (typeof name !== 'string' || typeof ref !== 'string') {
      continue
    }
    const version = await db
      .select({ metadata: vaultCredentialVersions.metadata })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, ref),
          eq(vaultCredentialVersions.organizationId, auth.organization.id),
          or(eq(vaultCredentialVersions.projectId, auth.project.id), isNull(vaultCredentialVersions.projectId)),
          eq(vaultCredentialVersions.status, 'active'),
        ),
      )
      .get()
    const metadata = version ? parseRawJson<Record<string, unknown>>(version.metadata) : null
    const value = await decryptSecretValue(env, metadata?.encryptedSecretValue)
    if (typeof value === 'string') {
      runtimeEnv[name] = value
      continue
    }
    const legacyValue = metadata?.localSecretValue
    if (typeof legacyValue === 'string') {
      runtimeEnv[name] = legacyValue
      continue
    }
    throw new Error(`Runtime secret ${ref} cannot be resolved for self-hosted runner dispatch`)
  }
  return { ...workItem, payload: JSON.stringify({ ...payload, runtimeEnv }) }
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

function runnerOperationAuthorized(env: Env, auth: AuthContext, runner: RunnerRow) {
  if (isRunnerOidcAuth(env, auth)) {
    if (auth.oidc.runnerId) {
      return runner.authMode === 'federated' && runner.id === auth.oidc.runnerId
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

function runnerForbidden(c: Context<{ Bindings: Env }>) {
  return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this runner')
}

function runnerOidcBindingFields(env: Env, auth: AuthContext, authMode: string) {
  if (!isRunnerOidcAuth(env, auth)) {
    return null
  }
  if (auth.oidc.runnerId) {
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
  return requested ?? (auth.oidc.runnerId ? 'federated' : 'oidc')
}

function runnerIdForRegistration(auth: AuthContext) {
  return auth.oidc.runnerId ?? newId('runner')
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
    if (workItem?.status !== 'leased' || workItem.leaseId !== lease.id) {
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

function workItemRuntimeMetadata(workItem: WorkItemRow) {
  const payload = parseJson<Record<string, unknown>>(workItem.payload) ?? {}
  return {
    workItemId: workItem.id,
    ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
    ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
  }
}

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

async function activeLeaseWorkItem(
  db: Db,
  auth: AuthContext,
  runnerId: string,
  leaseId: string,
): Promise<{ lease: LeaseRow; workItem: WorkItemRow } | null> {
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
    return null
  }
  const workItem = await db
    .select()
    .from(runnerWorkItems)
    .where(and(eq(runnerWorkItems.id, lease.workItemId), eq(runnerWorkItems.projectId, auth.project.id)))
    .get()
  if (
    !workItem?.sessionId ||
    lease.expiresAt <= now() ||
    workItem.status !== 'leased' ||
    workItem.leaseId !== lease.id ||
    workItem.runnerId !== runnerId
  ) {
    return null
  }
  return { lease, workItem }
}

async function acceptRunnerSessionChannel(c: Context<{ Bindings: Env }>) {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return errorResponse(c, 426, 'conflict', 'Runner session channel requires a WebSocket upgrade')
  }
  const runnerId = c.req.param('runnerId')
  const leaseId = c.req.param('leaseId')
  if (!runnerId || !leaseId) {
    return errorResponse(c, 400, 'validation_error', 'Runner id and lease id are required')
  }
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
  await expireStaleLeases(db, auth)
  const ownership = await activeLeaseWorkItem(db, auth, runnerId, leaseId)
  if (!ownership) {
    return errorResponse(c, 409, 'conflict', 'Runner lease no longer owns a self-hosted session')
  }
  const { workItem } = ownership
  if (!workItem.sessionId) {
    return errorResponse(c, 409, 'conflict', 'Runner work item is not attached to a session')
  }
  const waitingSession = await db
    .select({ id: sessions.id, status: sessions.status, statusReason: sessions.statusReason })
    .from(sessions)
    .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id)))
    .get()
  if (
    !(
      (waitingSession?.status === 'pending' &&
        (waitingSession.statusReason === 'waiting-for-runner' ||
          waitingSession.statusReason === 'waiting-for-runner-recovery')) ||
      (waitingSession?.status === 'running' && waitingSession.statusReason === null)
    )
  ) {
    return errorResponse(c, 409, 'conflict', 'Session is not waiting for a runner channel')
  }

  const timestamp = now()
  await db
    .update(runnerSessionChannels)
    .set({ status: 'stale', closedAt: timestamp, closeReason: 'superseded', updatedAt: timestamp })
    .where(
      and(
        eq(runnerSessionChannels.projectId, auth.project.id),
        eq(runnerSessionChannels.status, 'active'),
        or(eq(runnerSessionChannels.sessionId, workItem.sessionId), eq(runnerSessionChannels.leaseId, leaseId)),
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
    status: 'active',
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
      status: 'running',
      statusReason: null,
      runtimeEndpointPath: `/runtime/sessions/${workItem.sessionId}/rpc`,
      startedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(sessions.id, workItem.sessionId),
        eq(sessions.projectId, auth.project.id),
        or(
          and(
            eq(sessions.status, 'pending'),
            or(
              eq(sessions.statusReason, 'waiting-for-runner'),
              eq(sessions.statusReason, 'waiting-for-runner-recovery'),
            ),
          ),
          and(eq(sessions.status, 'running'), isNull(sessions.statusReason)),
        ),
      ),
    )
    .returning({ id: sessions.id })
    .get()
  if (!acceptedSession) {
    return errorResponse(c, 409, 'conflict', 'Session is not waiting for a runner channel')
  }
  await db.insert(runnerSessionChannels).values(channel)
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
    .update(runnerSessionChannels)
    .set({ status: 'closed', closedAt: timestamp, closeReason: 'channel-upgrade-failed', updatedAt: timestamp })
    .where(eq(runnerSessionChannels.id, channel.id))
  await db
    .update(sessions)
    .set({ status: 'pending', statusReason: 'waiting-for-runner-recovery', updatedAt: timestamp })
    .where(
      and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'running')),
    )
  return response
}

async function listRunnerWorkItems(c: Context<{ Bindings: Env }>) {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }
  if (isRunnerOidcAuth(c.env, auth)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource')
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Lease not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const runnerSessionChannelRoute = createRoute({
  method: 'get',
  path: '/{runnerId}/leases/{leaseId}/channel',
  operationId: 'connectRunnerSessionChannel',
  tags: ['Runner leases'],
  summary: 'Open a claimed runner session WebSocket channel',
  ...AuthenticatedOperation,
  request: { params: LeaseParamsSchema },
  responses: {
    101: { description: 'Runner session channel accepted as a WebSocket upgrade' },
    200: {
      description: 'Runner session channel metadata for OpenAPI clients',
      content: { 'application/json': { schema: RunnerSessionChannelMetadataSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
    426: {
      description: 'WebSocket upgrade required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    const credentialFields = await validateRunnerCredentialSecretRef(db, auth, body.credentialSecretRef)
    if (credentialFields) {
      return errorResponse(c, 400, 'validation_error', 'Runner credential secret reference is invalid', {
        fields: credentialFields,
      })
    }
    const timestamp = now()
    const runnerId = runnerIdForRegistration(auth)
    const existingRunner = await db.select().from(runners).where(eq(runners.id, runnerId)).get()
    const runner = {
      id: runnerId,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      name: body.name,
      capabilities: stringify(auth.oidc.runnerCapabilities.length ? auth.oidc.runnerCapabilities : body.capabilities ?? []),
      environmentId: environmentId ?? null,
      credentialSecretRef: body.credentialSecretRef ?? null,
      authMode,
      oidcSubject: auth.oidc.subject,
      oidcClientId: auth.oidc.clientId,
      status: 'offline',
      currentLoad: 0,
      maxConcurrent: body.maxConcurrent ?? 1,
      metadata: stringify(body.metadata ?? {}),
      lastHeartbeatAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (existingRunner) {
      if (
        existingRunner.projectId !== auth.project.id ||
        existingRunner.authMode !== 'federated' ||
        !auth.oidc.runnerId ||
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
          credentialSecretRef: runner.credentialSecretRef,
          authMode: runner.authMode,
          oidcSubject: runner.oidcSubject,
          oidcClientId: runner.oidcClientId,
          maxConcurrent: runner.maxConcurrent,
          metadata: runner.metadata,
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
      runnerToken && !auth.oidc.runnerId && auth.oidc.clientId ? eq(runners.oidcClientId, auth.oidc.clientId) : undefined,
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
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
    }
    if (runner.status === 'disabled') {
      return errorResponse(c, 409, 'conflict', 'Disabled runners cannot heartbeat until re-enabled by an operator')
    }
    if (hasSecretMaterial(body.metadata)) {
      return errorResponse(c, 400, 'validation_error', 'Runner heartbeat metadata must not contain raw secret material')
    }
    const timestamp = now()
    const status = body.status ?? 'active'
    const capabilities = auth.oidc.runnerCapabilities.length
      ? stringify(auth.oidc.runnerCapabilities)
      : body.capabilities
        ? stringify(body.capabilities)
        : runner.capabilities
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
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
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
        .set({ status: 'pending', statusReason: 'waiting-for-runner', updatedAt: timestamp })
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
    const responseWorkItem = await materializeLeaseWorkItemForRunner(c.env, db, auth, leasedWorkItem)
    return c.json(serializeLeaseForRunner(lease, responseWorkItem), 201)
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
    const runner = await findRunner(db, auth, runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
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
      await releaseRunnerLoad(db, auth.project.id, runnerId, timestamp)
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
          .where(and(eq(sessions.id, workItem.sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'running')))
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
    const runner = await findRunner(db, auth, runnerId)
    if (!runner) {
      return errorResponse(c, 404, 'not_found', 'Runner not found')
    }
    if (!runnerOperationAuthorized(c.env, auth, runner)) {
      return runnerForbidden(c)
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
        metadata: {
          ...(event.metadata ?? {}),
          ...workItemRuntimeMetadata(workItem),
          runnerId,
          leaseId,
        },
      })
    }
    return c.json({ accepted: events.length }, 202)
  })
  .openapi(runnerSessionChannelRoute, acceptRunnerSessionChannel)

export default routes
