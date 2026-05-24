import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gt, gte, like, lt, lte, ne, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { recordAudit, requestId } from '../audit'
import { type AuthContext, requireAuth } from '../auth/session'
import {
  agentDefinitions,
  agentDefinitionVersions,
  environments,
  environmentVersions,
  mcpConnections,
  mcpConnectionTools,
  sessionEvents,
  sessions,
} from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  eventListQuerySchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  paginateSequenceRows,
  parseListCursor,
} from '../openapi'
import { evaluateMcpToolPolicy, evaluateProviderPolicy } from '../policy'
import { runtimeEndpointPath, safeRuntimeError, startPiBridge, stopPiBridge } from '../runtime/pi/bridge'

const app = createApiRouter()

const SESSION_STATUSES = ['pending', 'running', 'idle', 'stopped', 'error', 'archived', 'requires-action'] as const
const EVENT_VISIBILITIES = ['runtime', 'transcript', 'debug', 'audit'] as const
const RUNTIME_START_TIMEOUT_MS = 120_000

const JsonObjectSchema = z.record(z.string(), z.unknown())
const AgentVersionSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    instructions: z.string().nullable(),
    provider: z.string(),
    model: z.string(),
    systemPrompt: z.string().nullable(),
    allowedTools: z.array(z.string()),
    mcpConnectors: z.array(z.string()),
    sandboxPolicy: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionAgentSnapshot')

const EnvironmentVersionSchema = z
  .object({
    id: z.string(),
    environmentId: z.string(),
    projectId: z.string(),
    version: z.number().int(),
    packages: z.array(JsonObjectSchema),
    variables: JsonObjectSchema,
    secretRefs: z.array(JsonObjectSchema),
    networkPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    packageManagerPolicy: JsonObjectSchema,
    resourceLimits: JsonObjectSchema,
    runtimeImage: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('SessionEnvironmentSnapshot')

export const SessionSchema = z
  .object({
    id: z.string().openapi({ example: 'session_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    agentId: z.string().openapi({ example: 'agent_abc123' }),
    agentVersionId: z.string().openapi({ example: 'agentver_abc123' }),
    agentSnapshot: AgentVersionSchema,
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    environmentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    environmentSnapshot: EnvironmentVersionSchema.nullable(),
    title: z.string().nullable().openapi({ example: 'Implement billing export' }),
    resourceRefs: z.array(JsonObjectSchema).openapi({ example: [{ type: 'repository', id: 'repo_abc123' }] }),
    vaultRefs: z.array(JsonObjectSchema).openapi({ example: [{ type: 'credential', id: 'cred_abc123' }] }),
    durableObjectName: z.string().openapi({ example: 'org_org123:project_project123:session_session123' }),
    sandboxId: z.string().nullable().openapi({ example: 'session_abc123' }),
    piRuntimeId: z.string().nullable().openapi({ example: 'pi_session_abc123' }),
    piProcessId: z.string().nullable().openapi({ example: '1234' }),
    runtimeEndpointPath: z.string().openapi({ example: '/runtime/sessions/session_abc123/rpc' }),
    agentUrl: z.string().openapi({ example: '/agents/managed-agent/session_abc123' }),
    modelProvider: z.string().openapi({ example: 'workers-ai' }),
    modelConfig: JsonObjectSchema,
    status: z.enum(SESSION_STATUSES).openapi({ example: 'idle' }),
    statusReason: z.string().nullable(),
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
    organizationId: z.string(),
    projectId: z.string(),
    sessionId: z.string(),
    sequence: z.number().int(),
    type: z.string(),
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
    environmentId: z.string().min(1).openapi({ example: 'env_abc123' }),
    title: z.string().min(1).max(160).optional().openapi({ example: 'Implement billing export' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { ticket: 'AMA-123' } }),
    resourceRefs: z
      .array(JsonObjectSchema)
      .max(50)
      .optional()
      .openapi({ example: [{ type: 'repository', id: 'repo_abc123' }] }),
    vaultRefs: z
      .array(JsonObjectSchema)
      .max(50)
      .optional()
      .openapi({ example: [{ type: 'credential', id: 'cred_abc123' }] }),
  })
  .strict()
  .openapi('CreateSessionRequest')

const UpdateSessionSchema = z
  .object({
    status: z.enum(['stopped', 'archived']).openapi({ example: 'stopped' }),
  })
  .openapi('UpdateSessionRequest')

const ParamsSchema = z.object({
  sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' }, example: 'session_abc123' }),
})
const StopSessionQuerySchema = z.object({
  reason: z
    .enum(['user_requested', 'timeout', 'policy', 'runtime_error'])
    .optional()
    .openapi({ param: { name: 'reason', in: 'query' }, example: 'user_requested' }),
})

const ListQuerySchema = listQuerySchema(SESSION_STATUSES)
const EventsQuerySchema = eventListQuerySchema().extend({
  type: z
    .string()
    .optional()
    .openapi({ param: { name: 'type', in: 'query' }, example: 'message_update' }),
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

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agentDefinitions.$inferSelect
type AgentVersionRow = typeof agentDefinitionVersions.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect
type SessionRow = typeof sessions.$inferSelect
type SessionEventRow = typeof sessionEvents.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function stringify(value: unknown) {
  return JSON.stringify(value)
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

function serializeAgentVersion(row: AgentVersionRow) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    instructions: row.instructions,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    allowedTools: JSON.parse(row.allowedTools) as string[],
    mcpConnectors: JSON.parse(row.mcpConnectors) as string[],
    sandboxPolicy: JSON.parse(row.sandboxPolicy) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

function serializeEnvironmentVersion(row: EnvironmentVersionRow) {
  return {
    ...row,
    packages: JSON.parse(row.packages) as Record<string, unknown>[],
    variables: JSON.parse(row.variables) as Record<string, unknown>,
    secretRefs: JSON.parse(row.secretRefs) as Record<string, unknown>[],
    networkPolicy: JSON.parse(row.networkPolicy) as Record<string, unknown>,
    mcpPolicy: JSON.parse(row.mcpPolicy) as Record<string, unknown>,
    packageManagerPolicy: JSON.parse(row.packageManagerPolicy) as Record<string, unknown>,
    resourceLimits: JSON.parse(row.resourceLimits) as Record<string, unknown>,
    runtimeImage: JSON.parse(row.runtimeImage) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }
}

function serializeSession(row: SessionRow) {
  const agentSnapshot = parseJson<ReturnType<typeof serializeAgentVersion>>(row.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }

  return {
    id: row.id,
    organizationId: row.organizationId ?? '',
    projectId: row.projectId ?? '',
    agentId: row.agentId,
    agentVersionId: row.agentVersionId ?? '',
    agentSnapshot,
    environmentId: row.environmentId,
    environmentVersionId: row.environmentVersionId,
    environmentSnapshot: parseJson<ReturnType<typeof serializeEnvironmentVersion>>(row.environmentSnapshot),
    title: row.title,
    resourceRefs: parseJson<Record<string, unknown>[]>(row.resourceRefs) ?? [],
    vaultRefs: parseJson<Record<string, unknown>[]>(row.vaultRefs) ?? [],
    durableObjectName: row.durableObjectName,
    sandboxId: row.sandboxId,
    piRuntimeId: row.piRuntimeId,
    piProcessId: row.piProcessId,
    runtimeEndpointPath: row.runtimeEndpointPath ?? runtimeEndpointPath(row.id),
    agentUrl: `/agents/managed-agent/${row.durableObjectName}`,
    modelProvider: row.modelProvider ?? agentSnapshot.provider,
    modelConfig: parseJson<Record<string, unknown>>(row.modelConfig) ?? { model: agentSnapshot.model },
    status: row.status as (typeof SESSION_STATUSES)[number],
    statusReason: row.statusReason,
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeEvent(row: SessionEventRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    sequence: row.sequence,
    type: row.type,
    visibility: row.visibility as (typeof EVENT_VISIBILITIES)[number],
    role: row.role,
    parentEventId: row.parentEventId,
    correlationId: row.correlationId,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

function mcpConnectorIds(snapshot: Record<string, unknown>) {
  const connectors = Array.isArray(snapshot.connectors) ? snapshot.connectors : []
  return connectors
    .map((connector) =>
      connector && typeof connector === 'object' && 'connectorId' in connector
        ? (connector.connectorId as unknown)
        : null,
    )
    .filter((connectorId): connectorId is string => typeof connectorId === 'string')
}

async function resolveMcpSnapshot(
  db: Db,
  auth: AuthContext,
  sessionId: string,
  agentSnapshot: ReturnType<typeof serializeAgentVersion>,
  environmentSnapshot: ReturnType<typeof serializeEnvironmentVersion> | null,
) {
  const connections = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.projectId, auth.project.id), eq(mcpConnections.status, 'connected')))
  const agentConnectors = agentSnapshot.mcpConnectors
  const scopedConnections =
    agentConnectors.length === 0
      ? connections
      : connections.filter((connection) => agentConnectors.includes(connection.connectorId))

  const snapshotConnections = []
  const sessionContext = {
    id: sessionId,
    agentSnapshot: stringify(agentSnapshot),
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
  }
  for (const connection of scopedConnections) {
    const tools = await db
      .select()
      .from(mcpConnectionTools)
      .where(and(eq(mcpConnectionTools.connectionId, connection.id), eq(mcpConnectionTools.status, 'available')))
    const allowedTools = []
    for (const tool of tools) {
      const decision = await evaluateMcpToolPolicy(db, auth, {
        connectorId: connection.connectorId,
        toolName: tool.name,
        session: sessionContext,
      })
      if (decision.allowed) {
        allowedTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: parseJson<Record<string, unknown>>(tool.inputSchema) ?? {},
          approvalMode: tool.approvalMode,
          policyMetadata: parseJson<Record<string, unknown>>(tool.policyMetadata) ?? {},
        })
      }
    }
    if (allowedTools.length > 0) {
      snapshotConnections.push({
        connectionId: connection.id,
        connectorId: connection.connectorId,
        endpointUrl: connection.endpointUrl,
        approvalMode: connection.approvalMode,
        credentialRef: connection.credentialSecretRef,
        tools: allowedTools,
      })
    }
  }
  return { connectors: snapshotConnections }
}

async function currentAgentVersion(db: Db, agent: AgentRow) {
  if (!agent.currentVersionId) {
    return null
  }
  return (
    (await db
      .select()
      .from(agentDefinitionVersions)
      .where(and(eq(agentDefinitionVersions.id, agent.currentVersionId), eq(agentDefinitionVersions.agentId, agent.id)))
      .get()) ?? null
  )
}

async function findSession(db: Db, auth: AuthContext, sessionId: string) {
  return (
    (await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id)))
      .get()) ?? null
  )
}

export async function createSessionForAgent(
  c: Context<{ Bindings: Env }>,
  db: Db,
  auth: AuthContext,
  agentId: string,
  environmentId: string,
  options: {
    title?: string
    metadata?: Record<string, unknown>
    resourceRefs?: Record<string, unknown>[]
    vaultRefs?: Record<string, unknown>[]
  } = {},
) {
  if (
    hasSecretMaterial(options.metadata) ||
    hasSecretMaterial(options.resourceRefs) ||
    hasSecretMaterial(options.vaultRefs)
  ) {
    return errorResponse(c, 400, 'validation_error', 'Invalid session configuration', {
      fields: {
        metadata: 'Secret material must be stored in vault references.',
        resourceRefs: 'Resource references must not contain secret material.',
        vaultRefs: 'Vault references must not contain raw secret material.',
      },
    })
  }

  const agent = await db
    .select()
    .from(agentDefinitions)
    .where(and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.projectId, auth.project.id)))
    .get()
  if (!agent) {
    return errorResponse(c, 404, 'not_found', 'Agent not found')
  }
  if (agent.status !== 'active') {
    return errorResponse(c, 409, 'conflict', 'Archived agents cannot create sessions')
  }

  const agentVersion = await currentAgentVersion(db, agent)
  if (!agentVersion) {
    throw new Error('Agent current version is required')
  }
  const policyDecision = await evaluateProviderPolicy(db, auth, {
    providerId: agentVersion.provider,
    modelId: agentVersion.model,
  })
  if (!policyDecision.allowed) {
    await recordAudit(db, {
      auth,
      action: 'session.create',
      resourceType: 'session',
      outcome: 'denied',
      requestId: requestId(c),
      policyCategory: policyDecision.category,
      metadata: { agentId, providerId: agentVersion.provider, modelId: agentVersion.model, decision: policyDecision },
    })
    return errorResponse(c, 403, 'policy_denied', policyDecision.message, {
      category: policyDecision.category,
      resourceType:
        policyDecision.category === 'budget' ? 'budget' : policyDecision.category === 'model' ? 'model' : 'provider',
      resourceId:
        policyDecision.category === 'budget'
          ? policyDecision.rule
          : policyDecision.category === 'model'
            ? agentVersion.model
            : agentVersion.provider,
      ruleId: policyDecision.rule,
    })
  }

  const environment = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.id, environmentId),
        eq(environments.projectId, auth.project.id),
        eq(environments.status, 'active'),
      ),
    )
    .get()
  if (!environment?.currentVersionId) {
    return errorResponse(c, 409, 'conflict', 'Selected environment is archived or unavailable')
  }
  const environmentVersion =
    (await db
      .select()
      .from(environmentVersions)
      .where(
        and(
          eq(environmentVersions.id, environment.currentVersionId),
          eq(environmentVersions.projectId, auth.project.id),
        ),
      )
      .get()) ?? null
  if (!environmentVersion) {
    return errorResponse(c, 409, 'conflict', 'Selected environment is archived or unavailable')
  }

  const timestamp = now()
  const id = newId('session')
  const sandboxId = id.toLowerCase()
  const agentSnapshot = serializeAgentVersion(agentVersion)
  const environmentSnapshot = environmentVersion ? serializeEnvironmentVersion(environmentVersion) : null
  const pending = {
    id,
    agentId,
    organizationId: auth.organization.id,
    createdByUserId: auth.user.id,
    agentVersionId: agentVersion.id,
    agentSnapshot: stringify(agentSnapshot),
    environmentId,
    environmentVersionId: environmentVersion?.id ?? null,
    environmentSnapshot: environmentSnapshot ? stringify(environmentSnapshot) : null,
    title: options.title ?? null,
    resourceRefs: stringify(options.resourceRefs ?? []),
    vaultRefs: stringify(options.vaultRefs ?? []),
    projectId: auth.project.id,
    durableObjectName: `org_${auth.organization.id}:project_${auth.project.id}:session_${id}`,
    sandboxId,
    piRuntimeId: null,
    piProcessId: null,
    runtimeEndpointPath: runtimeEndpointPath(id),
    modelProvider: agentSnapshot.provider,
    modelConfig: stringify({ provider: agentSnapshot.provider, model: agentSnapshot.model }),
    status: 'pending',
    statusReason: null,
    metadata: stringify(options.metadata ?? {}),
    startedAt: null,
    stoppedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.insert(sessions).values(pending)
  await recordAudit(db, {
    auth,
    action: 'session.create',
    resourceType: 'session',
    resourceId: id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: id,
    metadata: { status: 'pending' },
  })

  const startRuntime = () =>
    startSessionRuntime(c.env, db, auth, {
      pending,
      agentSnapshot,
      environmentSnapshot,
    })

  if (c.env.AMA_RUNTIME_MODE !== 'test') {
    c.executionCtx.waitUntil(startRuntime())
    return c.json(serializeSession(pending), 201)
  }

  await startRuntime()
  const started = await findSession(db, auth, id)
  if (!started) {
    throw new Error('Created session was not persisted')
  }
  return c.json(serializeSession(started), 201)
}

async function startSessionRuntime(
  env: Env,
  db: Db,
  auth: AuthContext,
  input: {
    pending: SessionRow
    agentSnapshot: ReturnType<typeof serializeAgentVersion>
    environmentSnapshot: ReturnType<typeof serializeEnvironmentVersion> | null
  },
) {
  const { pending, agentSnapshot, environmentSnapshot } = input
  const sessionId = pending.id
  const sandboxId = pending.sandboxId ?? sessionId.toLowerCase()
  try {
    const mcpSnapshot = await resolveMcpSnapshot(db, auth, sessionId, agentSnapshot, environmentSnapshot)
    const runtime = await withTimeout(
      startPiBridge(env, {
        sessionId,
        sandboxId,
        provider: agentSnapshot.provider,
        model: agentSnapshot.model,
        agentSnapshot,
        environmentSnapshot,
        mcpSnapshot,
      }),
      RUNTIME_START_TIMEOUT_MS,
      'Pi runtime startup timed out',
    )
    const current = await findSession(db, auth, sessionId)
    if (!current || current.status !== 'pending') {
      if (current?.status !== 'idle') {
        await stopPiBridge(env, sandboxId, runtime.piRuntimeId).catch(() => undefined)
      }
      return
    }
    const startedAt = now()
    const existingMetadata = parseJson<Record<string, unknown>>(pending.metadata) ?? {}
    const metadata = {
      ...existingMetadata,
      ...runtime.metadata,
      runtime: 'pi',
      protocol: 'pi-rpc-jsonl',
      mcpConnectors: mcpConnectorIds(mcpSnapshot),
    }
    const started = {
      sandboxId,
      piRuntimeId: runtime.piRuntimeId,
      piProcessId: runtime.piProcessId,
      runtimeEndpointPath: runtime.runtimeEndpointPath,
      status: 'idle',
      metadata: stringify(metadata),
      startedAt,
      updatedAt: startedAt,
    }
    await db
      .update(sessions)
      .set(started)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'pending')))
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      sessionId,
      metadata: {
        sandboxId: runtime.sandboxId,
        piRuntimeId: runtime.piRuntimeId,
        runtimeEndpointPath: runtime.runtimeEndpointPath,
      },
    })
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    const failed = {
      status: 'error',
      statusReason: safeError.message,
      metadata: stringify({
        ...(parseJson<Record<string, unknown>>(pending.metadata) ?? {}),
        runtime: 'pi',
        error: safeError,
      }),
      updatedAt: failedAt,
    }
    await db
      .update(sessions)
      .set(failed)
      .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, auth.project.id), eq(sessions.status, 'pending')))
    await recordAudit(db, {
      auth,
      action: 'session.runtime.start',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'failure',
      sessionId,
      metadata: { ...safeError },
    })
    await stopPiBridge(env, sandboxId, null).catch(() => undefined)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

async function stopSession(
  c: Context<{ Bindings: Env }>,
  db: Db,
  auth: AuthContext,
  session: SessionRow,
  reason = 'user_requested',
) {
  if (session.status === 'stopped') {
    return c.json(serializeSession(session), 200)
  }
  if (session.status === 'archived') {
    return errorResponse(c, 409, 'conflict', 'Archived sessions cannot be stopped')
  }
  if (!session.sandboxId) {
    return errorResponse(c, 409, 'conflict', 'Session has no sandbox runtime to stop')
  }

  const stoppingAt = now()
  await db
    .update(sessions)
    .set({ status: 'stopped', updatedAt: stoppingAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))

  try {
    await stopPiBridge(c.env, session.sandboxId, session.piRuntimeId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await db
      .update(sessions)
      .set({ status: 'error', statusReason: safeError.message, updatedAt: failedAt })
      .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
    await recordAudit(db, {
      auth,
      action: 'session.stop',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'failure',
      requestId: requestId(c),
      sessionId: session.id,
      metadata: { runtime: safeError },
    })
    return errorResponse(c, 409, 'conflict', 'Session runtime could not be stopped', { runtime: safeError })
  }

  const stoppedAt = now()
  await db
    .update(sessions)
    .set({ status: 'stopped', stoppedAt, updatedAt: stoppedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { reason, sandboxId: session.sandboxId, piRuntimeId: session.piRuntimeId },
  })
  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped session row is required')
  }
  return c.json(serializeSession(stopped), 200)
}

async function archiveSession(c: Context<{ Bindings: Env }>, db: Db, auth: AuthContext, session: SessionRow) {
  if (session.status === 'idle' || session.status === 'running') {
    const stoppedResponse = await stopSession(c, db, auth, session)
    if (!stoppedResponse.ok) {
      return stoppedResponse
    }
  }

  const archivedAt = now()
  await db
    .update(sessions)
    .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { status: 'archived' },
  })
  return c.body(null, 204)
}

async function archiveSessionAndRead(c: Context<{ Bindings: Env }>, db: Db, auth: AuthContext, session: SessionRow) {
  if (session.status === 'idle' || session.status === 'running') {
    const stoppedResponse = await stopSession(c, db, auth, session)
    if (!stoppedResponse.ok) {
      return stoppedResponse
    }
  }

  const archivedAt = now()
  await db
    .update(sessions)
    .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestId(c),
    sessionId: session.id,
    metadata: { status: 'archived' },
  })
  const archived = await findSession(db, auth, session.id)
  if (!archived) {
    throw new Error('Archived session row is required')
  }
  return c.json(serializeSession(archived), 200)
}

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
    404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Policy denied', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    200: {
      description: 'Session list',
      content: { 'application/json': { schema: SessionListResponseSchema } },
    },
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
  summary: 'Update a session lifecycle state',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateSessionSchema } } },
  },
  responses: {
    200: { description: 'Updated session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const stopSessionRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/stop',
  operationId: 'stopSession',
  tags: ['Sessions'],
  summary: 'Stop a session',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    query: StopSessionQuerySchema,
  },
  responses: {
    200: { description: 'Stopped session', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveSessionRoute = createRoute({
  method: 'delete',
  path: '/{sessionId}',
  operationId: 'archiveSession',
  tags: ['Sessions'],
  summary: 'Archive a session',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    204: { description: 'Session archived' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const reconnectSessionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/reconnect',
  operationId: 'readSessionReconnect',
  tags: ['Sessions'],
  summary: 'Read reconnect metadata',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Reconnect metadata', content: { 'application/json': { schema: SessionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events',
  operationId: 'listSessionEvents',
  tags: ['Sessions'],
  summary: 'List session events',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events',
      content: { 'application/json': { schema: SessionEventListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const exportEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events/export',
  operationId: 'exportSessionEvents',
  tags: ['Sessions'],
  summary: 'Export session events as NDJSON',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session events export',
      content: { 'application/x-ndjson': { schema: z.string() } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const streamEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events/stream',
  operationId: 'streamSessionEvents',
  tags: ['Sessions'],
  summary: 'Stream session events as NDJSON',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema, query: EventsQuerySchema },
  responses: {
    200: {
      description: 'Session event stream',
      content: { 'application/x-ndjson': { schema: z.string() } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

app.openapi(createSessionRoute, async (c) => {
  const { agentId, environmentId, title, metadata, resourceRefs, vaultRefs } = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }
  return await createSessionForAgent(c, db, auth, agentId, environmentId, {
    ...(title !== undefined ? { title } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(resourceRefs !== undefined ? { resourceRefs } : {}),
    ...(vaultRefs !== undefined ? { vaultRefs } : {}),
  })
})

app.openapi(listSessionsRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
      fields: { cursor: 'Cursor is invalid.' },
    })
  }
  const filters = [
    eq(sessions.projectId, auth.project.id),
    status ? eq(sessions.status, status) : includeArchived === 'true' ? undefined : ne(sessions.status, 'archived'),
    search ? like(sessions.agentId, `%${search}%`) : undefined,
    createdFrom ? gte(sessions.createdAt, createdFrom) : undefined,
    createdTo ? lte(sessions.createdAt, createdTo) : undefined,
    parsedCursor
      ? or(
          lt(sessions.createdAt, parsedCursor.createdAt),
          and(eq(sessions.createdAt, parsedCursor.createdAt), lt(sessions.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(sessions)
    .where(and(...filters))
    .orderBy(desc(sessions.createdAt), desc(sessions.id))
    .limit(limit + 1)
  const page = paginateRows(rows, limit)
  const data = page.data.map((row) => serializeSession(row))
  return c.json({ data, pagination: page.pagination }, 200)
})

app.openapi(readSessionRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  return c.json(serializeSession(session), 200)
})

app.openapi(updateSessionRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const { status } = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  if (status === 'stopped') {
    return await stopSession(c, db, auth, session)
  }

  return await archiveSessionAndRead(c, db, auth, session)
})

app.openapi(stopSessionRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const { reason = 'user_requested' } = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  return await stopSession(c, db, auth, session, reason)
})

app.openapi(archiveSessionRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  return await archiveSession(c, db, auth, session)
})

app.openapi(reconnectSessionRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  return c.json(serializeSession(session), 200)
})

app.openapi(listEventsRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  const { afterSequence, limit = 100, type, visibility, createdFrom, createdTo } = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  const filters = [
    eq(sessionEvents.sessionId, sessionId),
    gt(sessionEvents.sequence, afterSequence ?? 0),
    type ? eq(sessionEvents.type, type) : undefined,
    eq(sessionEvents.visibility, visibility ?? 'runtime'),
    createdFrom ? gte(sessionEvents.createdAt, createdFrom) : undefined,
    createdTo ? lte(sessionEvents.createdAt, createdTo) : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(and(...filters))
    .orderBy(sessionEvents.sequence)
    .limit(limit + 1)
  const page = paginateSequenceRows(rows, limit)
  return c.json({ data: page.data.map(serializeEvent), pagination: page.pagination }, 200)
})

type EventsQuery = z.infer<typeof EventsQuerySchema>

async function eventsNdjsonResponse(c: Context<{ Bindings: Env }>, sessionId: string, query: EventsQuery) {
  const { afterSequence, limit = 200, type, visibility, createdFrom, createdTo } = query
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }
  const filters = [
    eq(sessionEvents.sessionId, sessionId),
    gt(sessionEvents.sequence, afterSequence ?? 0),
    type ? eq(sessionEvents.type, type) : undefined,
    eq(sessionEvents.visibility, visibility ?? 'runtime'),
    createdFrom ? gte(sessionEvents.createdAt, createdFrom) : undefined,
    createdTo ? lte(sessionEvents.createdAt, createdTo) : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(and(...filters))
    .orderBy(sessionEvents.sequence)
    .limit(limit)
  const body = rows.map((row) => JSON.stringify(serializeEvent(row))).join('\n')
  return c.text(body ? `${body}\n` : '', 200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
  })
}

async function streamEventsNdjsonResponse(c: Context<{ Bindings: Env }>, sessionId: string, query: EventsQuery) {
  const { afterSequence = 0, limit = 200, type, visibility, createdFrom, createdTo } = query
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return errorResponse(c, 404, 'not_found', 'Session not found')
  }

  const encoder = new TextEncoder()
  let lastSequence = afterSequence
  const stream = new ReadableStream({
    async start(controller) {
      const deadline = Date.now() + 1000
      while (Date.now() <= deadline) {
        const filters = [
          eq(sessionEvents.sessionId, sessionId),
          gt(sessionEvents.sequence, lastSequence),
          type ? eq(sessionEvents.type, type) : undefined,
          eq(sessionEvents.visibility, visibility ?? 'runtime'),
          createdFrom ? gte(sessionEvents.createdAt, createdFrom) : undefined,
          createdTo ? lte(sessionEvents.createdAt, createdTo) : undefined,
        ].filter((filter) => filter !== undefined)
        const rows = await db
          .select()
          .from(sessionEvents)
          .where(and(...filters))
          .orderBy(sessionEvents.sequence)
          .limit(limit)
        for (const row of rows) {
          lastSequence = row.sequence
          controller.enqueue(encoder.encode(`${JSON.stringify(serializeEvent(row))}\n`))
        }
        if (rows.length >= limit) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      controller.close()
    },
  })
  return c.body(stream, 200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
}

app.openapi(exportEventsRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  return (await eventsNdjsonResponse(c, sessionId, c.req.valid('query'))) as never
})

app.openapi(streamEventsRoute, async (c) => {
  const { sessionId } = c.req.valid('param')
  return (await streamEventsNdjsonResponse(c, sessionId, c.req.valid('query'))) as never
})

export default app
