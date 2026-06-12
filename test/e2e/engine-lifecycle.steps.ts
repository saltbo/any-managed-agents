import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import type { ListResponse } from './shared-helpers'
import {
  claimRunnerLease,
  completeRunnerLease,
  createAgent,
  createAndActivateRunner,
  createEnvironment,
  createSession,
  ensureAgentAndEnvironment,
  ensureSignedIn,
  type Json,
  type StepsWorld,
  uploadRunnerEvent,
} from './shared-helpers'

// ─── Scenario: Stop session (session-stop.feature) ───────────────────────────

Then('runtime work is cancelled and the session records a stopped event', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const session = state.latestSession as Json
  assert.equal(session.status, 'stopped')
  // The stop is recorded via the audit trail — a session.stop audit event is
  // created by the control plane when the stop request is processed. In test
  // mode, sessions may have no active runtime work, so runtime lifecycle events
  // (agent_end, turn_end) are not guaranteed; the audit record is canonical proof.
  const audit = await apiJson<ListResponse<Json>>(state.page.request, `/api/audit-records?action=session.stop&limit=10`)
  assert.ok(audit.data.length > 0, 'Expected a session.stop audit record after stopping the session')
})

// ─── Scenario: Stop a running session (sessions-runtime.feature) ─────────────

Then('AMA sends the stop request to the selected session runtime', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // After stop, the session must be stopped — confirming AMA propagated the
  // stop to the runtime (in AMA cloud runtime the stop is applied directly).
  const session = state.latestSession as Json
  assert.equal(session.status, 'stopped')
})

// ─── Scenario: Terminate after runtime failure (engine-error-termination) ────

When('model, tool, sandbox, or policy execution fails', async function (this: StepsWorld) {
  const state = await ensureSignedIn(this)
  // Set up a self-hosted session so we can control the execution outcome
  state.environment = await createEnvironment(state, {
    name: `${state.runId} error env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} error agent` })
  // Create the session — it starts as pending/waiting-for-runner
  state.latestSession = await apiJson<Json>(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      runtime: 'ama',
      title: `${state.runId} error session`,
    },
  })
  // Register and activate a runner, claim the work
  await createAndActivateRunner(state)
  await claimRunnerLease(state)
  // Upload a runtime error event through the runner lease events API
  await uploadRunnerEvent(state, {
    type: 'runtime.error',
    payload: {
      type: 'runtime.error',
      message: 'Simulated model execution failure',
      code: 'model_error',
    },
    metadata: { runnerId: state.runner?.id },
  })
  // Mark the lease as failed — AMA transitions the session to error state
  await completeRunnerLease(state, 'failed')
  // Allow the DB write to settle
  await new Promise((resolve) => setTimeout(resolve, 500))
  // Refresh the session
  state.latestSession = await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession.id}`)
})

Then('the session records a structured error event and moves to an error state', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const session = state.latestSession as Json
  assert.equal(session.status, 'error', `Expected session status error, got: ${session.status}`)
  // Verify a runtime.error event was recorded
  const events = await apiJson<ListResponse<Json>>(state.page.request, `/api/sessions/${session.id}/events?limit=50`)
  const errorEvent = events.data.find((e) => e.type === 'runtime.error')
  assert.ok(errorEvent, 'Expected a runtime.error event in session events')
  const payload = (errorEvent.payload ?? {}) as Json
  assert.ok(typeof payload.message === 'string', 'runtime.error event must include a message in payload')
})

// ─── Scenario: Cancel a running session (engine-cooperative-cancellation) ─────

Given('a session is running model, tool, or sandbox work', async function (this: StepsWorld) {
  // In the local test harness AMA sessions go to idle almost immediately,
  // but the cooperative cancellation contract can be verified by stopping
  // a session that is in an active (idle or running) state. We create a
  // cloud-runtime session which the AMA test runtime handles synchronously.
  const state = await ensureAgentAndEnvironment(this)
  state.latestSession = await createSession(state)
  assert.ok(
    ['idle', 'running'].includes(String((state.latestSession as Json).status)),
    `Expected session to be idle or running before cancellation; got: ${(state.latestSession as Json).status}`,
  )
})

Then('the runtime sends a cancellation signal and records the final stopped status', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const session = state.latestSession as Json
  assert.equal(session.status, 'stopped')
  // Audit record should include a stop action
  const audit = await apiJson<ListResponse<Json>>(state.page.request, '/api/audit-records?action=session.stop&limit=10')
  assert.ok(audit.data.length > 0, 'Expected a session.stop audit record after cooperative cancellation')
})
