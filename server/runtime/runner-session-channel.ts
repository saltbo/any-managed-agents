import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import {
  createRuntimeOrchestrationRepoFromBinding,
  type RuntimeOrchestrationRepo,
} from '../adapters/repos/runtime-orchestration'
import type { Env } from '../env'
import { evaluateSandboxRuntimePolicy } from '../policy'
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
      if (type === 'permission.request') {
        await this.decidePermissionRequest(state, payload as Record<string, unknown>, socket)
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

  // An official-runtime permission request is decided by AMA session policy
  // before the action runs: the decision is recorded as a canonical policy
  // event and sent back to the owning runner over the same channel.
  private async decidePermissionRequest(state: ChannelState, payload: Record<string, unknown>, socket: WebSocket) {
    const repo = createRuntimeOrchestrationRepoFromBinding(this.env.DB)
    const auth = channelSystemAuth(state)
    const session = await repo.channelSession(state.projectId, state.sessionId)
    if (!session) {
      return
    }
    const permissionId = typeof payload.permissionId === 'string' ? payload.permissionId : 'permission'
    const command = typeof payload.command === 'string' ? payload.command : null
    const decision = await evaluateSandboxRuntimePolicy(repo.db, auth, {
      session: {
        id: session.id,
        agentSnapshot: session.agentSnapshot,
        environmentSnapshot: session.environmentSnapshot,
      },
      operation: 'command',
      command,
    })
    await this.appendRunnerEvent(state, {
      type: 'policy.decision',
      payload: {
        allowed: decision.allowed,
        category: decision.category ?? 'sandbox',
        ruleId: decision.rule,
        resourceType: 'runtime_permission',
        resourceId: typeof payload.action === 'string' ? payload.action : 'action',
        operation: 'runtime_permission_decision',
        decision: {
          permissionId,
          allowed: decision.allowed,
          ...(decision.message ? { reason: decision.message } : {}),
        },
      },
      metadata: { source: 'policy' },
    })
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'session.command',
          sessionId: state.sessionId,
          runnerId: state.runnerId,
          leaseId: state.leaseId,
          workItemId: state.workItemId,
          command: {
            type: 'permission_decision',
            permissionId,
            allowed: decision.allowed,
            reason: decision.message ?? '',
          },
        }),
      )
    }
  }

  private async appendRunnerEvent(
    state: ChannelState,
    event: { type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
  ) {
    const repo = createRuntimeOrchestrationRepoFromBinding(this.env.DB)
    const valid = await this.validateActiveOwnership(state)
    if (!valid) {
      await this.deactivateChannel(state, 'stale-ownership', 'stale')
      throw new Error('Runner session channel is no longer active')
    }
    const workItem = await repo.channelWorkItem(state.projectId, state.workItemId)
    if (!workItem) {
      throw new Error('Runner session channel is no longer active')
    }
    const timestamp = new Date().toISOString()
    await repo.touchChannel(state.channelId, timestamp)
    await appendSessionEvent(repo, state, event, workItemRuntimeMetadata(workItem.payload))
  }

  private async validateActiveOwnership(state: ChannelState) {
    const repo = createRuntimeOrchestrationRepoFromBinding(this.env.DB)
    const channel = await repo.channelActiveChannel(state)
    const lease = await repo.channelActiveLease(state)
    const workItem = await repo.channelWorkItem(state.projectId, state.workItemId)
    const session = await repo.channelSessionState(state.projectId, state.sessionId)
    if (
      !channel ||
      !lease ||
      !workItem ||
      lease.expiresAt <= new Date().toISOString() ||
      workItem.state !== 'leased' ||
      workItem.leaseId !== state.leaseId ||
      workItem.runnerId !== state.runnerId ||
      workItem.sessionId !== state.sessionId ||
      session?.state !== 'running' ||
      session.stateReason !== null
    ) {
      return false
    }
    return true
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
    const repo = createRuntimeOrchestrationRepoFromBinding(this.env.DB)
    const timestamp = new Date().toISOString()
    await repo.closeChannel(state.channelId, channelState, reason, timestamp)
    const session = await repo.channelSessionState(state.projectId, state.sessionId)
    if (session?.state !== 'running') {
      return
    }
    await repo.requeueSessionForRunnerRecovery(state.projectId, state.sessionId, timestamp)
    await appendSessionEvent(
      repo,
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

// The self-hosted runner is untrusted: scrub secret-shaped values out of the
// runner-emitted payload (and metadata) before they reach the canonical event
// store, matching how other inputs in this file are redacted.
export function buildRedactedRunnerCanonicalEvent(
  state: Pick<ChannelState, 'channelId' | 'runnerId' | 'leaseId' | 'workItemId'>,
  event: { type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
  runtimeMetadata: Record<string, unknown>,
) {
  const payload = redactSensitiveValue(event.payload) as Record<string, unknown>
  const metadata = event.metadata ? (redactSensitiveValue(event.metadata) as Record<string, unknown>) : undefined
  return canonicalAmaSessionEventFromRuntimeEvent(
    { type: event.type, ...payload },
    {
      source: 'self-hosted-runner',
      ...(metadata ?? {}),
      ...runtimeMetadata,
      channelId: state.channelId,
      runnerId: state.runnerId,
      leaseId: state.leaseId,
      workItemId: state.workItemId,
    },
  )
}

async function appendSessionEvent(
  repo: RuntimeOrchestrationRepo,
  state: ChannelState,
  event: { type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
  runtimeMetadata: Record<string, unknown>,
) {
  const canonicalEvent = buildRedactedRunnerCanonicalEvent(state, event, runtimeMetadata)
  await repo.appendCanonicalEvent(
    {
      organizationId: state.organizationId,
      projectId: state.projectId,
      sessionId: state.sessionId,
    },
    canonicalEvent,
  )
}

// Channel-scoped system identity for policy evaluation and event audit on
// runner-ingested permission requests.
function channelSystemAuth(state: ChannelState) {
  return {
    user: { id: 'system:runner-channel', email: '', name: 'AMA runner channel', avatarUrl: null },
    organization: { id: state.organizationId, name: state.organizationId },
    project: { id: state.projectId, name: state.projectId },
    roles: ['system'],
    permissions: ['*'],
    oidc: {
      subject: 'system:runner-channel',
      clientId: null,
      scope: null,
      issuer: null,
      externalTenantId: null,
      runnerId: state.runnerId,
      runnerProjectId: state.projectId,
      runnerEnvironmentId: null,
    },
  }
}

function safeChannelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no longer active') ? message : 'Runner session channel failed'
}
