// The canonical session-event store router. "Storage follows the loop": cloud-
// loop (ama) sessions keep their event firehose in the per-session Session DO
// (SQLite hot + R2 cold); everything else — pre-migration cloud sessions and
// self-hosted CLI sessions — stays on D1. The split is decided per session by a
// stamp the cloud-start path writes (metadata.eventStore === 'session-do'),
// cached per worker invocation so the firehose pays at most one lookup.
//
// The DO append owns redaction, sequence threading, and browser fan-out; this
// router owns the routing + the D1 usage accounting that the DO path would
// otherwise skip (the D1 insert records it inline).

import type {
  SessionEventOverrides,
  SessionEventPage,
  SessionEventQuery,
  SessionEventStore,
} from '@server/usecases/ports'
import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import { canonicalAmaSessionEventFromRuntimeEvent, SESSION_DO_EVENT_STORE } from '@shared/session-events'
import { eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { sessions } from '../../db/schema'
import { createUsageWriteRepo } from '../repos/usage-write'
import type { SessionDoEventStore } from './session-do-events'

type Db = ReturnType<typeof drizzle>

export type CloudLoopChecker = (sessionId: string) => Promise<boolean>

// Whether a session's events live in the Session DO. Reads the stamp the cloud-
// start path writes; cached so the per-event firehose does not re-query D1.
export function createCloudLoopChecker(db: Db): CloudLoopChecker {
  const cache = new Map<string, boolean>()
  return async (sessionId: string) => {
    const cached = cache.get(sessionId)
    if (cached !== undefined) {
      return cached
    }
    const row = await db.select({ metadata: sessions.metadata }).from(sessions).where(eq(sessions.id, sessionId)).get()
    const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    const inDo = metadata.eventStore === SESSION_DO_EVENT_STORE
    cache.set(sessionId, inDo)
    return inDo
  }
}

// CLI runtimes (claude-code/codex/copilot) loop on a self-hosted runner, so their
// events are relay-only — read from the runner, never stored in the cloud; `ama`
// is the cloud loop. Reads the runtime stamped in session metadata at create;
// cached like the cloud-loop checker so the per-event firehose pays one lookup.
const CLI_RELAY_RUNTIMES = new Set(['claude-code', 'codex', 'copilot'])

export function createCliRuntimeChecker(db: Db): CloudLoopChecker {
  const cache = new Map<string, boolean>()
  return async (sessionId: string) => {
    const cached = cache.get(sessionId)
    if (cached !== undefined) {
      return cached
    }
    const row = await db.select({ metadata: sessions.metadata }).from(sessions).where(eq(sessions.id, sessionId)).get()
    const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    const relay = typeof metadata.runtime === 'string' && CLI_RELAY_RUNTIMES.has(metadata.runtime)
    cache.set(sessionId, relay)
    return relay
  }
}

// The D1 delegates the router falls back to for non-DO sessions: the existing
// repo methods, passed in by the composition root (no new D1 query/append code).
export interface SessionEventD1Delegates {
  append(
    scope: { organizationId: string; projectId: string; sessionId: string },
    canonicalEvent: CanonicalAmaSessionEvent,
    overrides?: SessionEventOverrides,
  ): Promise<string>
  queryEvents(sessionId: string, query: SessionEventQuery): Promise<SessionEventPage>
  eventStream(sessionId: string): Promise<{ type: string; payload: string }[]>
}

export function createSessionEventStore(
  db: Db,
  isCloudLoop: CloudLoopChecker,
  isRunnerRelay: CloudLoopChecker,
  doStore: SessionDoEventStore,
  d1: SessionEventD1Delegates,
): SessionEventStore {
  const usage = createUsageWriteRepo(db)

  const appendCanonicalEvent: SessionEventStore['appendCanonicalEvent'] = async (scope, canonicalEvent, overrides) => {
    if (await isCloudLoop(scope.sessionId)) {
      const { id } = await doStore.append(scope, canonicalEvent, overrides)
      // The D1 insert records usage inline; the DO path does not, so the router
      // keeps the "every ingest path records usage exactly once" invariant.
      await usage.recordProviderSignals(scope, id, canonicalEvent)
      return id
    }
    if (await isRunnerRelay(scope.sessionId)) {
      // Relay-only: the runner store-and-serves this event; the cloud keeps no
      // copy and serves history by relaying a backfill to the live runner.
      return 'relay'
    }
    return await d1.append(scope, canonicalEvent, overrides)
  }

  return {
    appendCanonicalEvent,
    async insertEvents(scope, events) {
      for (const event of events) {
        const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
          { type: event.type, ...event.payload },
          event.metadata,
        )
        await appendCanonicalEvent(scope, canonicalEvent)
      }
      return events.length
    },
    async queryEvents(sessionId, query) {
      if (await isCloudLoop(sessionId)) {
        return await doStore.query(sessionId, query)
      }
      if (await isRunnerRelay(sessionId)) {
        const relayed = await doStore.relayQuery(sessionId, query)
        // Runner offline ⇒ fall back to D1: a pre-migration legacy CLI task still
        // reads its D1 rows; a completed relay session reads nothing (accepted).
        if (!relayed.runnerUnavailable) {
          return { rows: relayed.rows, hasMore: relayed.hasMore }
        }
      }
      return await d1.queryEvents(sessionId, query)
    },
    async eventStream(sessionId) {
      return (await isCloudLoop(sessionId)) ? await doStore.stream(sessionId) : await d1.eventStream(sessionId)
    },
    async archive(scope) {
      if (await isCloudLoop(scope.sessionId)) {
        await doStore.archive(scope)
      }
    },
  }
}
