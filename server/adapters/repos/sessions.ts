import type {
  SessionApprovalRecord,
  SessionConnectionRecord,
  SessionEventQuery,
  SessionEventRecord,
  SessionListPage,
  SessionListQuery,
  SessionMessageListPage,
  SessionMessageListQuery,
  SessionMessageRecord,
  SessionRecord,
  SessionRepo,
  SessionRuntimeRow,
} from '@server/usecases/ports'
import {
  AMA_SESSION_EVENT_TYPES,
  type AmaSessionEventType,
  canonicalAmaSessionEventFromRuntimeEvent,
  isAmaSessionEventType,
} from '@shared/session-events'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type { RuntimeName } from '../../contracts/environment-contracts'
import { leases, runners, sessionApprovals, sessionEvents, sessionMessages, sessions, workItems } from '../../db/schema'
import { insertCanonicalSessionEvent } from '../../db/session-event-store'
import { runtimeEndpointPath, runtimeMetadata } from '../../domain/runtime/driver'
import { hostingModeFromSnapshot } from '../../domain/session'
import { redactSensitiveValue } from '../../redaction'

type Db = ReturnType<typeof drizzle>
type SessionRow = typeof sessions.$inferSelect
type SessionEventRow = typeof sessionEvents.$inferSelect
type SessionMessageRow = typeof sessionMessages.$inferSelect
type SessionApprovalRow = typeof sessionApprovals.$inferSelect
type EventOrder = 'asc' | 'desc'

function parseJson<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

type SerializedAgentVersion = {
  id: string
  providerId: string
  model: string | null
} & Record<string, unknown>

function parseAgentSnapshot(value: string | null) {
  return parseJson<SerializedAgentVersion>(value)
}

function snapshotRuntime(metadata: Record<string, unknown>): RuntimeName {
  const runtime = metadata.runtime
  if (typeof runtime !== 'string') {
    throw new Error('Session runtime metadata is required')
  }
  return runtime as RuntimeName
}

function sessionModel(modelConfig: Record<string, unknown>, agentSnapshot: SerializedAgentVersion) {
  return typeof modelConfig.model === 'string'
    ? modelConfig.model
    : typeof agentSnapshot.model === 'string'
      ? agentSnapshot.model
      : null
}

function normalizeEnvironmentSnapshot(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) {
    return null
  }
  return {
    ...snapshot,
    hostingMode: hostingModeFromSnapshot(snapshot.hostingMode),
    networkPolicy: objectValue(snapshot.networkPolicy),
    runtimeConfig: objectValue(snapshot.runtimeConfig),
  }
}

function serializeSession(row: SessionRow): SessionRecord {
  const agentSnapshot = parseAgentSnapshot(row.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(parseJson<Record<string, unknown>>(row.environmentSnapshot))
  const metadata = parseJson<Record<string, unknown>>(row.metadata) ?? {}
  const modelConfig = parseJson<Record<string, unknown>>(row.modelConfig) ?? {}
  const hostingMode = hostingModeFromSnapshot(environmentSnapshot?.hostingMode)
  const runtime = snapshotRuntime(metadata)
  const provider = row.modelProvider ?? agentSnapshot.providerId
  const model = sessionModel(modelConfig, agentSnapshot)

  return {
    id: row.id,
    projectId: row.projectId ?? '',
    agentId: row.agentId,
    agentVersionId: row.agentVersionId ?? '',
    agentSnapshot: agentSnapshot as Record<string, unknown>,
    environmentId: row.environmentId,
    environmentVersionId: row.environmentVersionId,
    environmentSnapshot,
    title: row.title,
    resourceRefs: parseJson<Record<string, unknown>[]>(row.resourceRefs) ?? [],
    env: parseJson<Record<string, string>>(row.env) ?? {},
    secretEnv: parseJson<SessionRecord['secretEnv']>(row.secretEnv) ?? [],
    runtimeMetadata: runtimeMetadata({
      hostingMode,
      runtime,
      runtimeConfig: objectValue(metadata.runtimeConfig),
      provider,
      model,
      metadata,
    }),
    state: row.state,
    stateReason: row.stateReason,
    metadata,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeConnection(row: SessionRow): SessionConnectionRecord {
  const environmentSnapshot = normalizeEnvironmentSnapshot(parseJson<Record<string, unknown>>(row.environmentSnapshot))
  const metadata = parseJson<Record<string, unknown>>(row.metadata) ?? {}
  const agentSnapshot = parseAgentSnapshot(row.agentSnapshot)
  if (!agentSnapshot) {
    throw new Error('Session agent snapshot is required')
  }
  const hostingMode = hostingModeFromSnapshot(environmentSnapshot?.hostingMode)
  const meta = runtimeMetadata({
    hostingMode,
    runtime: snapshotRuntime(metadata),
    runtimeConfig: objectValue(metadata.runtimeConfig),
    provider: row.modelProvider ?? agentSnapshot.providerId,
    model: sessionModel(parseJson<Record<string, unknown>>(row.modelConfig) ?? {}, agentSnapshot),
    metadata,
  })
  // The path is the public runtime proxy mount, not the internal endpoint
  // column: cloud sessions always reconnect via the canonical proxy path,
  // self-hosted sessions only once a runner channel attached one.
  const path = row.runtimeEndpointPath ?? (hostingMode === 'cloud' ? runtimeEndpointPath(row.id) : null)
  return {
    sessionId: row.id,
    transport: meta.protocol,
    path,
    state: row.state,
    stateReason: row.stateReason,
  }
}

function serializeMessage(row: SessionMessageRow): SessionMessageRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    type: row.type as 'prompt',
    content: row.content,
    delivery: row.delivery,
    state: row.state,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeApproval(row: SessionApprovalRow): SessionApprovalRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    input: parseJson<Record<string, unknown>>(row.input) ?? {},
    relatedEventIds: parseJson<string[]>(row.relatedEventIds) ?? [],
    state: row.state,
    reason: row.reason,
    result: parseJson<Record<string, unknown>>(row.result),
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeEvent(row: SessionEventRow): SessionEventRecord {
  const rawPayload = JSON.parse(row.payload) as Record<string, unknown>
  const rawMetadata = JSON.parse(row.metadata) as Record<string, unknown>
  const event = isAmaSessionEventType(row.type)
    ? {
        type: row.type,
        visibility: row.visibility,
        role: row.role,
        payload: rawPayload,
        metadata: rawMetadata,
      }
    : canonicalAmaSessionEventFromRuntimeEvent(
        { ...rawPayload, type: row.type },
        { source: 'stored-session-event', ...rawMetadata },
      )
  if (!isAmaSessionEventType(row.type)) {
    event.metadata = { ...event.metadata, rawSessionEventType: row.type }
  }
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    sequence: row.sequence,
    type: event.type,
    visibility: event.visibility,
    role: event.role,
    parentEventId: row.parentEventId,
    correlationId: row.correlationId,
    payload: redactSensitiveValue(event.payload) as Record<string, unknown>,
    metadata: redactSensitiveValue(event.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

function runtimeRow(row: SessionRow): SessionRuntimeRow {
  return {
    id: row.id,
    projectId: row.projectId,
    organizationId: row.organizationId,
    state: row.state,
    archivedAt: row.archivedAt,
    sandboxId: row.sandboxId,
    metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
  }
}

function eventTypeFilter(type: string | undefined) {
  return type ? eq(sessionEvents.type, type) : undefined
}

function eventSequenceFilter(cursor: number, order: EventOrder) {
  return order === 'asc' ? gt(sessionEvents.sequence, cursor) : lt(sessionEvents.sequence, cursor)
}

function eventCursorFilter(cursor: number | undefined, order: EventOrder) {
  if (cursor === undefined) {
    return order === 'asc' ? eventSequenceFilter(0, order) : undefined
  }
  return eventSequenceFilter(cursor, order)
}

function eventFilters(sessionId: string, query: SessionEventQuery) {
  return [
    eq(sessionEvents.sessionId, sessionId),
    eventCursorFilter(query.cursor, query.order),
    eventTypeFilter(query.type),
    eq(sessionEvents.visibility, query.visibility ?? 'runtime'),
    query.createdFrom ? gte(sessionEvents.createdAt, query.createdFrom) : undefined,
    query.createdTo ? lte(sessionEvents.createdAt, query.createdTo) : undefined,
  ].filter((filter) => filter !== undefined)
}

function eventOrderBy(order: EventOrder) {
  return order === 'asc' ? asc(sessionEvents.sequence) : desc(sessionEvents.sequence)
}

export function createSessionRepo(db: Db): SessionRepo {
  return {
    async list(query: SessionListQuery): Promise<SessionListPage> {
      const filters = [
        eq(sessions.projectId, query.projectId),
        query.archived ? isNotNull(sessions.archivedAt) : isNull(sessions.archivedAt),
        query.state ? eq(sessions.state, query.state) : undefined,
        query.search ? like(sessions.agentId, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(sessions.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(sessions.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(sessions.createdAt, query.cursor.createdAt),
              and(eq(sessions.createdAt, query.cursor.createdAt), lt(sessions.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(sessions)
        .where(and(...filters))
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(serializeSession), hasMore }
    },

    async find(projectId, sessionId) {
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
        .get()
      return row ? serializeSession(row) : null
    },

    async findRuntimeRow(projectId, sessionId) {
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
        .get()
      return row ? runtimeRow(row) : null
    },

    async readConnection(projectId, sessionId) {
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
        .get()
      return row ? serializeConnection(row) : null
    },

    async updateFields(projectId, sessionId, fields, updatedAt) {
      await db
        .update(sessions)
        .set({
          ...(fields.title !== undefined ? { title: fields.title } : {}),
          ...(fields.metadata !== undefined ? { metadata: JSON.stringify(fields.metadata) } : {}),
          updatedAt,
        })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
      const row = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
        .get()
      return row ? serializeSession(row) : null
    },

    async listMessages(query: SessionMessageListQuery): Promise<SessionMessageListPage> {
      const filters = [
        eq(sessionMessages.sessionId, query.sessionId),
        eq(sessionMessages.projectId, query.projectId),
        query.cursor
          ? or(
              lt(sessionMessages.createdAt, query.cursor.createdAt),
              and(eq(sessionMessages.createdAt, query.cursor.createdAt), lt(sessionMessages.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(sessionMessages)
        .where(and(...filters))
        .orderBy(desc(sessionMessages.createdAt), desc(sessionMessages.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(serializeMessage), hasMore }
    },

    async findMessage(projectId, sessionId, messageId) {
      const row = await db
        .select()
        .from(sessionMessages)
        .where(
          and(
            eq(sessionMessages.id, messageId),
            eq(sessionMessages.sessionId, sessionId),
            eq(sessionMessages.projectId, projectId),
          ),
        )
        .get()
      return row ? serializeMessage(row) : null
    },

    async insertMessage(record) {
      const row = {
        id: `msg_${crypto.randomUUID().replaceAll('-', '')}`,
        organizationId: record.organizationId,
        projectId: record.projectId,
        sessionId: record.sessionId,
        type: 'prompt',
        content: record.content,
        delivery: record.delivery,
        state: record.state,
        error: null,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      }
      await db.insert(sessionMessages).values(row)
      return serializeMessage(row as SessionMessageRow)
    },

    async queryEvents(sessionId, query) {
      const rows = await db
        .select()
        .from(sessionEvents)
        .where(and(...eventFilters(sessionId, query)))
        .orderBy(eventOrderBy(query.order))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(serializeEvent), hasMore }
    },

    async insertEvents(scope, events) {
      for (const event of events) {
        const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
          { type: event.type, ...event.payload },
          event.metadata,
        )
        await insertCanonicalSessionEvent(db, scope, canonicalEvent)
      }
      return events.length
    },

    async listApprovals(projectId, sessionId) {
      const rows = await db
        .select()
        .from(sessionApprovals)
        .where(and(eq(sessionApprovals.sessionId, sessionId), eq(sessionApprovals.projectId, projectId)))
        .orderBy(desc(sessionApprovals.createdAt), desc(sessionApprovals.id))
      return rows.map(serializeApproval)
    },

    async findApproval(projectId, sessionId, approvalId) {
      const row = await db
        .select()
        .from(sessionApprovals)
        .where(
          and(
            eq(sessionApprovals.id, approvalId),
            eq(sessionApprovals.sessionId, sessionId),
            eq(sessionApprovals.projectId, projectId),
          ),
        )
        .get()
      return row ? serializeApproval(row) : null
    },

    async activeSessionLeaseForRunner(projectId, sessionId, runner) {
      const identityFilters = [
        runner.runnerId ? eq(runners.id, runner.runnerId) : undefined,
        eq(runners.oidcSubject, runner.subject),
      ].filter((filter) => filter !== undefined)
      const candidateRunners = await db
        .select({ id: runners.id })
        .from(runners)
        .where(and(eq(runners.projectId, projectId), or(...identityFilters)))
      const candidateIds = candidateRunners.map((row) => row.id)
      if (candidateIds.length === 0) {
        return null
      }
      const rows = await db
        .select({
          leaseId: leases.id,
          leaseRunnerId: leases.runnerId,
          expiresAt: leases.expiresAt,
          workItemId: workItems.id,
          workItemState: workItems.state,
          workItemLeaseId: workItems.leaseId,
          workItemRunnerId: workItems.runnerId,
          payload: workItems.payload,
        })
        .from(leases)
        .innerJoin(workItems, eq(leases.workItemId, workItems.id))
        .where(
          and(
            eq(leases.projectId, projectId),
            eq(leases.state, 'active'),
            inArray(leases.runnerId, candidateIds),
            eq(workItems.sessionId, sessionId),
          ),
        )
      const timestamp = new Date().toISOString()
      const owned = rows.find(
        (row) =>
          row.expiresAt > timestamp &&
          row.workItemState === 'leased' &&
          row.workItemLeaseId === row.leaseId &&
          row.workItemRunnerId === row.leaseRunnerId,
      )
      if (!owned) {
        return null
      }
      const payload = parseJson<Record<string, unknown>>(owned.payload) ?? {}
      return {
        runnerId: owned.leaseRunnerId,
        leaseId: owned.leaseId,
        workItemId: owned.workItemId,
        ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
        ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
        ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
      }
    },
  }
}

// Re-exported for the http layer's SSE/CSV event filter cap parity.
export const SESSION_EVENT_TYPES = AMA_SESSION_EVENT_TYPES
export type { AmaSessionEventType }
