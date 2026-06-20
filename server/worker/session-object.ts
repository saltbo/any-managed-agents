// The per-session Session durable object (idFromName(sessionId)). Today a thin
// socket shell for the self-hosted runner bridge: it owns only the WebSocket
// plumbing (pair/accept/supersede/close), the in-DO socket + state fields, the
// /connect|/dispatch|/status fetch protocol with URL parsing, and the
// send/close-code mechanics. Every control-plane decision (ownership validation,
// redact-and-append of runner events, the permission-request policy decision,
// and the close/requeue recovery) is delegated to the deps-first
// runner-channel-ingest usecase, reached through createDeps(this.env) — the DO is
// an entry/composition point, like main(). Subsequent work extends it with the
// in-DO cloud event store (ama runtime), the browser WebSocket hub, and R2
// archival, per docs/designs/session-event-storage-and-self-hosted-relay.md.

import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import { createDeps } from '../composition'
import type { Env } from '../env'
import type { SessionEventQuery } from '../usecases/ports'
import {
  appendRunnerEvent,
  type ChannelState,
  deactivateRunnerChannel,
  decidePermissionRequest,
  RunnerChannelOwnershipLostError,
  validateActiveOwnership,
} from '../usecases/runtime/runner-channel-ingest'
import {
  appendCanonicalEventToSql,
  countSessionEvents,
  ensureSessionEventSchema,
  exportSessionEventsJsonl,
  queryEventsFromSql,
  type SessionEventScope,
  streamSessionEvents,
} from './session-event-store-sql'

type AppendBody = {
  scope: SessionEventScope
  canonicalEvent: CanonicalAmaSessionEvent
  overrides?: { parentEventId?: string | null; correlationId?: string | null }
}

export class SessionObject implements DurableObject {
  private socket: WebSocket | null = null
  private state: ChannelState | null = null
  private eventSchemaReady = false

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/connect') {
      return this.connectChannel(request, url)
    }
    if (url.pathname === '/browser') {
      return this.connectBrowser(request, url)
    }
    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return this.dispatch(await request.json())
    }
    if (url.pathname === '/status') {
      return Response.json({ active: await this.isActive() })
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
      this.fanOutToBrowsers({ type: 'event', event: appended.record })
      return Response.json(appended)
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
    return new Response(null, { status: 101, webSocket: client })
  }

  private fanOutToBrowsers(frame: Record<string, unknown>): void {
    const payload = JSON.stringify(frame)
    for (const ws of this.durableState.getWebSockets('browser')) {
      try {
        ws.send(payload)
      } catch {
        // A socket that errors on send is closing; hibernation reaps it.
      }
    }
  }

  // Hibernation message handler — fires only for browser sockets (the runner
  // socket uses the standard accept() listener, never acceptWebSocket).
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
      this.sendBackfill(ws, scope.sessionId, frame)
    }
    // prompt/abort/steer/approval (the inbound write frames) route through the
    // session usecases; handled in browser-write wiring.
  }

  // Hibernation close handler. Hibernation reaps the socket; nothing to clean up.
  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  private sendBackfill(ws: WebSocket, sessionId: string, frame: Record<string, unknown>): void {
    const page = queryEventsFromSql(this.eventSql(), sessionId, {
      order: 'asc',
      limit: typeof frame.limit === 'number' ? frame.limit : 200,
      ...(typeof frame.cursor === 'number' ? { cursor: frame.cursor } : {}),
      ...(typeof frame.eventType === 'string' ? { type: frame.eventType } : {}),
      visibility: typeof frame.visibility === 'string' ? frame.visibility : 'runtime',
    })
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

  private connectChannel(request: Request, url: URL) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const next = stateFromUrl(url)
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(4000, 'Superseded runner session channel')
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()
    this.socket = server
    this.state = next
    server.send(
      JSON.stringify({ type: 'session.channel.accepted', sessionId: next.sessionId, channelId: next.channelId }),
    )
    server.addEventListener('message', (event) => {
      this.durableState.waitUntil(this.handleMessage(next, event.data, server))
    })
    server.addEventListener('close', () => {
      this.durableState.waitUntil(this.closeChannel(next, 'websocket-closed'))
    })
    return new Response(null, { status: 101, webSocket: client })
  }

  private async dispatch(command: unknown) {
    if (!(await this.isActive()) || !this.socket || !this.state || this.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ active: false }, { status: 409 })
    }
    this.socket.send(
      JSON.stringify({
        type: 'session.command',
        sessionId: this.state.sessionId,
        runnerId: this.state.runnerId,
        leaseId: this.state.leaseId,
        workItemId: this.state.workItemId,
        command,
      }),
    )
    return Response.json({ active: true }, { status: 202 })
  }

  private async isActive() {
    if (!this.socket || !this.state || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }
    const valid = await validateActiveOwnership(createDeps(this.env), this.state)
    if (!valid) {
      await this.deactivateChannel(this.state, 'stale-ownership', 'stale')
    }
    return valid
  }

  private async handleMessage(state: ChannelState, data: unknown, socket: WebSocket) {
    let eventId: string | undefined
    try {
      const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : JSON.parse(String(data))
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Runner channel message must be an object')
      }
      const record = parsed as Record<string, unknown>
      eventId = typeof record.eventId === 'string' ? record.eventId : undefined
      const eventRecord =
        record.type === 'runner.event' && record.event && typeof record.event === 'object'
          ? (record.event as Record<string, unknown>)
          : record
      const type = eventRecord.type
      const payload = eventRecord.payload
      const metadata = eventRecord.metadata
      if (typeof type !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Runner channel event is invalid')
      }
      const deps = createDeps(this.env)
      try {
        await appendRunnerEvent(deps, state, {
          type,
          payload: payload as Record<string, unknown>,
          ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? { metadata: metadata as Record<string, unknown> }
            : {}),
        })
      } catch (error) {
        // Lost ownership (the lease/work-item/channel/session no longer match)
        // deactivates the channel (4001 stale) before re-raising into the generic
        // error frame; a missing work item only surfaces in the error frame.
        if (error instanceof RunnerChannelOwnershipLostError) {
          await this.deactivateChannel(state, 'stale-ownership', 'stale')
        }
        throw error
      }
      if (eventId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'runner.event.accepted', eventId }))
      }
      if (type === 'permission.request') {
        const reply = await decidePermissionRequest(deps, state, payload as Record<string, unknown>)
        if (reply && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(reply))
        }
      }
    } catch (error) {
      // A persistence or policy failure here is funneled into the same generic
      // error frame as a malformed message; log it (with channel context) so the
      // two are distinguishable server-side. Still send the error frame.
      console.error(
        `runner session channel handleMessage failed (sessionId=${state.sessionId} channelId=${state.channelId} eventId=${eventId ?? 'none'}):`,
        error,
      )
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'session.channel.error',
            eventId,
            message: safeChannelError(error),
          }),
        )
      }
    }
  }

  private async closeChannel(state: ChannelState, reason: string) {
    await this.deactivateChannel(state, reason, 'closed')
  }

  private async deactivateChannel(state: ChannelState, reason: string, channelState: 'closed' | 'stale') {
    if (this.state?.channelId !== state.channelId) {
      return
    }
    const socket = this.socket
    this.socket = null
    this.state = null
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(channelState === 'stale' ? 4001 : 1000, reason)
    }
    await deactivateRunnerChannel(createDeps(this.env), state, reason, channelState)
  }
}

function stateFromUrl(url: URL): ChannelState {
  const state = {
    channelId: requiredParam(url, 'channelId'),
    sessionId: requiredParam(url, 'sessionId'),
    workItemId: requiredParam(url, 'workItemId'),
    leaseId: requiredParam(url, 'leaseId'),
    runnerId: requiredParam(url, 'runnerId'),
    organizationId: requiredParam(url, 'organizationId'),
    projectId: requiredParam(url, 'projectId'),
  }
  return state
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

function safeChannelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no longer active') ? message : 'Runner session channel failed'
}
