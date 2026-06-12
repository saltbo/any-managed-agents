import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  type E2EState,
  startProductAmaRunner,
  waitForSessionEvent,
  waitForSessionEventText,
  waitForSessionStatus,
} from './product-api.steps'
import { setupLiveSelfHostedSession } from './session-lifecycle.steps'
import {
  createAgent,
  createEnvironment,
  createSession,
  delay,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

type EventsWorld = StepsWorld & {
  storedEvents?: ListResponse<Json>
}

function state(world: EventsWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e as unknown as E2EState
}

async function listEvents(e2e: E2EState, query = 'limit=200') {
  return await apiJson<ListResponse<Json>>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}/events?${query}`)
}

// ─── Redact sensitive event payloads ───

Given(
  'a provider, tool, MCP connector, vault, or sandbox process emits sensitive values',
  async function (this: EventsWorld) {
    const e2e = await ensureSignedIn(this)
    e2e.agent = await createAgent(e2e, { name: `${e2e.runId} redaction agent`, allowedTools: ['sandbox.exec'] })
    e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} redaction env` })
    e2e.latestSession = await createSession(e2e)
    // A runtime turn whose transcript carries credential material — a
    // stand-in for any provider/tool/vault/sandbox leak. Redaction must strip
    // the value before anything reaches D1.
    const e2eState = state(this)
    await apiJson<Json>(e2eState.page.request, `/runtime/sessions/${e2eState.latestSession?.id}/rpc`, {
      method: 'POST',
      data: { message: 'use credential raw-secret-token to authenticate' },
    })
  },
)

When('the event is stored or streamed', async function (this: EventsWorld) {
  this.storedEvents = await listEvents(state(this))
  assert.ok(this.storedEvents.data.length > 0, 'runtime turn produced stored events')
})

Then('secret values are replaced with safe references', function (this: EventsWorld) {
  const events = this.storedEvents
  assert.ok(events, 'events must be loaded')
  const serialized = JSON.stringify(events.data)
  assert.ok(!serialized.includes('raw-secret-token'), 'raw secret values never appear in stored events')
  const redacted = events.data.find(
    (event) => String(event.type).startsWith('message_') && JSON.stringify(event.payload).includes('[REDACTED]'),
  )
  assert.ok(redacted, 'the leaking payload is stored with the safe replacement reference')
})

Then('audit metadata records the source without exposing the secret', function (this: EventsWorld) {
  const events = this.storedEvents
  assert.ok(events, 'events must be loaded')
  const redacted = events.data.find((event) => JSON.stringify(event.payload).includes('[REDACTED]')) as Json
  const metadata = (redacted.metadata ?? {}) as Record<string, unknown>
  assert.ok(metadata.runtimeSource || metadata.source, 'event metadata records the producing source')
  assert.ok(!JSON.stringify(metadata).includes('raw-secret-token'), 'metadata never carries the secret value')
})

// ─── Preserve event hierarchy for product consumers ───

Given(
  'a runtime emits nested turns, messages, tool calls, permission requests, and substeps',
  async function (this: EventsWorld) {
    const e2e = await ensureSignedIn(this)
    e2e.agent = await createAgent(e2e, { name: `${e2e.runId} hierarchy agent`, allowedTools: ['sandbox.exec'] })
    e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} hierarchy env` })
    e2e.latestSession = await createSession(e2e)
    // A status prompt drives the real agent loop through a tool round-trip,
    // persisting the nested turn → message → tool tree.
    const e2eState = state(this)
    await apiJson<Json>(e2eState.page.request, `/runtime/sessions/${e2eState.latestSession?.id}/rpc`, {
      method: 'POST',
      data: { message: 'inspect the sandbox status' },
    })
  },
)

When('AMA stores the session events', async function (this: EventsWorld) {
  this.storedEvents = await listEvents(state(this))
  assert.ok(this.storedEvents.data.length > 0, 'the nested turn produced stored events')
})

Then('every canonical event has a stable event id and monotonically increasing sequence', function (this: EventsWorld) {
  const events = this.storedEvents?.data ?? []
  const ids = events.map((event) => String(event.id))
  assert.equal(new Set(ids).size, ids.length, 'event ids are unique')
  for (const id of ids) {
    assert.match(id, /^event_/, 'event ids are stable platform identifiers')
  }
  const sequences = events.map((event) => Number(event.sequence))
  for (let i = 1; i < sequences.length; i += 1) {
    assert.ok(sequences[i]! > sequences[i - 1]!, 'sequences increase monotonically')
  }
})

Then('related events share stable turn, message, tool call, and span identifiers', function (this: EventsWorld) {
  const events = this.storedEvents?.data ?? []
  const messageEvents = events.filter((event) => String(event.type).startsWith('message_'))
  assert.ok(messageEvents.length >= 4, 'the turn produced message lifecycles')
  for (const event of messageEvents) {
    assert.match(String(event.correlationId), /^message:/, 'every message event carries a namespaced correlation id')
  }
  // Each message lifecycle (user prompt, assistant tool call, tool result,
  // final assistant text) forms its own correlation group; the streamed
  // assistant message groups start + updates + end under one id.
  const groups = new Map<string, Json[]>()
  for (const event of messageEvents) {
    const key = String(event.correlationId)
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  assert.ok(groups.size >= 2, 'distinct messages have distinct correlation groups')
  const streamedGroup = [...groups.values()].find((group) => group.length >= 3)
  assert.ok(streamedGroup, 'a streamed message groups start, updates, and end under one correlation id')
  assert.ok(
    streamedGroup.some((event) => event.type === 'message_start') &&
      streamedGroup.some((event) => event.type === 'message_end'),
    'the streamed correlation group spans the full message lifecycle',
  )

  const toolEvents = events.filter((event) => String(event.type).startsWith('tool_execution_'))
  assert.ok(toolEvents.length >= 2, 'the turn produced a tool call and its result')
  const toolCorrelations = new Set(toolEvents.map((event) => String(event.correlationId)))
  assert.equal(toolCorrelations.size, 1, 'tool call and result share one correlation id')
  assert.match([...toolCorrelations][0]!, /^tool:/, 'tool correlation ids are namespaced')
})

Then(
  'child events reference their parent event, tool call, or span where nesting exists',
  function (this: EventsWorld) {
    const events = this.storedEvents?.data ?? []
    const childTypes = ['message_start', 'message_update', 'message_end', 'tool_execution_start', 'tool_execution_end']
    let currentTurn: string | null = null
    let checkedChildren = 0
    for (const event of events) {
      if (event.type === 'turn_start') {
        currentTurn = String(event.id)
        continue
      }
      if (event.type === 'turn_end') {
        currentTurn = null
        continue
      }
      if (childTypes.includes(String(event.type))) {
        assert.ok(currentTurn, `${event.type} occurs inside a turn`)
        assert.equal(event.parentEventId, currentTurn, `${event.type} references its enclosing turn`)
        checkedChildren += 1
      }
    }
    assert.ok(checkedChildren > 0, 'the run produced nested child events')
  },
)

Then(
  'product clients can reconstruct transcript, tool progress, runtime diagnostics, usage, and errors without raw runtime events',
  function (this: EventsWorld) {
    const events = this.storedEvents?.data ?? []
    const byCategoryPresent = {
      transcript: events.some((event) => String(event.type).startsWith('message_')),
      tool: events.some((event) => String(event.type).startsWith('tool_execution_')),
      lifecycle: events.some((event) => ['turn_start', 'turn_end'].includes(String(event.type))),
    }
    assert.deepEqual(byCategoryPresent, { transcript: true, tool: true, lifecycle: true })
    // Reconstruction needs only canonical fields — every event type is canonical.
    for (const event of events) {
      assert.ok(typeof event.type === 'string', 'canonical type present')
      assert.ok(event.payload !== undefined, 'canonical payload present')
    }
  },
)

// ─── Record runtime checkpoints and resume tokens as canonical events ───

Given(
  'a runtime creates a checkpoint, thread id, session id, or resume token',
  { timeout: 240_000 },
  async function (this: EventsWorld) {
    await setupLiveSelfHostedSession(this)
  },
)

When('AMA receives the runtime update', { timeout: 120_000 }, async function (this: EventsWorld) {
  // The runner reports the runtime resume token on its next lease renewal.
  const e2e = state(this)
  await waitForSessionEvent(
    e2e,
    (event) => (event as Json).type === 'session_checkpoint',
    'canonical session_checkpoint event',
  )
  this.storedEvents = await listEvents(e2e)
})

Then(
  'AMA stores a canonical checkpoint or runtime metadata event with a safe resume reference',
  function (this: EventsWorld) {
    const checkpoint = (this.storedEvents?.data ?? []).find((event) => event.type === 'session_checkpoint') as Json
    assert.ok(checkpoint, 'session_checkpoint event is stored')
    const payload = checkpoint.payload as Record<string, unknown>
    assert.match(String(payload.resumeTokenRef), /^work-item:/, 'the checkpoint carries a safe resume reference')
  },
)

Then('the raw provider token value is redacted when it is sensitive', function (this: EventsWorld) {
  const e2e = state(this)
  // The live bridge resume token is e2e-live-<sessionId>; the canonical event
  // stream must never carry it.
  const serialized = JSON.stringify(this.storedEvents?.data ?? [])
  assert.ok(
    !serialized.includes(`e2e-live-${e2e.latestSession?.id}`),
    'the raw runtime resume token never appears in canonical events',
  )
})

Then(
  'session state can identify the latest safe resume point without parsing raw runtime events',
  async function (this: EventsWorld) {
    const e2e = state(this)
    const checkpoints = await listEvents(e2e, 'limit=50&type=session_checkpoint')
    assert.ok(checkpoints.data.length > 0, 'checkpoint events are queryable by type')
    const latest = checkpoints.data.at(-1) as Json
    assert.match(
      String((latest.payload as Record<string, unknown>).resumeTokenRef),
      /^work-item:/,
      'the latest safe resume point is identified by reference',
    )
  },
)

// ─── Resume a session from the latest safe checkpoint (sessions-runtime) ───

Given('a session has a stored safe resume point', { timeout: 300_000 }, async function (this: EventsWorld) {
  const e2e = await setupLiveSelfHostedSession(this)
  await waitForSessionEvent(
    e2e,
    (event) => (event as Json).type === 'session_checkpoint',
    'checkpoint before interrupting the runner',
  )
  // Gracefully stop the runner: it reports the lease as interrupted with the
  // freshest resume token and AMA queues the session for recovery.
  const runner = e2e.runnerProcess
  assert.ok(runner, 'runner process must be running')
  // `go run` does not forward signals to its child: signal the process group
  // so the runner itself sees SIGTERM and reports the lease as interrupted.
  assert.ok(runner.pid, 'runner pid required')
  process.kill(-runner.pid, 'SIGTERM')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}`)
    if (session.status === 'pending' && session.statusReason === 'waiting-for-runner-recovery') {
      return
    }
    await delay(1_000)
  }
  throw new Error('Session never reached waiting-for-runner-recovery after the runner stopped')
})

When('a client resumes the session through AMA', { timeout: 240_000 }, async function (this: EventsWorld) {
  const e2e = state(this)
  // The client observes the session through the AMA reconnect endpoint; AMA
  // dispatches the queued resume to the next eligible runner.
  e2e.latestSession = await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}/reconnect`)
  await startProductAmaRunner(e2e)
  await waitForSessionStatus(e2e, 'running')
})

Then(
  'AMA sends the resume request to the selected runtime driver or owning runner',
  async function (this: EventsWorld) {
    const e2e = state(this)
    await waitForSessionEvent(e2e, (event) => (event as Json).type === 'session_resume', 'session_resume event')
    // The runtime actually started in resume mode.
    await waitForSessionEventText(e2e, 'claude-code-bridge-live resumed-with-token:yes')
  },
)

Then(
  'the runtime continues from the safe resume point without creating a duplicate session history',
  async function (this: EventsWorld) {
    const e2e = state(this)
    const events = await listEvents(e2e)
    const serializedEvents = events.data.map((event) => JSON.stringify(event))
    const initialEchoes = serializedEvents.filter((event) =>
      event.includes('claude-code-bridge-live received:live handle initial prompt'),
    )
    assert.equal(initialEchoes.length, 1, 'the initial prompt history is not replayed on resume')
    this.storedEvents = events
  },
)

Then(
  'AMA records resumed lifecycle events and later runtime activity in the same session event stream',
  function (this: EventsWorld) {
    const events = this.storedEvents?.data ?? []
    const resumeIndex = events.findIndex((event) => event.type === 'session_resume')
    assert.ok(resumeIndex >= 0, 'session_resume is part of the canonical stream')
    const afterResume = events.slice(resumeIndex + 1)
    assert.ok(
      afterResume.some((event) => JSON.stringify(event).includes('resumed-with-token')),
      'post-resume runtime activity lands in the same stream',
    )
    const sequences = events.map((event) => Number(event.sequence))
    for (let i = 1; i < sequences.length; i += 1) {
      assert.ok(sequences[i]! > sequences[i - 1]!, 'one continuous monotonically increasing stream')
    }
  },
)
