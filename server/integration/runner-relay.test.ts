// Integration tests for the RunnerPool relay end-to-end path.
//
// The runner opens GET /api/v1/runners/{runnerId}/channel (101 WebSocket),
// which the HTTP layer routes to the RunnerPool DO keyed by environmentId.
// RunnerPool accepts runner.event frames and writes them into the per-session
// Session DO. Browser sockets always connect to the per-session Session DO.
//
// Tests:
// 1. Fan-out multiplexing: runner.event sent by the runner channel fans out to
//    the browser socket watching that session.
// 2. Reconnect guard: a second runner channel open (reconnect) supersedes the
//    first. The first socket's close handler must NOT tear down the newly
//    installed socket (the DO guards teardown by socket identity). Proved by
//    sending on the second socket and confirming the browser receives the event.
// 3. Assignment push: creating a self-hosted session while a runner is connected
//    pushes work.assigned over the RunnerPool WebSocket without runner polling.

import { SELF } from 'cloudflare:test'
import { runtimeProviderModelCapability } from '@server/domain/runtime-catalog'
import { beforeEach, describe, expect, it } from 'vitest'
import { seedPlatformProvider, setupOidcProvider, signIn } from './auth'

// claude-code is a self_hosted-only wildcard-provider/model runtime. Runners
// declare the '*' provider segment for wildcard-model runtimes.
const CLAUDE_CODE_CAPABILITY = runtimeProviderModelCapability('claude-code', '*', 'claude-opus-4-5')

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

async function createSelfHostedEnvironment(authorization: string) {
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `CLI relay workspace ${crypto.randomUUID()}`,
      type: 'self_hosted',
      networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
      packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] },
    }),
  })
  if (res.status !== 201) throw new Error(`Environment creation failed: ${res.status} ${await res.text()}`)
  const environment = (await res.json()) as { metadata: { uid: string } }
  return { id: environment.metadata.uid }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `CLI relay agent ${crypto.randomUUID()}`,
      systemPrompt: 'Run via claude-code self-hosted.',
      skills: [],
      mcpConnectors: [],
      provider: 'workers-ai',
    }),
  })
  if (res.status !== 201) throw new Error(`Agent creation failed: ${res.status} ${await res.text()}`)
  const agent = (await res.json()) as { metadata: { uid: string } }
  return { id: agent.metadata.uid }
}

async function createCliRelaySession(authorization: string, agentId: string, environmentId: string) {
  const res = await jsonFetch('/api/v1/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({ agentId, environmentId, runtime: 'claude-code', prompt: 'Run relay test' }),
  })
  if (res.status !== 201) throw new Error(`Session creation failed: ${res.status} ${await res.text()}`)
  const session = (await res.json()) as { metadata: { uid: string }; status: { phase: string } }
  return { ...session, id: session.metadata.uid, state: session.status.phase }
}

async function registerRunner(authorization: string, environmentId: string) {
  const res = await jsonFetch('/api/v1/runners', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Relay test runner ${crypto.randomUUID()}`,
      environmentId,
      capabilities: [CLAUDE_CODE_CAPABILITY],
    }),
  })
  if (res.status !== 201) throw new Error(`Runner registration failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string }
}

async function heartbeatRunner(authorization: string, runnerId: string) {
  const res = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, authorization, {
    method: 'PUT',
    body: JSON.stringify({ state: 'active', capabilities: [CLAUDE_CODE_CAPABILITY] }),
  })
  if (res.status !== 200) throw new Error(`Heartbeat failed: ${res.status} ${await res.text()}`)
}

// Claim the work item for this session so the session represents a self-hosted
// runner execution.
async function claimSessionLease(authorization: string, sessionId: string, runnerId: string) {
  const workRes = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${sessionId}`, authorization)
  if (workRes.status !== 200) throw new Error(`Work list failed: ${workRes.status}`)
  const work = (await workRes.json()) as { data: Array<{ id: string }> }
  if (work.data.length === 0) throw new Error('No available work items for session')
  const leaseRes = await jsonFetch('/api/v1/leases', authorization, {
    method: 'POST',
    body: JSON.stringify({ workItemId: work.data[0].id, runnerId }),
  })
  if (leaseRes.status !== 201) throw new Error(`Lease claim failed: ${leaseRes.status} ${await leaseRes.text()}`)
  return (await leaseRes.json()) as { id: string; workItemId: string; runnerId: string }
}

// Open the runner relay channel. Returns the accepted WebSocket and a
// waitForFrame helper, mirroring the sessions.test.ts socket helper pattern.
async function openRunnerChannel(authorization: string, runnerId: string) {
  const res = await SELF.fetch(`https://example.com/api/v1/runners/${runnerId}/channel`, {
    headers: { authorization, upgrade: 'websocket' },
  })
  if (res.status !== 101 || !res.webSocket) throw new Error(`Runner channel upgrade failed: ${res.status}`)
  const ws = res.webSocket as WebSocket
  const frames: Array<Record<string, unknown>> = []
  let onFrame: (() => void) | null = null
  ws.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
    frames.push(JSON.parse(data) as Record<string, unknown>)
    onFrame?.()
  })
  ws.accept()

  async function waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, label = 'frame') {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = frames.find(predicate)
      if (found) return found
      await new Promise<void>((resolve) => {
        onFrame = resolve
        setTimeout(resolve, 20)
      })
    }
    throw new Error(`Expected ${label} never arrived; got ${JSON.stringify(frames)}`)
  }

  return { ws, frames, waitForFrame }
}

// Open the browser WebSocket for a session. Browser sockets route to the
// per-session Session DO; RunnerPool writes relayed runner events into it.
async function openBrowserSocket(authorization: string, sessionId: string) {
  const res = await SELF.fetch(`https://example.com/api/v1/sessions/${sessionId}/socket`, {
    headers: { authorization, Upgrade: 'websocket' },
  })
  if (res.status !== 101 || !res.webSocket) throw new Error(`Browser socket upgrade failed: ${res.status}`)
  const ws = res.webSocket as WebSocket
  const frames: Array<Record<string, unknown>> = []
  let onFrame: (() => void) | null = null
  ws.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
    frames.push(JSON.parse(data) as Record<string, unknown>)
    onFrame?.()
  })
  ws.accept()

  async function waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, label = 'frame') {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = frames.find(predicate)
      if (found) return found
      await new Promise<void>((resolve) => {
        onFrame = resolve
        setTimeout(resolve, 20)
      })
    }
    throw new Error(`Expected ${label} never arrived; got ${JSON.stringify(frames)}`)
  }

  return { ws, frames, waitForFrame }
}

describe('[CF] per-runner relay end-to-end', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  it('fans a runner.event to the browser socket watching that CLI relay session [spec: runners/relay-fan-out]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    // Create session + claim lease to represent a self-hosted runner execution.
    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    expect(session.state).toBe('pending')
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    // Open the runner channel — RunnerPool is keyed by environmentId.
    const runnerCh = await openRunnerChannel(authorization, runner.id)
    const accepted = await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')
    expect(accepted).toMatchObject({ type: 'runner.channel.accepted', runnerId: runner.id })

    // Open the browser socket for S1. Browser traffic lands on the per-session
    // Session DO; RunnerPool writes relayed events into that same store.
    const browser = await openBrowserSocket(authorization, session.id)

    // Runner sends a runner.event for session S1.
    runnerCh.ws.send(
      JSON.stringify({
        type: 'runner.event',
        sessionId: session.id,
        eventId: 'e1',
        event: { type: 'message_end', payload: { role: 'assistant', text: 'hi' }, metadata: {} },
        relaySequence: 1,
        relayId: 'event_aaa',
        relayCreatedAt: '2026-06-20T00:00:00.000Z',
      }),
    )

    // Browser must receive a fanned {type:'event'} frame with the canonical event.
    const live = await browser.waitForFrame(
      (f) => f.type === 'event' && (f.event as { type: string }).type === 'message_end',
      'event:message_end',
    )
    expect((live.event as { type: string }).type).toBe('message_end')

    runnerCh.ws.close()
    browser.ws.close()
  })

  it('pushes self-hosted session work to an online runner without polling', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)
    await heartbeatRunner(authorization, runner.id)

    const runnerCh = await openRunnerChannel(authorization, runner.id)
    await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')

    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    const assigned = await runnerCh.waitForFrame((f) => f.type === 'work.assigned', 'work.assigned')
    expect(assigned).toMatchObject({
      type: 'work.assigned',
      runnerId: runner.id,
      lease: { runnerId: runner.id, state: 'active' },
      workItem: {
        sessionId: session.id,
        environmentId: environment.id,
        type: 'session.start',
        state: 'leased',
      },
    })

    const workItem = assigned.workItem as { id: string }
    const workRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    expect(workRes.status).toBe(200)
    await expect(workRes.json()).resolves.toMatchObject({
      id: workItem.id,
      sessionId: session.id,
      runnerId: runner.id,
      state: 'leased',
    })

    runnerCh.ws.close()
  })

  it('does not clobber the active channel when the runner reconnects [spec: runners/relay-reconnect]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    // Create session + claim lease so this is a self-hosted runner session.
    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    // Open the FIRST runner channel.
    const first = await openRunnerChannel(authorization, runner.id)
    await first.waitForFrame((f) => f.type === 'runner.channel.accepted', 'first runner.channel.accepted')

    // Open a SECOND runner channel for the same runnerId (reconnect). RunnerPool
    // supersedes the first socket: it closes the first and installs the second.
    // The first socket's 'close' handler must NOT tear down the second socket
    // (the guard checks socket identity, not runnerId).
    const second = await openRunnerChannel(authorization, runner.id)
    const secondAccepted = await second.waitForFrame(
      (f) => f.type === 'runner.channel.accepted',
      'second runner.channel.accepted',
    )
    expect(secondAccepted).toMatchObject({ type: 'runner.channel.accepted', runnerId: runner.id })

    // Open a browser socket — it routes to the per-session Session DO.
    const browser = await openBrowserSocket(authorization, session.id)

    // Send a runner.event on the SECOND (active) socket. If reconnect teardown
    // clobbered the new runner connection, the browser would never receive the
    // event written into its Session DO.
    second.ws.send(
      JSON.stringify({
        type: 'runner.event',
        sessionId: session.id,
        eventId: 'e2',
        event: { type: 'message_end', payload: { role: 'assistant', text: 'reconnect works' }, metadata: {} },
        relaySequence: 1,
        relayId: 'event_bbb',
        relayCreatedAt: '2026-06-20T00:00:00.000Z',
      }),
    )

    const live = await browser.waitForFrame(
      (f) => f.type === 'event' && (f.event as { type: string }).type === 'message_end',
      'event:message_end after reconnect',
    )
    expect((live.event as { type: string }).type).toBe('message_end')

    second.ws.close()
    browser.ws.close()
  })
})
