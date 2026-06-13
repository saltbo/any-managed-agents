import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: runners/heartbeat]
test('registers a runner, sends a heartbeat, and appears active in the list [spec: runners/heartbeat]', async ({
  api,
  runId,
}) => {
  // Register the runner (no environment or credential required for the happy path).
  const runnerRes = await api.post('/api/v1/runners', {
    data: {
      name: `${runId} local runner`,
      capabilities: ['node', 'git', 'sandbox.exec'],
      maxConcurrent: 2,
      metadata: { pool: 'default' },
    },
  })
  expect(runnerRes.status(), 'POST /api/v1/runners').toBe(201)
  const runner = (await runnerRes.json()) as Json
  expect(typeof runner.id).toBe('string')
  expect(runner.state).toBe('offline')
  expect(runner.lastHeartbeatAt).toBeNull()
  expect(runner.archivedAt).toBeNull()
  const runnerId = runner.id as string

  // Send a heartbeat to bring the runner active.
  const heartbeatRes = await api.put(`/api/v1/runners/${runnerId}/heartbeat`, {
    data: {
      state: 'active',
      currentLoad: 0,
      capabilities: ['node', 'git', 'sandbox.exec'],
      runtimeInventory: [{ runtime: 'claude-code', version: '2.0.1', state: 'ready' }],
    },
  })
  expect(heartbeatRes.status(), `PUT /api/v1/runners/${runnerId}/heartbeat`).toBe(200)
  const heartbeat = (await heartbeatRes.json()) as Json
  expect(heartbeat.runnerId).toBe(runnerId)
  expect(heartbeat.state).toBe('active')
  expect(typeof heartbeat.lastHeartbeatAt).toBe('string')

  // List runners and confirm this runner appears as active.
  const listRes = await api.get('/api/v1/runners')
  expect(listRes.status(), 'GET /api/v1/runners').toBe(200)
  const list = (await listRes.json()) as { data: Json[] }
  const found = list.data.find((row) => row.id === runnerId)
  expect(found, `runner ${runnerId} must appear in GET /api/v1/runners`).toBeTruthy()
  expect((found as Json).state).toBe('active')
})
