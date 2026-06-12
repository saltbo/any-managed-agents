import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
  waitForSessionEventMatch,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

type UsageWorld = StepsWorld & {
  usageRecords?: Json[]
  usageSummary?: Json
}

async function sessionEventList(state: E2EState) {
  return await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/sessions/${state.latestSession?.id}/events?limit=200`,
  )
}

Given('a session records provider calls and tool calls', async function (this: UsageWorld) {
  const state = await ensureSignedIn(this)
  state.agent = await createAgent(state, {
    name: `${state.runId} attribution agent`,
    provider: 'workers-ai',
    model: WORKERS_AI_MODEL,
  })
  state.environment = await createEnvironment(state, { name: `${state.runId} attribution env` })
  state.latestSession = await createSession(state, { title: `${state.runId} attribution session` })
  // This prompt makes the test runtime issue a sandbox.exec tool call before
  // answering, so the turn records both model usage and tool usage.
  await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}/commands`, {
    method: 'POST',
    data: { type: 'prompt', message: `${state.runId} inspect the sandbox status` },
  })
  await waitForSessionEventMatch(state, (event) => event.type === 'tool_execution_end', 'a completed tool execution')
  await waitForSessionEventMatch(state, (event) => event.type === 'usage.recorded', 'recorded model usage')
})

When('usage is summarized', async function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const records = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/usage?sessionId=${state.latestSession?.id}&limit=100`,
  )
  this.usageRecords = records.data
  this.usageSummary = await apiJson<Json>(
    state.page.request,
    `/api/usage/summary?sessionId=${state.latestSession?.id}&groupBy=provider,model,session`,
  )
})

Then('model usage is traceable to session events', async function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state && this.usageRecords, 'usage records must have been listed')
  const modelRecords = this.usageRecords.filter((record) => record.usageType === 'model')
  assert.ok(modelRecords.length >= 1, 'the session recorded model usage')
  const events = await sessionEventList(state)
  const eventsById = new Map(events.data.map((event) => [String(event.id), event]))
  for (const record of modelRecords) {
    const event = eventsById.get(String(record.sessionEventId))
    assert.ok(event, 'each model usage record points at a persisted session event')
    assert.equal(event.type, 'usage.recorded', 'the referenced session event is the recorded usage event')
  }
  const totals = (this.usageSummary?.totals ?? {}) as Json
  assert.ok(Number(totals.totalTokens) > 0, 'the summary aggregates the recorded token usage')
})

Then(
  'tool and sandbox usage are attributed to the same session, agent version, and project',
  async function (this: UsageWorld) {
    const state = this.e2e
    assert.ok(state && this.usageRecords, 'usage records must have been listed')
    const modelRecord = this.usageRecords.find((record) => record.usageType === 'model')
    const toolRecords = this.usageRecords.filter((record) => record.usageType === 'tool')
    assert.ok(modelRecord, 'the session recorded model usage')
    assert.ok(toolRecords.length >= 1, 'the session recorded tool usage')
    assert.ok(typeof modelRecord.agentVersionId === 'string', 'model usage pins the agent version snapshot')
    for (const record of toolRecords) {
      assert.equal(record.providerType, 'sandbox', 'tool usage is attributed to the sandbox')
      assert.equal(record.sessionId, state.latestSession?.id, 'tool usage shares the session attribution')
      assert.equal(record.agentVersionId, modelRecord.agentVersionId, 'tool usage shares the agent version')
      assert.equal(record.projectId, modelRecord.projectId, 'tool usage shares the project attribution')
      assert.ok(String(record.correlationId ?? '').startsWith('tool:'), 'tool usage correlates to the tool call')
    }
    const events = await sessionEventList(state)
    const eventsById = new Map(events.data.map((event) => [String(event.id), event]))
    for (const record of toolRecords) {
      const event = eventsById.get(String(record.sessionEventId))
      assert.ok(event, 'each tool usage record points at a persisted session event')
      assert.equal(event.type, 'tool_execution_end', 'the referenced event is the completed tool execution')
    }
  },
)
