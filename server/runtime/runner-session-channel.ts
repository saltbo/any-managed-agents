import { and, eq, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import { runnerSessionChannels, runnerWorkItems, runnerWorkLeases, sessionEvents, sessions } from '../db/schema'
import type { Env } from '../env'
import { redactSensitiveValue } from '../redaction'

type ChannelState = {
  channelId: string
  sessionId: string
  workItemId: string
  leaseId: string
  runnerId: string
  organizationId: string
  projectId: string
}

export class RunnerSessionChannelObject implements DurableObject {
  private socket: WebSocket | null = null
  private state: ChannelState | null = null

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/connect') {
      return this.connectChannel(request, url)
    }
    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return this.dispatch(await request.json())
    }
    if (url.pathname === '/status') {
      return Response.json({ active: await this.isActive() })
    }
    return new Response('Not found', { status: 404 })
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
    const valid = await this.validateActiveOwnership(this.state)
    if (!valid) {
      await this.deactivateChannel(this.state, 'stale-ownership', 'stale')
    }
    return valid
  }

  private async handleMessage(state: ChannelState, data: unknown, socket: WebSocket) {
    let eventId: string | undefined
    try {
      const parsed = typeof data === 'string' ? (JSON.parse(data) as unknown) : JSON.parse(String(data))
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
      await this.appendRunnerEvent(state, {
        type,
        payload: payload as Record<string, unknown>,
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? { metadata: metadata as Record<string, unknown> }
          : {}),
      })
      if (eventId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'runner.event.accepted', eventId }))
      }
    } catch (error) {
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

  private async appendRunnerEvent(
    state: ChannelState,
    event: { type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
  ) {
    const db = drizzle(this.env.DB)
    const valid = await this.validateActiveOwnership(state)
    if (!valid) {
      await this.deactivateChannel(state, 'stale-ownership', 'stale')
      throw new Error('Runner session channel is no longer active')
    }
    const workItem = await db
      .select()
      .from(runnerWorkItems)
      .where(and(eq(runnerWorkItems.id, state.workItemId), eq(runnerWorkItems.projectId, state.projectId)))
      .get()
    if (!workItem) {
      throw new Error('Runner session channel is no longer active')
    }
    const timestamp = new Date().toISOString()
    await db
      .update(runnerSessionChannels)
      .set({ lastSeenAt: timestamp, updatedAt: timestamp })
      .where(and(eq(runnerSessionChannels.id, state.channelId), eq(runnerSessionChannels.status, 'active')))
    await appendSessionEvent(db, state, event, workItemRuntimeMetadata(workItem.payload))
  }

  private async validateActiveOwnership(state: ChannelState) {
    const db = drizzle(this.env.DB)
    const channel = await db
      .select()
      .from(runnerSessionChannels)
      .where(
        and(
          eq(runnerSessionChannels.id, state.channelId),
          eq(runnerSessionChannels.sessionId, state.sessionId),
          eq(runnerSessionChannels.workItemId, state.workItemId),
          eq(runnerSessionChannels.leaseId, state.leaseId),
          eq(runnerSessionChannels.runnerId, state.runnerId),
          eq(runnerSessionChannels.projectId, state.projectId),
          eq(runnerSessionChannels.status, 'active'),
        ),
      )
      .get()
    const lease = await db
      .select()
      .from(runnerWorkLeases)
      .where(
        and(
          eq(runnerWorkLeases.id, state.leaseId),
          eq(runnerWorkLeases.workItemId, state.workItemId),
          eq(runnerWorkLeases.runnerId, state.runnerId),
          eq(runnerWorkLeases.projectId, state.projectId),
          eq(runnerWorkLeases.status, 'active'),
        ),
      )
      .get()
    const workItem = await db
      .select()
      .from(runnerWorkItems)
      .where(and(eq(runnerWorkItems.id, state.workItemId), eq(runnerWorkItems.projectId, state.projectId)))
      .get()
    const session = await db
      .select({ status: sessions.status, statusReason: sessions.statusReason })
      .from(sessions)
      .where(and(eq(sessions.id, state.sessionId), eq(sessions.projectId, state.projectId)))
      .get()
    if (
      !channel ||
      !lease ||
      !workItem ||
      lease.expiresAt <= new Date().toISOString() ||
      workItem.status !== 'leased' ||
      workItem.leaseId !== state.leaseId ||
      workItem.runnerId !== state.runnerId ||
      workItem.sessionId !== state.sessionId ||
      session?.status !== 'running' ||
      session.statusReason !== null
    ) {
      return false
    }
    return true
  }

  private async closeChannel(state: ChannelState, reason: string) {
    await this.deactivateChannel(state, reason, 'closed')
  }

  private async deactivateChannel(state: ChannelState, reason: string, status: 'closed' | 'stale') {
    if (this.state?.channelId !== state.channelId) {
      return
    }
    const socket = this.socket
    this.socket = null
    this.state = null
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(status === 'stale' ? 4001 : 1000, reason)
    }
    const db = drizzle(this.env.DB)
    const timestamp = new Date().toISOString()
    await db
      .update(runnerSessionChannels)
      .set({ status, closedAt: timestamp, closeReason: reason, updatedAt: timestamp })
      .where(and(eq(runnerSessionChannels.id, state.channelId), eq(runnerSessionChannels.status, 'active')))
    const session = await db
      .select({ status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, state.sessionId), eq(sessions.projectId, state.projectId)))
      .get()
    if (session?.status !== 'running') {
      return
    }
    await db
      .update(sessions)
      .set({ status: 'pending', statusReason: 'waiting-for-runner-recovery', updatedAt: timestamp })
      .where(and(eq(sessions.id, state.sessionId), eq(sessions.projectId, state.projectId)))
    await appendSessionEvent(
      db,
      state,
      { type: 'runner.channel.closed', payload: { reason }, metadata: { source: 'self-hosted-runner-channel' } },
      {},
    )
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

function parseJson<T>(value: string | null) {
  return value ? (redactSensitiveValue(JSON.parse(value)) as T) : null
}

function workItemRuntimeMetadata(payloadValue: string) {
  const payload = parseJson<Record<string, unknown>>(payloadValue) ?? {}
  return {
    ...(typeof payload.runtime === 'string' ? { runtime: payload.runtime } : {}),
    ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
  }
}

async function appendSessionEvent(
  db: ReturnType<typeof drizzle>,
  state: ChannelState,
  event: { type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
  runtimeMetadata: Record<string, unknown>,
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    { type: event.type, ...event.payload },
    {
      source: 'self-hosted-runner',
      ...(event.metadata ?? {}),
      ...runtimeMetadata,
      channelId: state.channelId,
      runnerId: state.runnerId,
      leaseId: state.leaseId,
      workItemId: state.workItemId,
    },
  )
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const latest = await db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, state.sessionId))
      .get()
    try {
      await db.insert(sessionEvents).values({
        id: `event_${crypto.randomUUID().replaceAll('-', '')}`,
        organizationId: state.organizationId,
        projectId: state.projectId,
        sessionId: state.sessionId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: canonicalEvent.type,
        visibility: canonicalEvent.visibility,
        role: canonicalEvent.role,
        parentEventId: null,
        correlationId: null,
        payload: JSON.stringify(redactSensitiveValue(canonicalEvent.payload)),
        metadata: JSON.stringify(redactSensitiveValue(canonicalEvent.metadata)),
        createdAt: new Date().toISOString(),
      })
      return
    } catch (error) {
      if (attempt === 4 || !String(error).includes('UNIQUE')) {
        throw error
      }
    }
  }
}

function safeChannelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no longer active') ? message : 'Runner session channel failed'
}
