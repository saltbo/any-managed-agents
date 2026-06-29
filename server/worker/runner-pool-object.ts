import { createDeps } from '../composition'
import type { Env } from '../env'
import { claimLease, materializeWorkItemPayload } from '../usecases/leases'
import type { AuthScope, LeaseRecord, RunnerAuthRecord, WorkItemRecord } from '../usecases/ports'
import type { RelayedRunnerEvent, SessionEventScope } from './session-event-store-sql'

type RunnerScope = {
  runnerId: string
  organizationId: string
  projectId: string
  environmentId: string
}

type RunnerConnection = {
  scope: RunnerScope
  socket: WebSocket
  assigned: number
}

type PendingSandboxRequest = {
  runnerId: string
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RunnerPoolObject implements DurableObject {
  private readonly runners = new Map<string, RunnerConnection>()
  private readonly sessionRunners = new Map<string, string>()
  private readonly pendingSandboxRequests = new Map<string, PendingSandboxRequest>()

  constructor(
    private readonly durableState: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/runner-connect') {
      return this.connectRunner(request, url)
    }
    if (url.pathname === '/assign' && request.method === 'POST') {
      return this.assignWork(await request.json())
    }
    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return this.dispatch(await request.json())
    }
    if (url.pathname === '/request' && request.method === 'POST') {
      return this.requestRunnerSandbox(await request.json())
    }
    if (url.pathname === '/status' && request.method === 'POST') {
      return this.status(await request.json())
    }
    return new Response('Not found', { status: 404 })
  }

  private connectRunner(request: Request, url: URL) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    const scope = runnerScopeFromUrl(url)
    const previous = this.runners.get(scope.runnerId)
    if (previous?.socket.readyState === WebSocket.OPEN) {
      previous.socket.close(4000, 'Superseded runner channel')
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()
    const connection: RunnerConnection = { scope, socket: server, assigned: 0 }
    this.runners.set(scope.runnerId, connection)
    server.send(
      JSON.stringify({ type: 'runner.channel.accepted', runnerId: scope.runnerId, environmentId: scope.environmentId }),
    )
    server.addEventListener('message', (event) => {
      this.durableState.waitUntil(this.handleRunnerMessage(connection, event.data))
    })
    server.addEventListener('close', () => {
      this.closeRunner(connection)
    })
    this.durableState.waitUntil(
      (async () => {
        await this.restoreActiveSessions(scope)
        await this.dispatchAvailableWork(scope)
      })(),
    )
    return new Response(null, { status: 101, webSocket: client })
  }

  private closeRunner(connection: RunnerConnection) {
    if (this.runners.get(connection.scope.runnerId) !== connection) {
      return
    }
    this.runners.delete(connection.scope.runnerId)
    for (const [sessionId, runnerId] of this.sessionRunners) {
      if (runnerId === connection.scope.runnerId) {
        this.sessionRunners.delete(sessionId)
      }
    }
    for (const [requestId, pending] of this.pendingSandboxRequests) {
      if (pending.runnerId !== connection.scope.runnerId) {
        continue
      }
      pending.reject(new Error('runner channel closed'))
      clearTimeout(pending.timer)
      this.pendingSandboxRequests.delete(requestId)
    }
  }

  private status(body: { sessionId?: string }): Response {
    const connection = typeof body.sessionId === 'string' ? this.connectionForSession(body.sessionId) : null
    return Response.json({ active: Boolean(connection?.socket.readyState === WebSocket.OPEN) })
  }

  private async assignWork(body: unknown): Promise<Response> {
    const request = body as { organizationId?: string; projectId?: string; environmentId?: string; workItemId?: string }
    if (!request.organizationId || !request.projectId || !request.environmentId || !request.workItemId) {
      return Response.json({ ok: false, error: 'Invalid runner pool assignment request' }, { status: 400 })
    }
    const result = await this.dispatchOne(
      request.organizationId,
      request.projectId,
      request.environmentId,
      request.workItemId,
    )
    return Response.json(result, { status: result.ok ? 202 : 409 })
  }

  private async dispatchAvailableWork(scope: RunnerScope): Promise<void> {
    const deps = createDeps(this.env)
    const page = await deps.workItems.list({
      projectId: scope.projectId,
      state: 'available',
      limit: 20,
      cursor: null,
    })
    for (const workItem of page.rows) {
      if (workItem.environmentId !== scope.environmentId) {
        continue
      }
      await this.dispatchOne(scope.organizationId, scope.projectId, scope.environmentId, workItem.id)
    }
  }

  private async restoreActiveSessions(scope: RunnerScope): Promise<void> {
    const deps = createDeps(this.env)
    const page = await deps.workItems.list({
      projectId: scope.projectId,
      runnerId: scope.runnerId,
      state: 'leased',
      limit: 100,
      cursor: null,
    })
    for (const workItem of page.rows) {
      if (workItem.environmentId !== scope.environmentId || !workItem.sessionId) {
        continue
      }
      this.sessionRunners.set(workItem.sessionId, scope.runnerId)
    }
  }

  private async dispatchOne(organizationId: string, projectId: string, environmentId: string, workItemId: string) {
    const deps = createDeps(this.env)
    const candidates = [...this.runners.values()]
      .filter(
        (runner) =>
          runner.scope.organizationId === organizationId &&
          runner.scope.projectId === projectId &&
          runner.scope.environmentId === environmentId &&
          runner.socket.readyState === WebSocket.OPEN,
      )
      .sort((a, b) => a.assigned - b.assigned || a.scope.runnerId.localeCompare(b.scope.runnerId))

    for (const connection of candidates) {
      const runner = await deps.runners.find(projectId, connection.scope.runnerId)
      if (!runner || runner.environmentId !== environmentId || runner.state !== 'active') {
        continue
      }
      if (connection.assigned >= runner.maxConcurrent) {
        continue
      }
      const auth = runnerAuthScope(organizationId, projectId, runner)
      try {
        const lease = await claimLease(deps, auth, runner, {
          workItemId,
          leaseDurationSeconds: undefined,
        })
        const workItem = await deps.workItems.find(projectId, workItemId)
        if (!workItem) {
          continue
        }
        const payload = await materializeWorkItemPayload(deps, { organizationId, projectId }, workItem)
        this.sendAssignedWork(connection, lease, { ...workItem, payload })
        connection.assigned += 1
        if (workItem.sessionId) {
          this.sessionRunners.set(workItem.sessionId, connection.scope.runnerId)
        }
        return { ok: true, runnerId: connection.scope.runnerId, leaseId: lease.id }
      } catch {}
    }
    return { ok: false, error: 'No online runner has capacity for this work item' }
  }

  private sendAssignedWork(connection: RunnerConnection, lease: LeaseRecord, workItem: WorkItemRecord) {
    connection.socket.send(
      JSON.stringify({
        type: 'work.assigned',
        runnerId: connection.scope.runnerId,
        lease: serializeLease(lease),
        workItem: serializeWorkItem(workItem),
      }),
    )
  }

  private async dispatch(body: { sessionId?: string; command?: unknown }): Promise<Response> {
    if (typeof body.sessionId !== 'string') {
      return Response.json({ active: false }, { status: 409 })
    }
    const connection = this.connectionForSession(body.sessionId)
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ active: false }, { status: 409 })
    }
    connection.socket.send(
      JSON.stringify({
        type: 'session.command',
        sessionId: body.sessionId,
        runnerId: connection.scope.runnerId,
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
    if (typeof body.sessionId !== 'string' || !body.request || typeof body.request !== 'object') {
      return Response.json({ ok: false, error: 'Runner sandbox channel is unavailable' }, { status: 409 })
    }
    const connection = this.connectionForSession(body.sessionId)
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return Response.json({ ok: false, error: 'Runner sandbox channel is unavailable' }, { status: 409 })
    }
    try {
      const result = await this.sendSandboxRequest(
        connection,
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
    connection: RunnerConnection,
    sessionId: string,
    request: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const requestId = `sandbox_${crypto.randomUUID()}`
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pendingSandboxRequests.delete(requestId)
          reject(new Error('runner sandbox request timed out'))
        },
        Math.max(1, timeoutMs),
      )
      this.pendingSandboxRequests.set(requestId, { runnerId: connection.scope.runnerId, resolve, reject, timer })
      connection.socket.send(
        JSON.stringify({
          type: 'sandbox.request',
          requestId,
          sessionId,
          runnerId: connection.scope.runnerId,
          request,
        }),
      )
    })
  }

  private connectionForSession(sessionId: string): RunnerConnection | null {
    const runnerId = this.sessionRunners.get(sessionId)
    if (!runnerId) {
      return null
    }
    return this.runners.get(runnerId) ?? null
  }

  private async handleRunnerMessage(connection: RunnerConnection, data: unknown) {
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
    if (frame.type === 'sandbox.response') {
      this.resolveSandboxResponse(frame)
      return
    }
    if (frame.type === 'work.completed' || frame.type === 'work.failed' || frame.type === 'work.cancelled') {
      connection.assigned = Math.max(0, connection.assigned - 1)
      const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null
      if (sessionId) {
        this.sessionRunners.delete(sessionId)
      }
      this.durableState.waitUntil(this.dispatchAvailableWork(connection.scope))
      return
    }
    if (frame.type !== 'runner.event') {
      return
    }
    await this.handleRunnerEvent(connection.scope, frame)
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

  private async handleRunnerEvent(scope: RunnerScope, frame: Record<string, unknown>) {
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
    await appendRelayedEvent(this.env, {
      scope: { organizationId: scope.organizationId, projectId: scope.projectId, sessionId },
      raw: {
        id: typeof frame.relayId === 'string' ? frame.relayId : eventId(),
        sequence: typeof frame.relaySequence === 'number' ? frame.relaySequence : Date.now(),
        type,
        payload: payload as Record<string, unknown>,
        metadata:
          metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? { runnerId: scope.runnerId, ...(metadata as Record<string, unknown>) }
            : { runnerId: scope.runnerId },
        createdAt: typeof frame.relayCreatedAt === 'string' ? frame.relayCreatedAt : new Date().toISOString(),
      },
    })
    const eventAckId = typeof frame.eventId === 'string' ? frame.eventId : null
    const runner = this.runners.get(scope.runnerId)
    if (eventAckId && runner?.socket.readyState === WebSocket.OPEN) {
      runner.socket.send(JSON.stringify({ type: 'runner.event.accepted', eventId: eventAckId }))
    }
  }
}

function runnerAuthScope(organizationId: string, projectId: string, runner: RunnerAuthRecord): AuthScope {
  return {
    organization: { id: organizationId, name: organizationId },
    project: { id: projectId, name: projectId, organizationId },
    user: { id: `runner:${runner.id}` },
    roles: [],
    permissions: [],
  }
}

function serializeLease(lease: LeaseRecord) {
  return {
    id: lease.id,
    workItemId: lease.workItemId,
    runnerId: lease.runnerId,
    state: lease.state,
    expiresAt: lease.expiresAt,
    renewedAt: lease.renewedAt,
    resumeToken: lease.resumeToken,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  }
}

function serializeWorkItem(workItem: WorkItemRecord) {
  return {
    id: workItem.id,
    projectId: workItem.projectId,
    sessionId: workItem.sessionId,
    environmentId: workItem.environmentId,
    runnerId: workItem.runnerId,
    leaseId: workItem.leaseId,
    type: workItem.type,
    state: workItem.state,
    priority: workItem.priority,
    attempts: workItem.attempts,
    maxAttempts: workItem.maxAttempts,
    payload: workItem.payload,
    result: workItem.result,
    error: workItem.error,
    availableAt: workItem.availableAt,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  }
}

async function appendRelayedEvent(env: Env, body: { scope: SessionEventScope; raw: RelayedRunnerEvent }) {
  const stub = env.SESSION.get(env.SESSION.idFromName(body.scope.sessionId))
  await stub.fetch('https://session-object/events/relay-append', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function eventId() {
  return `event_${crypto.randomUUID().replaceAll('-', '')}`
}

function requiredParam(url: URL, name: string) {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new Error(`Missing runner pool parameter ${name}`)
  }
  return value
}

function runnerScopeFromUrl(url: URL): RunnerScope {
  return {
    runnerId: requiredParam(url, 'runnerId'),
    organizationId: requiredParam(url, 'organizationId'),
    projectId: requiredParam(url, 'projectId'),
    environmentId: requiredParam(url, 'environmentId'),
  }
}
