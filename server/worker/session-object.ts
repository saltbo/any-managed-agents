// The Session durable object. Two kinds of instance share this class: one keyed by
// runnerId hosts the per-runner relay channel (the runner connects once; browsers
// for that runner's sessions connect too; events carry their sessionId per-frame and
// the DO multiplexes — relay-only, no cloud copy), and one keyed by sessionId holds
// the cloud event store (SQLite hot + R2 archive) for cloud-loop sessions. Both fan
// live events to browser sockets and serve a backfill on request. The relay
// permission policy decision is delegated to the runner-channel-ingest usecase via
// createDeps(this.env). See docs/designs/session-event-storage-and-self-hosted-relay.md.

import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import { createDeps } from '../composition'
import type { Env } from '../env'
import type { SessionEventQuery } from '../usecases/ports'
import { decideRelayPermissionRequest } from '../usecases/runtime/runner-channel-ingest'
import {
  appendCanonicalEventToSql,
  countSessionEvents,
  ensureSessionEventSchema,
  exportSessionEventsJsonl,
  newRelayThreadState,
  queryEventsFromSql,
  queryRelayedEvents,
  type RelayedRunnerEvent,
  type RelayThreadState,
  type SessionEventScope,
  serializeRow,
  stepRelayEvent,
  streamSessionEvents,
} from './session-event-store-sql'

type AppendBody = {
  scope: SessionEventScope
  canonicalEvent: CanonicalAmaSessionEvent
  overrides?: { parentEventId?: string | null; correlationId?: string | null }
}

export class SessionObject implements DurableObject {
  // The runner relay socket on a per-runner instance (one per runner).
  private socket: WebSocket | null = null
  private eventSchemaReady = false
  // In-flight relayed backfill reads, keyed by request id: the DO sends a
  // session.backfill_request to the runner and resolves here when the matching
  // session.backfill_response arrives (or rejects on timeout / runner loss).
  private readonly pendingBackfills = new Map<
    string,
    {
      resolve: (events: RelayedRunnerEvent[]) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly pendingSandboxRequests = new Map<
    string,
    {
      resolve: (result: Record<string, unknown>) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  // The per-runner relay identity (runnerId + org/project; no single session — the
  // sessions this channel multiplexes ride per-frame). relayThreads threads the live
  // fan independently per sessionId so each session canonicalises as its own stream.
  // The contract is "runner online ⇒ available", never gated on a session's
  // lease/state, so a completed session still reads while the runner is up.
  private runnerScope: RunnerScope | null = null
  private readonly relayThreads = new Map<string, RelayThreadState>()

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/runner-connect') {
      return this.connectRunnerChannel(request, url)
    }
    if (url.pathname === '/browser') {
      return this.connectBrowser(request, url)
    }
    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return this.dispatch(await request.json())
    }
    if (url.pathname === '/request' && request.method === 'POST') {
      return this.requestRunnerSandbox(await request.json())
    }
    if (url.pathname === '/status') {
      return Response.json({ active: this.isActive() })
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
    if (pathname === '/events/query') {
      const { sessionId, query } = body as { sessionId: string; query: SessionEventQuery }
      return Response.json(queryEventsFromSql(sql, sessionId, query))
    }
    if (pathname === '/events/relay-query') {
      return this.relayQuery(body as { sessionId: string; query: SessionEventQuery })
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

  // The relay read for a CLI session: forward the page request to the live runner
  // (the only store) and canonicalise its log in memory — the cloud keeps no copy.
  // Runner offline ⇒ runnerUnavailable, so the event-store router falls back to D1.
  private async relayQuery(body: { sessionId: string; query: SessionEventQuery }): Promise<Response> {
    const scope = this.channelScope()
    if (!this.socket || !scope || this.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ rows: [], hasMore: false, runnerUnavailable: true })
    }
    try {
      const events = await this.requestRunnerBackfill(body.sessionId)
      return Response.json(queryRelayedEvents(events, { ...scope, sessionId: body.sessionId }, body.query))
    } catch {
      return Response.json({ rows: [], hasMore: false, runnerUnavailable: true })
    }
  }

  private requestRunnerBackfill(sessionId: string): Promise<RelayedRunnerEvent[]> {
    const requestId = `backfill_${crypto.randomUUID()}`
    return new Promise<RelayedRunnerEvent[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBackfills.delete(requestId)
        reject(new Error('runner backfill timed out'))
      }, 10_000)
      this.pendingBackfills.set(requestId, { resolve, reject, timer })
      this.socket?.send(
        JSON.stringify({
          type: 'session.backfill_request',
          eventId: requestId,
          sessionId,
          runnerId: this.runnerScope?.runnerId,
        }),
      )
    })
  }

  private resolveBackfill(record: Record<string, unknown>): void {
    const requestId = typeof record.eventId === 'string' ? record.eventId : null
    if (!requestId) {
      return
    }
    const pending = this.pendingBackfills.get(requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingBackfills.delete(requestId)
    pending.resolve(Array.isArray(record.events) ? (record.events as RelayedRunnerEvent[]) : [])
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

  // Fan a frame to every browser socket watching `sessionId`. The per-runner DO
  // hosts browsers for many sessions on one instance, so a live event reaches only
  // the tabs viewing that session; the per-sessionId (ama) instance has a single
  // sessionId, where the filter is a no-op.
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
      this.durableState.waitUntil(this.sendBackfill(ws, scope.sessionId, frame))
    }
    // prompt/abort/steer/approval (the inbound write frames) route through the
    // session usecases; handled in browser-write wiring.
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
    let page = queryEventsFromSql(this.eventSql(), sessionId, query)
    // Relay sessions keep no cloud copy: when the store is empty but the runner is
    // live, relay the backfill to it (the same path /events/relay-query uses) so the
    // browser gets a full history from the socket alone — never over HTTP.
    const scope = this.channelScope()
    if (page.rows.length === 0 && this.socket?.readyState === WebSocket.OPEN && scope) {
      try {
        const events = await this.requestRunnerBackfill(sessionId)
        page = queryRelayedEvents(events, { ...scope, sessionId }, query)
      } catch {
        // runner unavailable — serve the (empty) store page
      }
    }
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

  // ── per-runner relay channel ────────────────────────────────────────────────
  // The runner opens ONE persistent socket to this DO (keyed by runnerId), shared
  // across every CLI session it hosts. Unlike the per-lease channel it is bound to
  // neither a session nor a lease: events carry their sessionId per-frame and the
  // DO multiplexes — live events fan to the browsers watching that session, a
  // backfill is relayed to the runner for that session. The channel lives for the
  // runner's lifetime, so a completed session still reads while the runner is up.
  private connectRunnerChannel(request: Request, url: URL) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const next = runnerScopeFromUrl(url)
    // Supersede any prior runner socket: close it and drop its in-flight backfills,
    // whose responses can never arrive on the new socket.
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(4000, 'Superseded runner channel')
    }
    this.rejectPendingBackfills('runner channel superseded')
    this.rejectPendingSandboxRequests('runner channel superseded')
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()
    this.socket = server
    this.runnerScope = next
    this.relayThreads.clear()
    server.send(JSON.stringify({ type: 'runner.channel.accepted', runnerId: next.runnerId }))
    server.addEventListener('message', (event) => {
      this.durableState.waitUntil(this.handleRunnerMessage(next, event.data, server))
    })
    // Guard teardown by socket identity, not runnerId: a reconnect reuses the same
    // runnerId, so the superseded socket's close event must not tear down the
    // freshly-installed one.
    server.addEventListener('close', () => {
      this.closeRunnerChannel(server)
    })
    return new Response(null, { status: 101, webSocket: client })
  }

  private closeRunnerChannel(socket: WebSocket) {
    if (this.socket !== socket) {
      return
    }
    this.socket = null
    this.runnerScope = null
    this.relayThreads.clear()
    this.rejectPendingBackfills('runner channel closed')
    this.rejectPendingSandboxRequests('runner channel closed')
  }

  private rejectPendingBackfills(reason: string): void {
    for (const pending of this.pendingBackfills.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingBackfills.clear()
  }

  private rejectPendingSandboxRequests(reason: string): void {
    for (const pending of this.pendingSandboxRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingSandboxRequests.clear()
  }

  // The per-runner runner socket reader. Relay-only: no cloud append, no per-lease
  // ownership gate (the contract is "runner online ⇒ available"). Each runner.event
  // carries its sessionId; the live fan is threaded per session and reaches only the
  // browsers watching it, identically to the relayed backfill twin (dedup by
  // id/sequence). A live permission request is decided by session policy and the
  // command relayed back.
  private async handleRunnerMessage(scope: RunnerScope, data: unknown, socket: WebSocket) {
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : JSON.parse(String(data))
      if (!parsed || typeof parsed !== 'object') {
        return
      }
      frame = parsed as Record<string, unknown>
    } catch {
      return
    }
    if (frame.type === 'session.backfill_response') {
      this.resolveBackfill(frame)
      return
    }
    if (frame.type === 'sandbox.response') {
      this.resolveSandboxResponse(frame)
      return
    }
    if (frame.type !== 'runner.event') {
      return
    }
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null
    if (!sessionId) {
      return
    }
    const eventRecord =
      frame.event && typeof frame.event === 'object' ? (frame.event as Record<string, unknown>) : frame
    const type = eventRecord.type
    const payload = eventRecord.payload
    const metadata = eventRecord.metadata
    if (typeof type !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return
    }
    const eventId = typeof frame.eventId === 'string' ? frame.eventId : undefined
    // The runner stamps each event with its own store id/sequence/createdAt, so the
    // live fan canonicalises identically to its backfilled twin. Thread per session
    // in channel order, synchronously before any await.
    const relaySequence = frame.relaySequence
    const relayId = frame.relayId
    if (typeof relaySequence === 'number' && typeof relayId === 'string') {
      let thread = this.relayThreads.get(sessionId)
      if (!thread) {
        thread = newRelayThreadState()
        this.relayThreads.set(sessionId, thread)
      }
      const row = stepRelayEvent(
        {
          id: relayId,
          sequence: relaySequence,
          type,
          payload: payload as Record<string, unknown>,
          metadata:
            metadata && typeof metadata === 'object' && !Array.isArray(metadata)
              ? (metadata as Record<string, unknown>)
              : {},
          createdAt: typeof frame.relayCreatedAt === 'string' ? frame.relayCreatedAt : new Date().toISOString(),
        },
        { organizationId: scope.organizationId, projectId: scope.projectId, sessionId },
        thread,
      )
      this.fanOutToBrowsers({ type: 'event', event: serializeRow(row) }, sessionId)
    }
    // Ack so the runner's write-then-wait-for-ack proceeds.
    if (eventId && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'runner.event.accepted', eventId }))
    }
    if (type === 'permission.request') {
      try {
        const reply = await decideRelayPermissionRequest(
          createDeps(this.env),
          { organizationId: scope.organizationId, projectId: scope.projectId, sessionId, runnerId: scope.runnerId },
          payload as Record<string, unknown>,
        )
        if (reply && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(reply))
        }
      } catch (error) {
        console.error(`per-runner relay permission decision failed (sessionId=${sessionId}):`, error)
      }
    }
  }

  // The org/project the runner channel is scoped to.
  private channelScope(): { organizationId: string; projectId: string } | null {
    if (this.runnerScope) {
      return { organizationId: this.runnerScope.organizationId, projectId: this.runnerScope.projectId }
    }
    return null
  }

  // The command targets one session, carried in the body; the runner hub routes it to
  // that session's live runtime by sessionId. A command for a session that is no
  // longer live is dropped by the runner.
  private dispatch(body: { sessionId?: string; command?: unknown }): Response {
    if (
      !this.socket ||
      !this.runnerScope ||
      this.socket.readyState !== WebSocket.OPEN ||
      typeof body.sessionId !== 'string'
    ) {
      return Response.json({ active: false }, { status: 409 })
    }
    this.socket.send(
      JSON.stringify({
        type: 'session.command',
        sessionId: body.sessionId,
        runnerId: this.runnerScope.runnerId,
        command: body.command,
      }),
    )
    return Response.json({ active: true }, { status: 202 })
  }

  private async requestRunnerSandbox(body: {
    sessionId?: string
    request?: unknown
    timeoutMs?: number
  }): Promise<Response> {
    if (
      !this.socket ||
      !this.runnerScope ||
      this.socket.readyState !== WebSocket.OPEN ||
      typeof body.sessionId !== 'string' ||
      !body.request ||
      typeof body.request !== 'object'
    ) {
      return Response.json({ ok: false, error: 'Runner sandbox channel is unavailable' }, { status: 409 })
    }
    try {
      const result = await this.sendSandboxRequest(
        body.sessionId,
        body.request as Record<string, unknown>,
        typeof body.timeoutMs === 'number' ? body.timeoutMs : 120_000,
      )
      return Response.json({ ok: true, result })
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : 'Runner sandbox request failed' },
        { status: 502 },
      )
    }
  }

  private sendSandboxRequest(
    sessionId: string,
    request: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const requestId = `sandbox_${crypto.randomUUID()}`
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSandboxRequests.delete(requestId)
        reject(new Error('runner sandbox request timed out'))
      }, Math.max(1, timeoutMs))
      this.pendingSandboxRequests.set(requestId, { resolve, reject, timer })
      this.socket?.send(
        JSON.stringify({
          type: 'sandbox.request',
          requestId,
          sessionId,
          runnerId: this.runnerScope?.runnerId,
          request,
        }),
      )
    })
  }

  private resolveSandboxResponse(record: Record<string, unknown>): void {
    const requestId = typeof record.requestId === 'string' ? record.requestId : null
    if (!requestId) {
      return
    }
    const pending = this.pendingSandboxRequests.get(requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingSandboxRequests.delete(requestId)
    if (record.ok === false) {
      pending.reject(new Error(typeof record.error === 'string' ? record.error : 'runner sandbox request failed'))
      return
    }
    pending.resolve(
      record.result && typeof record.result === 'object' && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : {},
    )
  }

  // "runner online ⇒ available": an open runner socket is the liveness signal, never
  // gated on a session's lease/state.
  private isActive(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN)
  }
}

function requiredParam(url: URL, name: string) {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new Error(`Missing runner channel parameter ${name}`)
  }
  return value
}

// The runner-keyed identity the HTTP layer stamps on a per-runner relay channel at
// upgrade (after authorising the runner owns the connection). No sessionId — the
// sessions this channel multiplexes ride per-frame.
type RunnerScope = {
  runnerId: string
  organizationId: string
  projectId: string
}

function runnerScopeFromUrl(url: URL): RunnerScope {
  return {
    runnerId: requiredParam(url, 'runnerId'),
    organizationId: requiredParam(url, 'organizationId'),
    projectId: requiredParam(url, 'projectId'),
  }
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
