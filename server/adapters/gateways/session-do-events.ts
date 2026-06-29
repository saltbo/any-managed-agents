// Worker-side transport to the Session DO's in-object event store. The DO owns
// the rows and browser fan-out; this gateway is the typed call surface the
// routing store uses for session events.

import type { SessionEvent } from '@server/domain/session'
import type { SessionEventPage, SessionEventQuery } from '@server/usecases/ports'
import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import type { Env } from '../../env'

export interface SessionEventScope {
  organizationId: string
  projectId: string
  sessionId: string
}

export interface SessionEventOverrides {
  parentEventId?: string | null
  correlationId?: string | null
}

async function callSessionObject<T>(env: Env, doName: string, path: string, body: unknown): Promise<T> {
  const stub = env.SESSION.get(env.SESSION.idFromName(doName))
  const response = await stub.fetch(`https://session-object${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Session DO ${path} failed with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export interface SessionDoEventStore {
  append(
    scope: SessionEventScope,
    canonicalEvent: CanonicalAmaSessionEvent,
    overrides?: SessionEventOverrides,
  ): Promise<{ id: string; sequence: number; record: SessionEvent }>
  query(sessionId: string, query: SessionEventQuery): Promise<SessionEventPage>
  relayQuery(sessionId: string, query: SessionEventQuery): Promise<SessionEventPage & { runnerUnavailable?: boolean }>
  stream(sessionId: string): Promise<{ type: string; payload: string }[]>
  count(sessionId: string): Promise<number>
  archive(scope: SessionEventScope): Promise<void>
}

export function createSessionDoEventStore(env: Env): SessionDoEventStore {
  return {
    async append(scope, canonicalEvent, overrides) {
      return await callSessionObject(env, scope.sessionId, '/events/append', { scope, canonicalEvent, overrides })
    },
    async query(sessionId, query) {
      return await callSessionObject<SessionEventPage>(env, sessionId, '/events/query', { sessionId, query })
    },
    async relayQuery(sessionId, query) {
      return await callSessionObject<SessionEventPage & { runnerUnavailable?: boolean }>(
        env,
        sessionId,
        '/events/query',
        { sessionId, query },
      )
    },
    async stream(sessionId) {
      const { events } = await callSessionObject<{ events: { type: string; payload: string }[] }>(
        env,
        sessionId,
        '/events/stream',
        { sessionId },
      )
      return events
    },
    async count(sessionId) {
      const { count } = await callSessionObject<{ count: number }>(env, sessionId, '/events/count', { sessionId })
      return count
    },
    async archive(scope) {
      await callSessionObject(env, scope.sessionId, '/events/archive', { scope })
    },
  }
}
