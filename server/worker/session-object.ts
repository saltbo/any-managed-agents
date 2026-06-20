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

import { createDeps } from '../composition'
import type { Env } from '../env'
import {
  appendRunnerEvent,
  type ChannelState,
  deactivateRunnerChannel,
  decidePermissionRequest,
  RunnerChannelOwnershipLostError,
  validateActiveOwnership,
} from '../usecases/runtime/runner-channel-ingest'

export class SessionObject implements DurableObject {
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

function safeChannelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no longer active') ? message : 'Runner session channel failed'
}
