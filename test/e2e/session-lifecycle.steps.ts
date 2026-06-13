import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse, delay, ensureLocalApp } from './local-app'
import {
  bridgeTestRuntimeConfig,
  CLAUDE_CODE_E2E_MODEL,
  type E2EState,
  objectValue,
  runtimeProviderModelCapability,
  startProductAmaRunner,
  waitForSessionEvent,
  waitForSessionEventText,
  waitForSessionStatus,
} from './product-api.steps'
import {
  createAgent,
  createEnvironment,
  createProvider,
  createProviderModel,
  ensureAgentAndEnvironment,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

type LifecycleWorld = StepsWorld & {
  wsMessages?: string[]
  wsUrl?: string
}

function state(world: LifecycleWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e as unknown as E2EState
}

// Providers reference a Vault credential now (was a bare `credentialSecretRef`
// string). Mint a project vault + credential and return its `credentialRef`.
async function createProviderCredentialRef(e2e: E2EState, slug: string) {
  e2e.vault ??= await apiJson<Json>(e2e.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${e2e.runId} vault`, description: 'E2E vault', scope: 'project', metadata: { purpose: 'e2e' } },
  })
  const credential = await apiJson<Json>(e2e.page.request, `/api/v1/vaults/${e2e.vault?.id}/credentials`, {
    method: 'POST',
    data: {
      name: `${e2e.runId} ${slug} provider key`,
      type: 'api_key',
      metadata: { purpose: 'provider-e2e' },
      secret: { provider: 'external-vault', externalVaultPath: `vault://ama/e2e/${e2e.runId}/${slug}` },
    },
  })
  return { credentialId: credential.id, versionId: credential.activeVersionId }
}

// ─── Create a session from an agent and environment ───

When('the user creates a session with an agent and environment', async function (this: LifecycleWorld) {
  const e2e = await ensureSignedIn(this)
  e2e.agent = await createAgent(e2e, {
    name: `${e2e.runId} lifecycle agent`,
    model: '@cf/moonshotai/kimi-k2.6',
  })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} lifecycle env` })
  e2e.latestSession = await apiJson<Json>(e2e.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: e2e.agent?.id,
      environmentId: e2e.environment?.id,
      runtime: 'ama',
      title: `${e2e.runId} lifecycle session`,
    },
  })
})

Then('the platform stores a session record in D1', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const stored = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.equal(stored.id, e2e.latestSession?.id)
  const list = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/sessions')
  assert.ok(
    list.data.some((session) => session.id === e2e.latestSession?.id),
    'created session must appear in the session list',
  )
})

Then('the session uses a snapshot of the selected agent version', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const before = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  const beforeSnapshot = objectValue(before.agentSnapshot)
  assert.equal(beforeSnapshot.agentId, objectValue(e2e.agent as Json).id, 'snapshot points at the selected agent')
  assert.ok(typeof beforeSnapshot.version === 'number', 'snapshot pins a concrete agent version')
  // Mutate the agent after session creation — the stored snapshot must not move.
  await apiJson<Json>(e2e.page.request, `/api/v1/agents/${(e2e.agent as Json).id}`, {
    method: 'PATCH',
    data: { instructions: 'Changed after session creation — snapshot must not follow.' },
  })
  const after = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.deepEqual(after.agentSnapshot, before.agentSnapshot, 'agent snapshot is immutable after creation')
})

Then('the session uses a snapshot of the selected environment', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const before = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.ok(before.environmentSnapshot, 'environment snapshot is stored on the session')
  await apiJson<Json>(e2e.page.request, `/api/v1/environments/${(e2e.environment as Json).id}`, {
    method: 'PATCH',
    data: { description: 'Changed after session creation — snapshot must not follow.' },
  })
  const after = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.deepEqual(after.environmentSnapshot, before.environmentSnapshot, 'environment snapshot is immutable')
})

Then(
  'the session records the validated hostingMode, runtime, provider, model, runtime endpoint, and status',
  async function (this: LifecycleWorld) {
    const e2e = state(this)
    const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
    const environmentSnapshot = objectValue(session.environmentSnapshot)
    const agentSnapshot = objectValue(session.agentSnapshot)
    assert.equal(environmentSnapshot.hostingMode, 'cloud')
    assert.ok(agentSnapshot, 'agent snapshot is recorded')
    const runtimeMetadata = objectValue(session.runtimeMetadata)
    assert.equal(runtimeMetadata.hostingMode, 'cloud', 'validated hostingMode is recorded')
    assert.equal(runtimeMetadata.runtime, 'ama', 'validated runtime is recorded')
    assert.ok(runtimeMetadata.provider, 'validated provider is recorded')
    assert.ok(runtimeMetadata.model, 'validated model is recorded')
    // The runtime endpoint path moved off the session record onto the dedicated
    // connection resource (GET /sessions/{id}/connection).
    const connection = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${session.id}/connection`)
    assert.equal(connection.path, `/api/v1/runtime/sessions/${session.id}/rpc`)
    assert.ok(typeof session.state === 'string' && String(session.state).length > 0)
  },
)

// ─── Connect to a session through AMA runtime endpoints ───

// Shared by session-events-protocol.steps.ts: one full runtime turn through
// the AMA WebSocket endpoint, returning every event pushed over the wire.
export async function runWsRuntimeTurn(e2e: E2EState, message: string, commandId = 'ws_turn_cmd'): Promise<string[]> {
  const origin = await ensureLocalApp()
  const sessionId = String(e2e.latestSession?.id)
  const token = await e2e.page.evaluate(() => window.localStorage.getItem('ama:e2e-access-token'))
  assert.ok(token, 'access token required for the runtime WebSocket')
  const wsUrl = `${origin.replace('http', 'ws')}/api/v1/runtime/sessions/${sessionId}/ws?access_token=${encodeURIComponent(token)}`
  const received: string[] = []
  const socket = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('runtime WebSocket round-trip timed out')), 30_000)
    socket.addEventListener('message', (event) => {
      const data = String(event.data)
      received.push(data)
      const parsed = JSON.parse(data) as { type?: string }
      if (parsed.type === 'agent_end') {
        clearTimeout(timer)
        socket.close()
        resolve()
      }
    })
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'prompt', id: commandId, message }))
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('runtime WebSocket errored'))
    })
  })
  return received
}

When(
  'the client connects through an external SDK session helper or direct runtime client',
  async function (this: LifecycleWorld) {
    const e2e = state(this)
    const origin = await ensureLocalApp()
    this.wsUrl = `${origin.replace('http', 'ws')}/api/v1/runtime/sessions/${e2e.latestSession?.id}/ws`
    this.wsMessages = await runWsRuntimeTurn(e2e, 'lifecycle ws round-trip', 'lifecycle_ws_cmd')
  },
)

Then('runtime traffic uses AMA session endpoints', async function (this: LifecycleWorld) {
  const e2e = state(this)
  assert.ok(
    this.wsUrl?.includes(`/api/v1/runtime/sessions/${e2e.latestSession?.id}/ws`),
    'client connected to the AMA path',
  )
  // The runtime endpoint moved onto the dedicated connection resource.
  const connection = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}/connection`)
  assert.equal(
    connection.path,
    `/api/v1/runtime/sessions/${e2e.latestSession?.id}/rpc`,
    'the session advertises only the AMA runtime endpoint',
  )
})

Then('browser clients use WebSocket for bidirectional runtime commands and events', function (this: LifecycleWorld) {
  assert.ok(this.wsMessages && this.wsMessages.length > 0, 'runtime events arrived over the WebSocket')
  const joined = this.wsMessages.join('\n')
  assert.ok(joined.includes('lifecycle ws round-trip'), 'the runtime processed the command sent over the socket')
  assert.ok(joined.includes('agent_end'), 'the runtime streamed lifecycle completion back over the socket')
})

Then('AMA persists canonical session events before exposing them to clients', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const events = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    `/api/v1/sessions/${e2e.latestSession?.id}/events?limit=200`,
  )
  const serialized = JSON.stringify(events.data)
  assert.ok(serialized.includes('lifecycle ws round-trip'), 'the WebSocket turn is persisted as canonical events')
  const sequences = events.data.map((event) => Number(event.sequence))
  const sorted = [...sequences].sort((a, b) => a - b)
  assert.deepEqual(sequences, sorted, 'persisted events keep monotonically increasing sequence numbers')
})

Then('clients can list or stream persisted session events', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const list = await apiJson<ListResponse<Json>>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}/events`)
  assert.ok(list.data.length > 0, 'events are listable')
  // Streaming is content-negotiated on the same collection URI now.
  const stream = await apiResponse(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}/events`, {
    headers: { accept: 'text/event-stream' },
  })
  assert.ok(stream.ok(), 'events are streamable through the AMA endpoint')
})

Then('the helper does not define an incompatible replacement runtime protocol', async function (this: LifecycleWorld) {
  const e2e = state(this)
  // The published control-plane contract must not describe runtime process
  // paths; runtime traffic stays on the canonical AMA session surface.
  const openapi = await apiJson<{ paths: Record<string, unknown> }>(e2e.page.request, '/api/v1/openapi.json')
  const runtimePaths = Object.keys(openapi.paths).filter((path) => path.includes('/runtime/'))
  assert.deepEqual(runtimePaths, [], 'OpenAPI/SDK surface stays control-plane only')
  // And every event observed over the wire is a canonical AMA session event.
  for (const raw of this.wsMessages ?? []) {
    const parsed = JSON.parse(raw) as { type?: string }
    assert.ok(typeof parsed.type === 'string' && parsed.type.length > 0, 'wire events carry canonical types')
  }
})

// ─── Self-hosted live runtime: follow-up messages and stop ───

// Shared by session-events-protocol.steps.ts: a real self-hosted run whose
// live bridge handle stays open for prompts, checkpoints, and aborts.
export async function setupLiveSelfHostedSession(world: LifecycleWorld): Promise<E2EState> {
  const e2e = (await ensureSignedIn(world)) as unknown as E2EState
  {
    e2e.environment = await createEnvironment(e2e as never, {
      name: `${e2e.runId} live claude-code env`,
      hostingMode: 'self_hosted',
      runtime: 'claude-code',
      runtimeConfig: { ...bridgeTestRuntimeConfig(), e2eBridgeLive: true },
      networkPolicy: { mode: 'unrestricted' },
    })
    e2e.provider = await createProvider(e2e as never, {
      type: 'anthropic',
      displayName: `${e2e.runId} live claude-code provider`,
      credentialRef: await createProviderCredentialRef(e2e, 'live-claude-code'),
    })
    e2e.providerModel = await createProviderModel(e2e as never, e2e.provider as Json, {
      modelId: CLAUDE_CODE_E2E_MODEL,
      displayName: 'Claude Sonnet 4.6',
      capabilities: ['text'],
    })
    e2e.agent = await createAgent(e2e as never, {
      name: `${e2e.runId} live claude-code agent`,
      providerId: (e2e.provider as Json).id,
      model: CLAUDE_CODE_E2E_MODEL,
    })
    const capability = runtimeProviderModelCapability('claude-code', '*', CLAUDE_CODE_E2E_MODEL)
    e2e.runner = await apiJson<Json>(e2e.page.request, '/api/v1/runners', {
      method: 'POST',
      data: {
        name: `${e2e.runId} live claude-code runner`,
        environmentId: (e2e.environment as Json).id,
        capabilities: ['sandbox.exec', capability],
      },
    })
    e2e.latestSession = await apiJson<Json>(e2e.page.request, '/api/v1/sessions', {
      method: 'POST',
      data: {
        agentId: (e2e.agent as Json).id,
        environmentId: (e2e.environment as Json).id,
        runtime: 'claude-code',
        title: `${e2e.runId} live claude-code session`,
        initialPrompt: 'live handle initial prompt',
      },
    })
    assert.equal((e2e.latestSession as Json).stateReason, 'waiting-for-runner')
    await startProductAmaRunner(e2e)
    await waitForSessionStatus(e2e, 'running')
    // The live bridge echoes the initial prompt once the runtime handle is up.
    await waitForSessionEventText(e2e, 'claude-code-bridge-live received:live handle initial prompt')
  }
  return e2e
}

Given(
  'a self-hosted session has an accepted runner channel and a live runtime handle',
  { timeout: 240_000 },
  async function (this: LifecycleWorld) {
    await setupLiveSelfHostedSession(this)
  },
)

When('a client sends a follow-up message through the AMA session endpoint', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const response = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}/messages`, {
    method: 'POST',
    data: { type: 'prompt', content: 'live follow-up message' },
  })
  ;(e2e as { response?: Json }).response = response
})

Then(
  'AMA routes the message to the owning runner over the accepted session channel',
  async function (this: LifecycleWorld) {
    const e2e = state(this)
    const response = (e2e as { response?: Json }).response
    assert.ok(response, 'the command response must exist')
    // Delivery is observable end-to-end: the live runtime saw the message.
    await waitForSessionEventText(e2e, 'live-received:live follow-up message')
  },
)

Then('the runner delivers the message to the selected runtime handle', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const event = await waitForSessionEvent(
    e2e,
    (candidate) => JSON.stringify(candidate).includes('claude-code-bridge-live live-received:live follow-up message'),
    'live runtime echo for the follow-up message',
  )
  assert.ok(event, 'the live runtime handle processed the injected prompt')
})

Then('AMA persists the resulting runtime activity as canonical session events', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const events = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    `/api/v1/sessions/${e2e.latestSession?.id}/events?limit=200`,
  )
  const serialized = JSON.stringify(events.data)
  assert.ok(serialized.includes('live follow-up message'), 'follow-up activity is persisted')
  const sequences = events.data.map((event) => Number(event.sequence))
  assert.deepEqual(
    sequences,
    [...sequences].sort((a, b) => a - b),
    'runner-ingested events keep canonical ordering',
  )
})

When('a client stops the session through the AMA session endpoint', async function (this: LifecycleWorld) {
  const e2e = state(this)
  e2e.latestSession = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`, {
    method: 'PATCH',
    data: { state: 'stopped' },
  })
})

Then(
  'AMA sends a stop command to the owning runner over the accepted session channel',
  async function (this: LifecycleWorld) {
    const e2e = state(this)
    // The runner logs receipt of the channel stop command before aborting.
    await waitForRunnerOutput(e2e, 'runner received stop command')
  },
)

Then('the runner aborts the selected runtime handle', async function (this: LifecycleWorld) {
  const e2e = state(this)
  await waitForRunnerOutput(e2e, 'aborting runtime handle')
})

Then('AMA records lifecycle events and a terminal stopped or error status', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.ok(['stopped', 'error'].includes(String(session.state)), `terminal status, got ${session.state}`)
  const events = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    `/api/v1/sessions/${e2e.latestSession?.id}/events?limit=200`,
  )
  assert.ok(
    events.data.some((event) => event.type === 'session_stop'),
    'the canonical session_stop lifecycle event is recorded',
  )
})

// ─── Keep runtime process details behind AMA endpoints ───

Given('a session is running in any supported runtime', async function (this: LifecycleWorld) {
  const e2e = await ensureAgentAndEnvironment(this)
  e2e.latestSession = await apiJson<Json>(e2e.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: e2e.agent?.id,
      environmentId: e2e.environment?.id,
      runtime: 'ama',
      title: `${e2e.runId} isolation session`,
    },
  })
})

When('the client sends commands or subscribes to events', async function (this: LifecycleWorld) {
  const e2e = state(this)
  await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}/messages`, {
    method: 'POST',
    data: { type: 'prompt', content: 'isolation probe message' },
  })
  ;(e2e as { events?: ListResponse<Json> }).events = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    `/api/v1/sessions/${e2e.latestSession?.id}/events?limit=200`,
  )
})

Then('the client uses only AMA session endpoints', async function (this: LifecycleWorld) {
  const e2e = state(this)
  const session = e2e.latestSession as Json
  const connection = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${session.id}/connection`)
  assert.equal(connection.path, `/api/v1/runtime/sessions/${session.id}/rpc`)
})

Then(
  'sandbox-owned or runner-owned runtime process endpoints are never exposed',
  async function (this: LifecycleWorld) {
    const e2e = state(this)
    const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
    const events = (e2e as { events?: ListResponse<Json> }).events
    const surfaces = [JSON.stringify(session), JSON.stringify(events?.data ?? [])]
    for (const surface of surfaces) {
      assert.ok(!/wss?:\/\/(?!localhost:\d+\/runtime\/sessions)/.test(surface), 'no foreign socket endpoints leak')
      assert.ok(!surface.includes('preview-url'), 'no sandbox preview URLs leak')
      assert.ok(!/:\d{4,5}\/(exec|process|shell)/.test(surface), 'no raw process endpoints leak')
    }
  },
)

async function waitForRunnerOutput(e2e: E2EState, marker: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const output = e2e.runnerProcess?.runnerOutput.join('') ?? ''
    if (output.includes(marker)) {
      return
    }
    await delay(1_000)
  }
  throw new Error(`Runner output never contained "${marker}"`)
}
