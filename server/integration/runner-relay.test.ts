// Integration tests for the per-runner relay end-to-end path.
//
// The runner opens GET /api/v1/runners/{runnerId}/channel (101 WebSocket),
// which the HTTP layer routes to a Session DO keyed by idFromName(runnerId).
// CLI relay sessions (claude-code/codex/copilot) store their relay traffic on
// that SAME DO instance: resolveRelayDoName resolves them to the runnerId after
// a lease has bound work_items.runner_id. The browser socket for such a session
// therefore lands on the runner's DO, not the session's own DO.
//
// Tests:
// 1. Fan-out multiplexing: runner.event sent by the runner channel fans out to
//    the browser socket watching that session and persists for later backfill.
// 2. Reconnect guard: a second runner channel open (reconnect) supersedes the
//    first. The first socket's close handler must NOT tear down the newly
//    installed socket (the DO guards teardown by socket identity). Proved by
//    sending on the second socket and confirming the browser receives the event.

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
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      runtimeConfig: {},
      packages: [],
    }),
  })
  if (res.status !== 201) throw new Error(`Environment creation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `CLI relay agent ${crypto.randomUUID()}`,
      instructions: 'Run via claude-code self-hosted.',
      skills: [],
      mcpConnectors: [],
      providerId: 'workers-ai',
    }),
  })
  if (res.status !== 201) throw new Error(`Agent creation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string }
}

async function createCliRelaySession(authorization: string, agentId: string, environmentId: string) {
  const res = await jsonFetch('/api/v1/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({ agentId, environmentId, runtime: 'claude-code' }),
  })
  if (res.status !== 201) throw new Error(`Session creation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { id: string; state: string }
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

// Claim the work item for this session, binding work_items.runner_id so that
// resolveRelayDoName returns the runnerId for the browser socket routing.
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

// Open the browser WebSocket for a session. For CLI relay sessions with a
// leased work item, the HTTP layer routes this to idFromName(runnerId) — the
// same DO as the runner channel.
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

    // Create session + claim lease to bind work_items.runner_id = runner.id.
    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    expect(session.state).toBe('pending')
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    // Open the runner channel — DO keyed by idFromName(runnerId).
    const runnerCh = await openRunnerChannel(authorization, runner.id)
    const accepted = await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')
    expect(accepted).toMatchObject({ type: 'runner.channel.accepted', runnerId: runner.id })

    // Open the browser socket for S1. resolveRelayDoName returns runnerId (CLI
    // relay runtime + leased work item), so this lands on the SAME DO instance.
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

  it('backfills runner relay history after the runner channel disconnects [spec: runners/relay-history]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    const runnerCh = await openRunnerChannel(authorization, runner.id)
    await runnerCh.waitForFrame((f) => f.type === 'runner.channel.accepted', 'runner.channel.accepted')
    runnerCh.ws.send(
      JSON.stringify({
        type: 'runner.event',
        sessionId: session.id,
        eventId: 'history-1',
        event: { type: 'message_end', payload: { role: 'assistant', text: 'persisted relay history' }, metadata: {} },
        relaySequence: 1,
        relayId: 'event_history',
        relayCreatedAt: '2026-06-20T00:00:00.000Z',
      }),
    )
    await runnerCh.waitForFrame((f) => f.type === 'runner.event.accepted' && f.eventId === 'history-1', 'event ack')
    runnerCh.ws.close()

    const browser = await openBrowserSocket(authorization, session.id)
    browser.ws.send(JSON.stringify({ type: 'backfill', requestId: 'history', order: 'asc', limit: 100 }))
    const backfill = await browser.waitForFrame((f) => f.type === 'backfill', 'history backfill')
    expect(backfill.events).toEqual([
      expect.objectContaining({
        id: 'event_history',
        sequence: 1,
        type: 'message_end',
      }),
    ])

    browser.ws.close()
  })

  it('does not clobber the active channel when the runner reconnects [spec: runners/relay-reconnect]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerRunner(authorization, environment.id)

    // Create session + claim lease so browser socket routes to runner's DO.
    const session = await createCliRelaySession(authorization, agent.id, environment.id)
    await heartbeatRunner(authorization, runner.id)
    await claimSessionLease(authorization, session.id, runner.id)

    // Open the FIRST runner channel.
    const first = await openRunnerChannel(authorization, runner.id)
    await first.waitForFrame((f) => f.type === 'runner.channel.accepted', 'first runner.channel.accepted')

    // Open a SECOND runner channel for the same runnerId (reconnect). The DO
    // supersedes the first socket: it closes the first and installs the second.
    // The first socket's 'close' handler must NOT tear down the second socket
    // (the guard checks socket identity, not runnerId).
    const second = await openRunnerChannel(authorization, runner.id)
    const secondAccepted = await second.waitForFrame(
      (f) => f.type === 'runner.channel.accepted',
      'second runner.channel.accepted',
    )
    expect(secondAccepted).toMatchObject({ type: 'runner.channel.accepted', runnerId: runner.id })

    // Open a browser socket — it routes to the runner's DO.
    const browser = await openBrowserSocket(authorization, session.id)

    // Send a runner.event on the SECOND (active) socket. If the first socket's
    // close handler had nulled out runnerScope/socket, the event would be
    // silently dropped and the browser would never receive the frame.
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
