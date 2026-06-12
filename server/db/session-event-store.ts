import { and, desc, eq, inArray, max } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { type CanonicalAmaSessionEvent, canonicalEventCorrelation } from '../../shared/session-events'
import { redactSensitiveValue } from '../redaction'
import { sessionEvents } from './schema'

type Db = ReturnType<typeof drizzle>

export interface SessionEventScope {
  organizationId: string
  projectId: string
  sessionId: string
}

function newEventId() {
  return `event_${crypto.randomUUID().replaceAll('-', '')}`
}

// Lifecycle boundaries are tree roots; everything else nests under the
// enclosing turn so consumers can reconstruct turn → message/tool trees.
const TURN_BOUNDARY_TYPES = ['turn_start', 'turn_end'] as const

async function enclosingTurnEventId(db: Db, sessionId: string, type: CanonicalAmaSessionEvent['type']) {
  if (type === 'turn_start' || type === 'turn_end' || type.startsWith('session_') || type.startsWith('agent_')) {
    return null
  }
  const boundary = await db
    .select({ id: sessionEvents.id, type: sessionEvents.type })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), inArray(sessionEvents.type, [...TURN_BOUNDARY_TYPES])))
    .orderBy(desc(sessionEvents.sequence))
    .limit(1)
    .get()
  return boundary?.type === 'turn_start' ? boundary.id : null
}

const MESSAGE_EVENT_TYPES = ['message_start', 'message_update', 'message_end'] as const

// Pi-loop transcript events carry no message id, so the store threads the
// correlation statefully: message_start opens a correlation anchored on its
// own event id, later message events inherit it, and message_end closes it.
async function transcriptCorrelation(
  db: Db,
  sessionId: string,
  type: CanonicalAmaSessionEvent['type'],
  eventId: string,
) {
  if (type === 'message_start') {
    return `message:${eventId}`
  }
  const latest = await db
    .select({ type: sessionEvents.type, correlationId: sessionEvents.correlationId })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), inArray(sessionEvents.type, [...MESSAGE_EVENT_TYPES])))
    .orderBy(desc(sessionEvents.sequence))
    .limit(1)
    .get()
  if (latest && latest.type !== 'message_end' && latest.correlationId) {
    return latest.correlationId
  }
  return `message:${eventId}`
}

// Single insert path for canonical session events: allocates the next
// sequence (retrying on unique collisions), fills correlation/parent
// identifiers, and redacts payload/metadata before anything reaches D1.
export async function insertCanonicalSessionEvent(
  db: Db,
  scope: SessionEventScope,
  canonicalEvent: CanonicalAmaSessionEvent,
): Promise<string> {
  const parentEventId = await enclosingTurnEventId(db, scope.sessionId, canonicalEvent.type)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const eventId = newEventId()
    const explicitCorrelation = canonicalEventCorrelation(canonicalEvent.type, canonicalEvent.payload)
    const correlationId =
      explicitCorrelation ??
      (MESSAGE_EVENT_TYPES.includes(canonicalEvent.type as (typeof MESSAGE_EVENT_TYPES)[number])
        ? await transcriptCorrelation(db, scope.sessionId, canonicalEvent.type, eventId)
        : null)
    const latest = await db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, scope.sessionId))
      .get()
    try {
      await db.insert(sessionEvents).values({
        id: eventId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        sessionId: scope.sessionId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: canonicalEvent.type,
        visibility: canonicalEvent.visibility,
        role: canonicalEvent.role,
        parentEventId,
        correlationId,
        payload: JSON.stringify(redactSensitiveValue(canonicalEvent.payload)),
        metadata: JSON.stringify(redactSensitiveValue(canonicalEvent.metadata)),
        createdAt: new Date().toISOString(),
      })
      return eventId
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
  throw new Error('Unable to append canonical session event')
}
