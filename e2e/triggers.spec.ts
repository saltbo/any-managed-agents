import { expect, test } from './fixtures'

type Json = Record<string, unknown>

async function createAgent(api: import('@playwright/test').APIRequestContext, name: string) {
  const res = await api.post('/api/v1/agents', {
    data: { name, instructions: 'Run scheduled work.' },
  })
  expect(res.status(), `POST /api/v1/agents (${name})`).toBe(201)
  return (await res.json()) as { id: string }
}

async function createEnvironment(api: import('@playwright/test').APIRequestContext, name: string) {
  const res = await api.post('/api/v1/environments', {
    data: { name, runtimeConfig: { image: 'ama-tool-executor' } },
  })
  expect(res.status(), `POST /api/v1/environments (${name})`).toBe(201)
  return (await res.json()) as { id: string }
}

// [spec: triggers/dispatch]
test('creates a trigger, dispatches it via the e2e heartbeat, and a run/session results [spec: triggers/dispatch]', async ({
  api,
  runId,
}) => {
  const agent = await createAgent(api, `${runId} trigger agent`)
  const environment = await createEnvironment(api, `${runId} trigger env`)

  const dueAt = '2026-05-26T12:00:00.000Z'
  const heartbeatAt = '2026-05-26T12:01:00.000Z'

  const createRes = await api.post('/api/v1/triggers', {
    data: {
      agentId: agent.id,
      environmentId: environment.id,
      runtime: 'ama',
      name: `${runId} heartbeat`,
      promptTemplate: 'E2E scheduled work.',
      schedule: { type: 'interval', intervalSeconds: 3600 },
      nextDueAt: dueAt,
    },
  })
  expect(createRes.status()).toBe(201)
  const trigger = (await createRes.json()) as { id: string; enabled: boolean; nextDueAt: string }
  expect(trigger.enabled).toBe(true)
  expect(trigger.nextDueAt).toBe(dueAt)

  const dispatchRes = await api.post('/api/v1/e2e/scheduled-agent-triggers/dispatch', {
    data: { heartbeatAt },
  })
  expect(dispatchRes.status()).toBe(200)
  const dispatch = (await dispatchRes.json()) as {
    claimed: number
    sessionCreated: number
    skipped: number
    runs: Array<{ runId: string; sessionId: string; scheduledFor: string }>
  }
  expect(dispatch.claimed).toBe(1)
  expect(dispatch.sessionCreated).toBe(1)
  expect(dispatch.skipped).toBe(0)
  const sessionId = dispatch.runs[0]?.sessionId
  expect(sessionId).toBeTruthy()

  const runsRes = await api.get(`/api/v1/triggers/${trigger.id}/runs`)
  expect(runsRes.status()).toBe(200)
  const runs = (await runsRes.json()) as {
    data: Array<{ id: string; sessionId: string; state: string; scheduledFor: string; idempotencyKey: string }>
  }
  expect(runs.data).toHaveLength(1)
  const run = runs.data[0] as Json
  expect(run.sessionId).toBe(sessionId)
  expect(run.state).toBe('session_created')
  expect(run.scheduledFor).toBe(dueAt)
  expect(run.idempotencyKey).toBe(`${trigger.id}:${dueAt}`)
  expect(JSON.stringify(run)).not.toContain('"status"')
})
