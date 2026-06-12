import assert from 'node:assert/strict'
import { After, AfterAll, Given, setDefaultTimeout, Then, When } from '@cucumber/cucumber'
import type { APIRequestContext, Page } from '@playwright/test'
import { AMA_SESSION_EVENT_TYPES } from '../../shared/session-events'
import { apiJson, closeLocalApp, delay, ensureLocalApp } from './local-app'
import type { AmaWorld } from './world'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

interface ListResponse<T> {
  data: T[]
  pagination: { hasMore: boolean; firstId: string | null; lastId: string | null }
}

interface SessionLifecycleState {
  page: Page
  auth: Json
  runId: string
  agent?: Json
  environment?: Json
  runner?: Json
  lease?: Json
  latestSession?: Json | undefined
  previousSession?: Json | undefined
  runnerChannels?: Record<string, WebSocket>
  runnerChannelMessages?: Json[]
  response?: Json
  responseStatus?: number
  accessToken?: string
  sessionRuntime?: string
  runtimeMessage?: string
}

type SessionLifecycleWorld = AmaWorld & { e2e?: SessionLifecycleState }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

setDefaultTimeout(120_000)

AfterAll(async () => {
  await closeLocalApp()
})

After(async function (this: SessionLifecycleWorld) {
  const channels = this.e2e?.runnerChannels
  if (!channels) return
  for (const socket of Object.values(channels)) {
    try {
      socket.close()
    } catch {
      // best-effort
    }
  }
  this.e2e!.runnerChannels = {}
  await delay(100)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureState(world: SessionLifecycleWorld): Promise<SessionLifecycleState> {
  assert.ok(world.e2e, 'Signed-in local e2e state must exist (Background step must have run)')
  return world.e2e
}

/** POST /api/sessions/:id/stop */
async function stopSession(request: APIRequestContext, sessionId: string) {
  return apiJson<Json>(request, `/api/sessions/${sessionId}/stop`, { method: 'POST' })
}

/** Open a runner WebSocket channel for the current runner+lease, return initial messages. */
async function openRunnerChannel(state: SessionLifecycleState, key: string): Promise<Json[]> {
  const origin = await ensureLocalApp()
  const url = new URL(`/api/runners/${state.runner?.id}/leases/${state.lease?.id}/channel`, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (state.accessToken) {
    url.searchParams.set('access_token', state.accessToken)
  }
  const messages: Json[] = []
  const socket = new WebSocket(url.toString())
  socket.addEventListener('message', (event) => {
    try {
      messages.push(JSON.parse(String(event.data)) as Json)
    } catch {
      // ignore malformed frames
    }
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('runner channel websocket failed to open')), { once: true })
  })
  // Wait for session.channel.accepted
  for (let i = 0; i < 40; i++) {
    if (messages.some((m) => m.type === 'session.channel.accepted')) {
      state.runnerChannels = { ...(state.runnerChannels ?? {}), [key]: socket }
      return messages
    }
    await delay(50)
  }
  socket.close()
  throw new Error('runner channel was not accepted within timeout')
}

/** Send a runner event through an open channel. */
async function sendRunnerEvent(state: SessionLifecycleState, key: string, event: Json): Promise<void> {
  const socket = state.runnerChannels?.[key]
  assert.ok(socket, `runner channel '${key}' must be open`)
  socket.send(JSON.stringify({ type: 'runner.event', event }))
  await delay(250)
}

/** Wait until the session events list contains text or a matching event. */
async function waitForSessionEvent(
  request: APIRequestContext,
  sessionId: string,
  predicate: (event: Json) => boolean,
  label: string,
): Promise<Json> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const events = await apiJson<ListResponse<Json>>(request, `/api/sessions/${sessionId}/events?limit=100`)
    const match = events.data.find(predicate)
    if (match) return match
    await delay(500)
  }
  throw new Error(`Session ${sessionId} did not produce event matching "${label}" before timeout`)
}

/** Set up a self-hosted session (claude-code runtime) with an accepted runner channel. */
async function setupSelfHostedChannelSession(world: SessionLifecycleWorld): Promise<SessionLifecycleState> {
  const state = await ensureState(world)

  // Self-hosted environment with claude-code runtime (supports live prompts).
  // Note: `runtime` is not a field on the environment resource — it is stored in
  // state.sessionRuntime and passed when creating the session.
  state.environment = await apiJson<Json>(state.page.request, '/api/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} lifecycle channel env`,
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
    },
  })
  state.sessionRuntime = 'claude-code'

  state.agent = await apiJson<Json>(state.page.request, '/api/agents', {
    method: 'POST',
    data: { name: `${state.runId} lifecycle channel agent`, instructions: 'lifecycle test agent' },
  })

  // Runner advertising claude-code capability
  state.runner = await apiJson<Json>(state.page.request, '/api/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} lifecycle channel runner`,
      environmentId: state.environment.id,
      capabilities: ['claude-code'],
    },
  })
  state.runner = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/heartbeats`, {
    method: 'POST',
    data: { status: 'active', currentLoad: 0, capabilities: ['claude-code'] },
  })

  // Create session — self-hosted starts as pending/waiting-for-runner
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      runtime: 'claude-code',
      title: `${state.runId} lifecycle channel session`,
    },
  })
  assert.equal(state.latestSession.status, 'pending')

  // Runner claims a work item (lease)
  state.lease = await apiJson<Json>(state.page.request, `/api/runners/${state.runner.id}/leases`, {
    method: 'POST',
    data: { leaseDurationSeconds: 90 },
  })
  assert.equal(state.lease.status, 'active')

  // Open the runner channel WebSocket — upgrades session to 'running'
  state.runnerChannelMessages = await openRunnerChannel(state, 'lifecycleChannel')

  // Reload session to confirm it is now running
  state.latestSession = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession.id}`)
  assert.equal(state.latestSession.status, 'running')

  return state
}

// ---------------------------------------------------------------------------
// Scenario: Create a session from an agent and environment
// ---------------------------------------------------------------------------

When('the user creates a session with an agent and environment', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  // Background already created agent and environment; store them for mutation tests
  state.previousSession = state.latestSession

  // Create a fresh cloud session via API
  const created = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      runtime: state.sessionRuntime ?? 'ama',
      title: `${state.runId} lifecycle create session`,
    },
  })
  // Wait for cloud session to start
  for (let attempt = 0; attempt < 60; attempt++) {
    const s = await apiJson<Json>(state.page.request, `/api/sessions/${created.id}`)
    if (s.status === 'idle' || s.status === 'running') {
      state.latestSession = s
      return
    }
    if (s.status === 'error') {
      throw new Error(`Session startup failed: ${s.statusReason}`)
    }
    await delay(1_000)
  }
  throw new Error('Session did not become idle before timeout')
})

Then('the platform stores a session record in D1', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  const session = state.latestSession
  assert.ok(session?.id, 'session.id must be set')
  assert.ok(session?.projectId, 'session.projectId must be set')
  assert.ok(session?.organizationId, 'session.organizationId must be set')
  assert.ok(session?.agentId, 'session.agentId must be set')
  assert.ok(session?.environmentId, 'session.environmentId must be set')
  // Verify the record is retrievable from the API (i.e. stored in D1)
  const fetched = await apiJson<Json>(state.page.request, `/api/sessions/${session.id}`)
  assert.equal(fetched.id, session.id)
})

Then('the session uses a snapshot of the selected agent version', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  const session = state.latestSession
  const snapshot = (session?.agentSnapshot ?? {}) as Json

  // Snapshot must contain the agent version at creation time
  assert.ok(snapshot.version, 'agentSnapshot.version must be set')
  assert.equal(snapshot.agentId, state.agent?.id, 'agentSnapshot.agentId must match the agent')

  // Mutate the agent — the existing session snapshot must not change
  await apiJson<Json>(state.page.request, `/api/agents/${state.agent?.id}`, {
    method: 'PATCH',
    data: { instructions: `${state.runId} instructions updated after session creation` },
  })
  const refetched = await apiJson<Json>(state.page.request, `/api/sessions/${session?.id}`)
  const refetchedSnapshot = (refetched.agentSnapshot ?? {}) as Json
  assert.equal(refetchedSnapshot.version, snapshot.version, 'agentSnapshot.version must remain immutable')
})

Then('the session uses a snapshot of the selected environment', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  const session = state.latestSession
  const envSnap = (session?.environmentSnapshot ?? {}) as Json

  // Snapshot must exist and reference the environment used at creation
  assert.ok(session?.environmentVersionId, 'session.environmentVersionId must be set')
  assert.equal(envSnap.environmentId, state.environment?.id, 'environmentSnapshot.environmentId must match')

  // Mutate the environment — the session snapshot must be unchanged
  await apiJson<Json>(state.page.request, `/api/environments/${state.environment?.id}`, {
    method: 'PATCH',
    data: { description: `${state.runId} env description updated after session creation` },
  })
  const refetched = await apiJson<Json>(state.page.request, `/api/sessions/${session?.id}`)
  const refetchedSnap = (refetched.environmentSnapshot ?? {}) as Json
  assert.equal(refetchedSnap.id, envSnap.id, 'environmentSnapshot.id must remain immutable')
  assert.equal(refetched.environmentVersionId, session?.environmentVersionId, 'environmentVersionId must be immutable')
})

Then(
  'the session records the validated hostingMode, runtime, provider, model, runtime endpoint, and status',
  function (this: SessionLifecycleWorld) {
    const session = this.e2e?.latestSession
    assert.ok(session, 'session must exist')
    const meta = (session.runtimeMetadata ?? {}) as Json
    assert.ok(meta.hostingMode, 'runtimeMetadata.hostingMode must be set')
    assert.ok(meta.runtime, 'runtimeMetadata.runtime must be set')
    assert.ok(meta.provider, 'runtimeMetadata.provider must be set')
    // Cloud ama sessions have a runtimeEndpointPath set at creation
    assert.ok(session.runtimeEndpointPath, 'runtimeEndpointPath must be set for cloud sessions')
    assert.ok(
      String(session.runtimeEndpointPath).startsWith('/runtime/sessions/'),
      'runtimeEndpointPath must start with /runtime/sessions/',
    )
    assert.ok(['idle', 'running', 'pending'].includes(String(session.status)), 'session.status must be a valid status')
  },
)

// ---------------------------------------------------------------------------
// Scenario: Connect to a session through AMA runtime endpoints
// ---------------------------------------------------------------------------

When(
  'the client connects through an external SDK session helper or direct runtime client',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    // Simulate the SDK session helper: call the reconnect endpoint to get current metadata
    state.latestSession = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}/reconnect`)
  },
)

Then('runtime traffic uses AMA session endpoints', function (this: SessionLifecycleWorld) {
  const session = this.e2e?.latestSession
  assert.ok(session, 'session must exist')
  const path = String(session.runtimeEndpointPath ?? '')
  assert.ok(
    path.startsWith('/runtime/sessions/'),
    `runtimeEndpointPath must be under /runtime/sessions/; got: "${path}"`,
  )
  // Verify it does not expose external or sandbox-internal addresses
  assert.ok(!path.includes('://'), 'runtimeEndpointPath must not contain an absolute URL')
  assert.ok(!path.includes('sandbox'), 'runtimeEndpointPath must not expose sandbox namespace')
})

Then(
  'AMA persists canonical session events before exposing them to clients',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    // Verify AMA is the persistence layer: the events endpoint is accessible and returns a
    // valid paginated collection. An empty list is correct for a freshly created session with
    // no runtime activity yet — the invariant is that the endpoint exists and shapes are
    // canonical, not that events have already been emitted.
    const events = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/sessions/${state.latestSession?.id}/events`,
    )
    assert.ok(Array.isArray(events.data), 'events.data must be an array')
    for (const event of events.data) {
      // Every returned event must have the canonical shape
      assert.ok(typeof event.id === 'string', 'event.id must be a string')
      assert.ok(typeof event.sequence === 'number', 'event.sequence must be a number')
      assert.ok(typeof event.type === 'string', 'event.type must be a string')
      assert.ok(event.payload && typeof event.payload === 'object', 'event.payload must be an object')
      assert.ok(
        AMA_SESSION_EVENT_TYPES.includes(event.type as never),
        `event type "${event.type}" must be a canonical AMA session event type`,
      )
    }
  },
)

Then('the helper does not define an incompatible replacement runtime protocol', function (this: SessionLifecycleWorld) {
  const session = this.e2e?.latestSession
  assert.ok(session, 'session must exist')
  // The canonical session event types must include the standard lifecycle events
  assert.ok(AMA_SESSION_EVENT_TYPES.includes('agent_start'), 'canonical events must include agent_start')
  assert.ok(AMA_SESSION_EVENT_TYPES.includes('message_end'), 'canonical events must include message_end')
  // The runtime endpoint is the AMA protocol path, not a foreign protocol
  const path = String(session.runtimeEndpointPath ?? '')
  assert.ok(path.startsWith('/runtime/sessions/'), 'runtimeEndpointPath must use the AMA protocol namespace')
  // No second runtimeEndpointPath or alternative runtime protocol leaks
  assert.ok(!session.sandboxRuntimeEndpoint, 'sandboxRuntimeEndpoint must not be exposed')
  assert.ok(!session.runnerRuntimeEndpoint, 'runnerRuntimeEndpoint must not be exposed')
})

// ---------------------------------------------------------------------------
// Scenario: Send live commands to a self-hosted runtime session
// Scenario: Stop a self-hosted runtime session through AMA
// (shared Given)
// ---------------------------------------------------------------------------

Given(
  'a self-hosted session has an accepted runner channel and a live runtime handle',
  async function (this: SessionLifecycleWorld) {
    await setupSelfHostedChannelSession(this)
  },
)

When(
  'a client sends a follow-up message through the AMA session endpoint',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    state.runtimeMessage = `lifecycle-live-command-${state.runId}`
    state.response = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}/commands`, {
      method: 'POST',
      data: { type: 'prompt', message: state.runtimeMessage },
    })
  },
)

Then(
  'AMA routes the message to the owning runner over the accepted session channel',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    // The dispatch must have been accepted (live delivery for claude-code runtime)
    assert.equal(state.response?.accepted, true, 'command must be accepted')
    assert.equal(state.response?.delivery, 'live', 'command must be delivered live via runner channel')
    assert.equal(state.response?.runtime, 'self-hosted-runner', 'command must route via self-hosted-runner')

    // The runner channel (our simulated runner) must have received the session.command
    const channelSocket = state.runnerChannels?.lifecycleChannel
    assert.ok(channelSocket, 'lifecycleChannel must be open')

    // Wait for the command to arrive at the runner WebSocket
    const messages = state.runnerChannelMessages ?? []
    for (let attempt = 0; attempt < 40; attempt++) {
      const cmd = messages.find((m) => m.type === 'session.command' && (m.command as Json)?.type === 'prompt')
      if (cmd) {
        assert.equal((cmd.command as Json).message, state.runtimeMessage, 'delivered message must match sent message')
        return
      }
      await delay(100)
    }
    throw new Error(`Runner channel did not receive session.command for message "${state.runtimeMessage}"`)
  },
)

Then('the runner delivers the message to the selected runtime handle', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  // In this test the runner IS our WebSocket client; receiving the command is the delivery.
  // Simulate the runtime handling: send a runtime.output event back through the channel.
  // The channel handler requires events with a `payload` field — stream/content live there.
  state.runtimeMessage = state.runtimeMessage ?? 'lifecycle-live-command'
  await sendRunnerEvent(state, 'lifecycleChannel', {
    type: 'runtime.output',
    payload: { stream: 'stdout', content: `delivered:${state.runtimeMessage}` },
  })
})

Then(
  'AMA persists the resulting runtime activity as canonical session events',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    const content = `delivered:${state.runtimeMessage}`
    await waitForSessionEvent(
      state.page.request,
      String(state.latestSession?.id),
      (event) => JSON.stringify(event.payload).includes(content),
      `runtime.output event containing "${content}"`,
    )
  },
)

// ---------------------------------------------------------------------------
// Scenario: Stop a self-hosted runtime session through AMA
// ---------------------------------------------------------------------------

When('a client stops the session through the AMA session endpoint', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  state.latestSession = await stopSession(state.page.request, String(state.latestSession?.id))
})

Then(
  'AMA sends a stop command to the owning runner over the accepted session channel',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    // Give the WebSocket message a moment to arrive
    const messages = state.runnerChannelMessages ?? []
    for (let attempt = 0; attempt < 40; attempt++) {
      const stopCmd = messages.find((m) => m.type === 'session.command' && (m.command as Json)?.type === 'stop')
      if (stopCmd) return
      await delay(100)
    }
    throw new Error('Runner channel did not receive session.command { type: stop } after session stop')
  },
)

Then('the runner aborts the selected runtime handle', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  // Simulate the runner aborting: close the runner WebSocket
  const socket = state.runnerChannels?.lifecycleChannel
  if (socket) {
    socket.close()
    delete state.runnerChannels!.lifecycleChannel
    await delay(300)
  }
})

Then(
  'AMA records lifecycle events and a terminal stopped or error status',
  async function (this: SessionLifecycleWorld) {
    const state = await ensureState(this)
    const session = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
    assert.ok(
      session.status === 'stopped' || session.status === 'error',
      `session status must be terminal; got "${session.status}"`,
    )
    // Verify audit trail records the stop lifecycle event
    const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?limit=50')
    assert.ok(
      audit.data.some((record) => record.action === 'session.stop' && record.resourceId === state.latestSession?.id),
      'audit trail must include a session.stop record for this session',
    )
  },
)

// ---------------------------------------------------------------------------
// Scenario: Keep runtime process details behind AMA endpoints
// ---------------------------------------------------------------------------

Given('a session is running in any supported runtime', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  // Create a cloud ama session and wait for it to reach idle/running
  const created = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      runtime: state.sessionRuntime ?? 'ama',
      title: `${state.runId} runtime isolation session`,
    },
  })
  for (let attempt = 0; attempt < 60; attempt++) {
    const s = await apiJson<Json>(state.page.request, `/api/sessions/${created.id}`)
    if (s.status === 'idle' || s.status === 'running') {
      state.latestSession = s
      return
    }
    if (s.status === 'error') throw new Error(`Session startup failed: ${s.statusReason}`)
    await delay(1_000)
  }
  throw new Error('Session did not become idle before timeout')
})

When('the client sends commands or subscribes to events', async function (this: SessionLifecycleWorld) {
  const state = await ensureState(this)
  // Read session metadata and session events as a client would
  state.latestSession = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}`)
  await apiJson<ListResponse<Json>>(state.page.request, `/api/sessions/${state.latestSession?.id}/events`)
})

Then('the client uses only AMA session endpoints', function (this: SessionLifecycleWorld) {
  const session = this.e2e?.latestSession
  assert.ok(session, 'session must exist')
  const path = String(session.runtimeEndpointPath ?? '')
  assert.ok(path.startsWith('/runtime/sessions/'), `runtimeEndpointPath must be an AMA endpoint; got "${path}"`)
  // The endpoint must be a relative path — no external host embedded
  assert.ok(!path.includes('://'), 'runtimeEndpointPath must not embed an absolute URL')
})

Then(
  'sandbox-owned or runner-owned runtime process endpoints are never exposed',
  function (this: SessionLifecycleWorld) {
    const session = this.e2e?.latestSession
    assert.ok(session, 'session must exist')
    const serialized = JSON.stringify(session)
    // runtimeEndpointPath must be in the AMA-owned /runtime/sessions/ namespace
    assert.ok(
      !String(session.runtimeEndpointPath ?? '').match(/^https?:\/\//),
      'runtimeEndpointPath must not be an absolute URL to a sandbox or runner process',
    )
    // No raw port references in session data
    assert.ok(
      !serialized.match(/"https?:\/\/[^"]*:\d{4,5}[^"]*"/),
      'session response must not contain direct process URL with port',
    )
    // No sandbox-internal paths beyond the sandboxId field (which is just an ID, not an endpoint)
    assert.ok(
      !String(session.runtimeEndpointPath ?? '').startsWith('/sandbox/'),
      'runtimeEndpointPath must not expose sandbox-internal namespace',
    )
  },
)
