// The Session DO's in-object canonical event store, over the DO's embedded
// SQLite (ctx.storage.sql). It is the cloud-loop (ama runtime) home for the
// event firehose: the same canonical row, sequence threading, and query
// contract as the D1 store (server/db/session-event-store.ts +
// server/adapters/repos/sessions.ts), one contract / two implementations. The
// DO single-thread serialises appends, so sequence allocation is race-free
// without the D1 store's UNIQUE-collision retry loop.
//
// Pure over SqlStorage: no Env, no D1, no sockets. The DO shell owns the side
// effects (usage accounting, browser fan-out, R2 archive); this module owns the
// rows.

import { redactSensitiveValue } from '@server/redaction'
import { sessionEventVisibility, type SessionEvent } from '@server/domain/session'
import type { SessionEventPage, SessionEventQuery } from '@server/usecases/ports'
import {
  type CanonicalAmaSessionEvent,
  canonicalAmaSessionEventFromRuntimeEvent,
  canonicalEventCorrelation,
  isAmaSessionEventType,
} from '@shared/session-events'

export interface SessionEventScope {
  organizationId: string
  projectId: string
  sessionId: string
}

type EventRow = {
  id: string
  organization_id: string
  project_id: string
  session_id: string
  sequence: number
  type: string
  visibility: string
  role: string | null
  parent_event_id: string | null
  correlation_id: string | null
  payload: string
  metadata: string
  created_at: string
}

function newEventId() {
  return `event_${crypto.randomUUID().replaceAll('-', '')}`
}

// Mirrors the D1 store: lifecycle boundaries are tree roots; everything else
// nests under the enclosing open turn so consumers reconstruct turn → message/
// tool trees.
function enclosingTurnEventId(
  sql: SqlStorage,
  sessionId: string,
  type: CanonicalAmaSessionEvent['type'],
): string | null {
  if (type === 'turn_start' || type === 'turn_end' || type.startsWith('session_') || type.startsWith('agent_')) {
    return null
  }
  const boundary = sql
    .exec<{ id: string; type: string }>(
      "SELECT id, type FROM session_events WHERE session_id = ? AND type IN ('turn_start', 'turn_end') ORDER BY sequence DESC LIMIT 1",
      sessionId,
    )
    .toArray()[0]
  return boundary?.type === 'turn_start' ? boundary.id : null
}

const MESSAGE_EVENT_TYPES = ['message_start', 'message_update', 'message_end'] as const

// Pi-loop transcript events carry no message id, so the store threads the
// correlation statefully: message_start opens a correlation on its own event id,
// later message events inherit it until message_end closes it.
function transcriptCorrelation(
  sql: SqlStorage,
  sessionId: string,
  type: CanonicalAmaSessionEvent['type'],
  eventId: string,
): string {
  if (type === 'message_start') {
    return `message:${eventId}`
  }
  const latest = sql
    .exec<{ type: string; correlation_id: string | null }>(
      "SELECT type, correlation_id FROM session_events WHERE session_id = ? AND type IN ('message_start', 'message_update', 'message_end') ORDER BY sequence DESC LIMIT 1",
      sessionId,
    )
    .toArray()[0]
  if (latest && latest.type !== 'message_end' && latest.correlation_id) {
    return latest.correlation_id
  }
  return `message:${eventId}`
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  role TEXT,
  parent_event_id TEXT,
  correlation_id TEXT,
  payload TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)`

const CREATE_INDEX = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_seq ON session_events (session_id, sequence)'

export function ensureSessionEventSchema(sql: SqlStorage): void {
  sql.exec(CREATE_TABLE)
  sql.exec(CREATE_INDEX)
}

// Single insert path: allocates the next sequence (monotonic, no retry — the DO
// thread serialises us), fills correlation/parent ids, redacts payload/metadata,
// and returns the serialized record so the DO shell can fan it out to sockets.
export function appendCanonicalEventToSql(
  sql: SqlStorage,
  scope: SessionEventScope,
  canonicalEvent: CanonicalAmaSessionEvent,
  // Some producers (the MCP tool path) thread their own parent/correlation ids
  // and must not have them recomputed; when given, they win over the store's
  // turn/transcript threading.
  overrides?: { parentEventId?: string | null; correlationId?: string | null },
): { id: string; sequence: number; record: SessionEvent } {
  const eventId = newEventId()
  const parentEventId =
    overrides?.parentEventId !== undefined
      ? overrides.parentEventId
      : enclosingTurnEventId(sql, scope.sessionId, canonicalEvent.type)
  const explicitCorrelation = canonicalEventCorrelation(canonicalEvent.type, canonicalEvent.payload)
  const correlationId =
    overrides?.correlationId !== undefined
      ? overrides.correlationId
      : (explicitCorrelation ??
        (MESSAGE_EVENT_TYPES.includes(canonicalEvent.type as (typeof MESSAGE_EVENT_TYPES)[number])
          ? transcriptCorrelation(sql, scope.sessionId, canonicalEvent.type, eventId)
          : null))
  const maxSequence =
    sql
      .exec<{ m: number | null }>('SELECT max(sequence) AS m FROM session_events WHERE session_id = ?', scope.sessionId)
      .one().m ?? 0
  const sequence = maxSequence + 1
  const createdAt = new Date().toISOString()
  const payload = JSON.stringify(redactSensitiveValue(canonicalEvent.payload))
  const metadata = JSON.stringify(redactSensitiveValue(canonicalEvent.metadata))
  sql.exec(
    'INSERT INTO session_events (id, organization_id, project_id, session_id, sequence, type, visibility, role, parent_event_id, correlation_id, payload, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    eventId,
    scope.organizationId,
    scope.projectId,
    scope.sessionId,
    sequence,
    canonicalEvent.type,
    canonicalEvent.visibility,
    canonicalEvent.role,
    parentEventId,
    correlationId,
    payload,
    metadata,
    createdAt,
  )
  const record = serializeRow({
    id: eventId,
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    session_id: scope.sessionId,
    sequence,
    type: canonicalEvent.type,
    visibility: canonicalEvent.visibility,
    role: canonicalEvent.role,
    parent_event_id: parentEventId,
    correlation_id: correlationId,
    payload,
    metadata,
    created_at: createdAt,
  })
  return { id: eventId, sequence, record }
}

// Mirrors server/adapters/repos/sessions.ts eventFilters + cursor pagination:
// session implied by the shard, optional type, visibility default 'runtime',
// createdFrom/To window, sequence cursor, order, limit + 1 hasMore probe.
export function queryEventsFromSql(sql: SqlStorage, sessionId: string, query: SessionEventQuery): SessionEventPage {
  const filters = ['session_id = ?']
  const binds: (string | number)[] = [sessionId]
  if (query.cursor !== undefined) {
    filters.push(query.order === 'asc' ? 'sequence > ?' : 'sequence < ?')
    binds.push(query.cursor)
  } else if (query.order === 'asc') {
    filters.push('sequence > ?')
    binds.push(0)
  }
  if (query.type) {
    filters.push('type = ?')
    binds.push(query.type)
  }
  filters.push('visibility = ?')
  binds.push(query.visibility ?? 'runtime')
  if (query.createdFrom) {
    filters.push('created_at >= ?')
    binds.push(query.createdFrom)
  }
  if (query.createdTo) {
    filters.push('created_at <= ?')
    binds.push(query.createdTo)
  }
  const direction = query.order === 'asc' ? 'ASC' : 'DESC'
  const rows = sql
    .exec<EventRow>(
      `SELECT * FROM session_events WHERE ${filters.join(' AND ')} ORDER BY sequence ${direction} LIMIT ?`,
      ...binds,
      query.limit + 1,
    )
    .toArray()
  const hasMore = rows.length > query.limit
  return { rows: rows.slice(0, query.limit).map(serializeRow), hasMore }
}

// One event in a runner's local log, relayed verbatim from the store-and-serve
// runner over the channel — the bytes the cloud never kept a copy of.
export interface RelayedRunnerEvent {
  id: string
  sequence: number
  type: string
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
}

// The relay's second implementation of the store query: a CLI relay session's
// events live only on the runner, so the read path canonicalises the runner's
// raw log in memory (no cloud copy) — threading turn/transcript correlation the
// same way appendCanonicalEventToSql does — then applies the same filter/cursor
// /pagination as queryEventsFromSql so a relayed page is indistinguishable from
// a DO-served one.
// Per-session threading state for the relay canonicaliser: turn nesting + message
// correlation carry across events. The SAME machine drives both the full-log
// backfill (queryRelayedEvents) and the DO's live fan (stepRelayEvent), so a
// pushed event is byte-identical to its backfilled twin.
export interface RelayThreadState {
  currentTurnId: string | null
  lastMessageType: string | null
  lastMessageCorrelation: string | null
}

export function newRelayThreadState(): RelayThreadState {
  return { currentTurnId: null, lastMessageType: null, lastMessageCorrelation: null }
}

// Canonicalise + thread ONE raw runner event, advancing `state` in place.
export function stepRelayEvent(raw: RelayedRunnerEvent, scope: SessionEventScope, state: RelayThreadState): EventRow {
  const canonical = canonicalAmaSessionEventFromRuntimeEvent({ type: raw.type, ...raw.payload }, raw.metadata)
  const parentEventId = state.currentTurnId
  const isMessage = MESSAGE_EVENT_TYPES.includes(canonical.type as (typeof MESSAGE_EVENT_TYPES)[number])
  let correlationId = canonicalEventCorrelation(canonical.type, canonical.payload)
  if (correlationId === null && isMessage) {
    correlationId =
      canonical.type !== 'message_start' &&
      state.lastMessageType !== null &&
      state.lastMessageType !== 'message_end' &&
      state.lastMessageCorrelation
        ? state.lastMessageCorrelation
        : `message:${raw.id}`
  }
  if (canonical.type === 'turn_start') {
    state.currentTurnId = raw.id
  } else if (canonical.type === 'turn_end') {
    state.currentTurnId = null
  }
  if (isMessage) {
    state.lastMessageType = canonical.type
    state.lastMessageCorrelation = correlationId
  }
  return {
    id: raw.id,
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    session_id: scope.sessionId,
    sequence: raw.sequence,
    type: canonical.type,
    visibility: canonical.visibility,
    role: canonical.role,
    parent_event_id: parentEventId,
    correlation_id: correlationId,
    payload: JSON.stringify(canonical.payload),
    metadata: JSON.stringify(canonical.metadata),
    created_at: raw.createdAt,
  }
}

export function queryRelayedEvents(
  rawEvents: RelayedRunnerEvent[],
  scope: SessionEventScope,
  query: SessionEventQuery,
): SessionEventPage {
  const state = newRelayThreadState()
  const rows: EventRow[] = rawEvents.map((raw) => stepRelayEvent(raw, scope, state))

  const visibility = query.visibility ?? 'runtime'
  let filtered = rows.filter((row) => row.visibility === visibility)
  if (query.type) {
    filtered = filtered.filter((row) => row.type === query.type)
  }
  if (query.createdFrom) {
    filtered = filtered.filter((row) => row.created_at >= query.createdFrom!)
  }
  if (query.createdTo) {
    filtered = filtered.filter((row) => row.created_at <= query.createdTo!)
  }
  const cursor = query.cursor ?? (query.order === 'asc' ? 0 : undefined)
  if (cursor !== undefined) {
    filtered = filtered.filter((row) => (query.order === 'asc' ? row.sequence > cursor : row.sequence < cursor))
  }
  filtered.sort((a, b) => (query.order === 'asc' ? a.sequence - b.sequence : b.sequence - a.sequence))
  const hasMore = filtered.length > query.limit
  return { rows: filtered.slice(0, query.limit).map(serializeRow), hasMore }
}

export function countSessionEvents(sql: SqlStorage, sessionId: string): number {
  return sql.exec<{ c: number }>('SELECT count(*) AS c FROM session_events WHERE session_id = ?', sessionId).one().c
}

// The full {type, payload} stream in sequence order, every visibility — exact
// mirror of the D1 sessionEventStream used to rebuild the continuation transcript.
export function streamSessionEvents(sql: SqlStorage, sessionId: string): { type: string; payload: string }[] {
  return sql
    .exec<{ type: string; payload: string }>(
      'SELECT type, payload FROM session_events WHERE session_id = ? ORDER BY sequence ASC',
      sessionId,
    )
    .toArray()
}

// All rows as newline-delimited canonical JSON, sequence-ascending — the R2
// archive object (sessions/{sessionId}/events.jsonl).
export function exportSessionEventsJsonl(sql: SqlStorage, sessionId: string): string {
  const rows = sql
    .exec<EventRow>('SELECT * FROM session_events WHERE session_id = ? ORDER BY sequence ASC', sessionId)
    .toArray()
  return rows.map((row) => JSON.stringify(serializeRow(row))).join('\n')
}

// Row → SessionEvent. Identical output to the D1 repo's serializeEvent:
// canonicalises a non-canonical stored type, redacts payload/metadata on the way
// out, and tags the raw type into metadata for non-canonical rows.
export function serializeRow(row: EventRow): SessionEvent {
  const rawPayload = JSON.parse(row.payload) as Record<string, unknown>
  const rawMetadata = JSON.parse(row.metadata) as Record<string, unknown>
  const event = isAmaSessionEventType(row.type)
    ? { type: row.type, visibility: row.visibility, role: row.role, payload: rawPayload, metadata: rawMetadata }
    : canonicalAmaSessionEventFromRuntimeEvent(
        { ...rawPayload, type: row.type },
        { source: 'stored-session-event', ...rawMetadata },
      )
  if (!isAmaSessionEventType(row.type)) {
    event.metadata = { ...event.metadata, rawSessionEventType: row.type }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    sequence: row.sequence,
    type: event.type,
    visibility: sessionEventVisibility(event.visibility),
    role: event.role,
    parentEventId: row.parent_event_id,
    correlationId: row.correlation_id,
    payload: redactSensitiveValue(event.payload) as Record<string, unknown>,
    metadata: redactSensitiveValue(event.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}
