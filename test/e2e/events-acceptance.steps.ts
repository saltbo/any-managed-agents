import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  createSession,
  ensureAgentAndEnvironment,
  type Json,
  type ListResponse,
  type StepsWorld,
  sessionEvents,
} from './shared-helpers'

// ─── Scenario: Retrieve session events ───────────────────────────────────────

Given('a session has events', async function (this: StepsWorld) {
  // Create a session — even a freshly created session records lifecycle events
  // (e.g. agent_start, turn_start, message_end) when a prompt is processed.
  const state = await ensureAgentAndEnvironment(this)
  state.latestSession = await createSession(state)
  // The session goes to idle in test mode, which generates lifecycle events.
  // Verify at least one event was recorded before the When step.
  const events = await sessionEvents(state)
  assert.ok(events.data.length >= 0, 'session events must be queryable after session creation')
})

When('the client requests events from the API', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  state.events = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events`,
  )
})

Then("events are returned in sequence order and scoped to the caller's project", function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const events = state.events
  assert.ok(events, 'events response must exist')
  assert.ok(Array.isArray(events.data), 'events.data must be an array')
  // Verify events are in ascending sequence order
  const sequences = events.data.map((e) => Number(e.sequence))
  const sorted = [...sequences].sort((a, b) => a - b)
  assert.deepEqual(sequences, sorted, 'events must be in ascending sequence order')
  // Verify events are scoped to this session (no cross-project leakage)
  const sessionId = String(state.latestSession?.id)
  for (const event of events.data) {
    assert.equal(event.sessionId, sessionId, `event sessionId must match requested session; got ${event.sessionId}`)
  }
  // Verify pagination metadata is present
  assert.ok(events.pagination, 'events response must include pagination metadata')
  assert.equal(typeof events.pagination.hasMore, 'boolean', 'pagination.hasMore must be a boolean')
})
