// Per-session event store and browser socket hub. Cloud-loop events and relayed
// runner events are written into this DO's SQLite store, then fanned out to the
// browser sockets watching the same session.

import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import type { Env } from '../env'
import type { SessionEventQuery } from '../usecases/ports'
import {
  appendCanonicalEventToSql,
  appendRelayedEventToSql,
  countSessionEvents,
  ensureSessionEventSchema,
  exportSessionEventsJsonl,
  newRelayThreadState,
  queryEventsFromSql,
  type RelayedRunnerEvent,
  type RelayThreadState,
  type SessionEventScope,
  streamSessionEvents,
} from './session-event-store-sql'

type AppendBody = {
  scope: SessionEventScope
  canonicalEvent: CanonicalAmaSessionEvent
  overrides?: { parentEventId?: string | null; correlationId?: string | null }
}

type RelayAppendBody = {
  scope: SessionEventScope
  raw: RelayedRunnerEvent
}

export class SessionObject implements DurableObject {
  private eventSchemaReady = false
  private readonly relayThreads = new Map<string, RelayThreadState>()

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/browser') {
      return this.connectBrowser(request, url)
    }
    if (url.pathname.startsWith('/events/') && request.method === 'POST') {
      return this.handleEvents(url.pathname, await request.json())
    }
    return new Response('Not found', { status: 404 })
  }

  // The cloud event store routes. Appends are serialised by the DO single-thread,
  // so the in-DO sequence is allocated race-free. The worker-side gateway owns
  // usage accounting; this DO owns the rows (and, once wired, browser fan-out).
  private handleEvents(pathname: string, body: unknown): Response | Promise<Response> {
    const sql = this.eventSql()
    if (pathname === '/events/append') {
      const { scope, canonicalEvent, overrides } = body as AppendBody
      const appended = appendCanonicalEventToSql(sql, scope, canonicalEvent, overrides)
      // Fan the freshly-appended event out to every connected browser socket so
      // live chat updates without polling. Backfill (history) is served on request.
      this.fanOutToBrowsers({ type: 'event', event: appended.record }, scope.sessionId)
      return Response.json(appended)
    }
    if (pathname === '/events/relay-append') {
      const { scope, raw } = body as RelayAppendBody
      let thread = this.relayThreads.get(scope.sessionId)
      if (!thread) {
        thread = newRelayThreadState()
        this.relayThreads.set(scope.sessionId, thread)
      }
      const record = appendRelayedEventToSql(sql, scope, raw, thread)
      if (record) {
        this.fanOutToBrowsers({ type: 'event', event: record }, scope.sessionId)
      }
      return Response.json({ ok: true, record })
    }
    if (pathname === '/events/query') {
      const { sessionId, query } = body as { sessionId: string; query: SessionEventQuery }
      return Response.json(queryEventsFromSql(sql, sessionId, query))
    }
    if (pathname === '/events/count') {
      const { sessionId } = body as { sessionId: string }
      return Response.json({ count: countSessionEvents(sql, sessionId) })
    }
    if (pathname === '/events/stream') {
      const { sessionId } = body as { sessionId: string }
      return Response.json({ events: streamSessionEvents(sql, sessionId) })
    }
    if (pathname === '/events/archive') {
      return this.archiveEvents(sql, body as { scope: SessionEventScope })
    }
    return new Response('Not found', { status: 404 })
  }

  private async archiveEvents(sql: SqlStorage, body: { scope: SessionEventScope }): Promise<Response> {
    const jsonl = exportSessionEventsJsonl(sql, body.scope.sessionId)
    const key = `sessions/${body.scope.sessionId}/events.jsonl`
    await this.env.SESSION_EVENTS.put(key, jsonl, {
      customMetadata: { organizationId: body.scope.organizationId, projectId: body.scope.projectId },
    })
    return Response.json({ archived: true, key, bytes: jsonl.length })
  }

  private eventSql(): SqlStorage {
    const sql = this.durableState.storage.sql
    if (!this.eventSchemaReady) {
      ensureSessionEventSchema(sql)
      this.eventSchemaReady = true
    }
    return sql
  }

  // ── browser transport ───────────────────────────────────────────────────────
  // One hibernatable WebSocket per browser tab. The HTTP layer authorises that the
  // connecting user owns the session before upgrading, so the DO trusts the
  // upgrade and stores the scope on the socket (surviving hibernation). The socket
  // carries live events (server→browser, fanned out on append), a backfill replay
  // on request, and — over the same socket — inbound prompt/abort/steer/approval
  // (REST POST /messages stays a fallback).
  private connectBrowser(request: Request, url: URL): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const scope = browserScopeFromUrl(url)
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.durableState.acceptWebSocket(server, ['browser'])
    server.serializeAttachment(scope)
    // Push history immediately on connect so the chat renders from the socket alone
    // — events never travel over HTTP. Live events follow via fanOutToBrowsers.
    this.durableState.waitUntil(this.sendBackfill(server, scope.sessionId, { order: 'asc', limit: 200 }))
    return new Response(null, { status: 101, webSocket: client })
  }

  // Fan a frame to every browser socket watching `sessionId`.
  private fanOutToBrowsers(frame: Record<string, unknown>, sessionId: string): void {
    const payload = JSON.stringify(frame)
    for (const ws of this.durableState.getWebSockets('browser')) {
      const scope = ws.deserializeAttachment() as BrowserScope | null
      if (scope?.sessionId !== sessionId) {
        continue
      }
      try {
        ws.send(payload)
      } catch {
        // A socket that errors on send is closing; hibernation reaps it.
      }
    }
  }

  // Hibernation message handler for browser sockets.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const scope = ws.deserializeAttachment() as BrowserScope | null
    if (!scope) {
      return
    }
    let frame: Record<string, unknown>
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object') {
        return
      }
      frame = parsed as Record<string, unknown>
    } catch {
      return
    }
    if (frame.type === 'backfill') {
      this.durableState.waitUntil(this.sendBackfill(ws, scope.sessionId, frame))
    }
    // prompt/abort/steer/approval route through the session usecases; handled in
    // browser-write wiring.
  }

  // Hibernation close handler. Hibernation reaps the socket; nothing to clean up.
  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  private async sendBackfill(ws: WebSocket, sessionId: string, frame: Record<string, unknown>): Promise<void> {
    const query: SessionEventQuery = {
      order: 'asc',
      limit: typeof frame.limit === 'number' ? frame.limit : 200,
      ...(typeof frame.cursor === 'number' ? { cursor: frame.cursor } : {}),
      ...(typeof frame.eventType === 'string' ? { type: frame.eventType } : {}),
      visibility: typeof frame.visibility === 'string' ? frame.visibility : 'runtime',
    }
    const page = queryEventsFromSql(this.eventSql(), sessionId, query)
    if (ws.readyState !== WebSocket.OPEN) return
    const last = page.rows.at(-1)
    ws.send(
      JSON.stringify({
        type: 'backfill',
        requestId: typeof frame.requestId === 'string' ? frame.requestId : null,
        events: page.rows,
        nextCursor: page.hasMore && last ? last.sequence : null,
        hasMore: page.hasMore,
      }),
    )
  }
}

function requiredParam(url: URL, name: string) {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new Error(`Missing runner channel parameter ${name}`)
  }
  return value
}

// The owning-user scope the HTTP layer stamps onto a browser socket at upgrade
// (after it has authorised ownership). userId scopes inbound write frames.
type BrowserScope = {
  sessionId: string
  organizationId: string
  projectId: string
  userId: string
}

function browserScopeFromUrl(url: URL): BrowserScope {
  return {
    sessionId: requiredParam(url, 'sessionId'),
    organizationId: requiredParam(url, 'organizationId'),
    projectId: requiredParam(url, 'projectId'),
    userId: requiredParam(url, 'userId'),
  }
}
