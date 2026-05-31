import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { runtimeProviderModelCapability } from '../runtime/catalog'
import { defaultClaims, setupOidcProvider, signIn } from '../test/auth'

const DEFAULT_AMA_RUNNER_CAPABILITY = runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')

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
  const res = await jsonFetch('/api/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Self-hosted workspace ${crypto.randomUUID()}`,
      hostingMode: 'self_hosted',
      runtime: 'ama',
      networkPolicy: { mode: 'unrestricted' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Runner-backed agent ${crypto.randomUUID()}`,
      instructions: 'Use AMA-owned self-hosted runner work.',
      allowedTools: ['sandbox.exec'],
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createSelfHostedSession(authorization: string, agentId: string, environmentId: string) {
  const res = await jsonFetch('/api/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      environmentId,
      initialPrompt: 'Run the first queued self-hosted task.',
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; status: string; statusReason: string; sandboxId: string | null }
}

describe('[CF] /api/runners', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('registers a runner, records heartbeats, leases queued self-hosted work, uploads events, and completes work', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)

    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local runner',
        environmentId: environment.id,
        capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
        credentialSecretRef: 'cloudflare-secret:self-hosted-runner-token',
        maxConcurrent: 2,
        metadata: { pool: 'default' },
      }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as {
      id: string
      status: string
      environmentId: string
      capabilities: string[]
      credentialSecretRef?: string
    }
    expect(runner).toMatchObject({
      status: 'offline',
      environmentId: environment.id,
      capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })
    expect(runner.credentialSecretRef).toBeUndefined()
    expect(JSON.stringify(runner)).not.toContain('self-hosted-runner-token')

    const heartbeatRes = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['node', 'git', 'sandbox.exec', 'workspace', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(heartbeatRes.status).toBe(200)
    await expect(heartbeatRes.json()).resolves.toMatchObject({
      id: runner.id,
      status: 'active',
      currentLoad: 0,
      lastHeartbeatAt: expect.any(String),
    })

    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    expect(session).toMatchObject({
      status: 'pending',
      statusReason: 'waiting-for-runner',
      sandboxId: null,
    })

    const workListRes = await jsonFetch(`/api/runners/work-items?sessionId=${session.id}`, authorization)
    expect(workListRes.status).toBe(200)
    const workList = (await workListRes.json()) as {
      data: Array<{ id: string; status: string; payload: Record<string, unknown> }>
    }
    expect(workList.data).toEqual([
      expect.objectContaining({
        status: 'available',
        payload: expect.objectContaining({
          protocol: 'ama-runner-work',
          type: 'session.start',
          sessionId: session.id,
          hostingMode: 'self_hosted',
          runtime: 'ama',
          runtimeDriver: 'ama-self-hosted',
          provider: 'workers-ai',
          model: '@cf/moonshotai/kimi-k2.6',
        }),
      }),
    ])
    expect(JSON.stringify(workList.data)).not.toContain('runtimeOwner')

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as {
      id: string
      status: string
      workItem: { id: string; status: string; attempts: number; sessionId: string }
    }
    expect(lease).toMatchObject({
      status: 'active',
      workItem: {
        status: 'leased',
        attempts: 1,
        sessionId: session.id,
      },
    })

    const runningSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(runningSessionRes.json()).resolves.toMatchObject({ id: session.id, status: 'running' })

    const eventsRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'tool_execution_start',
            payload: {
              toolCallId: 'call_1',
              toolName: 'sandbox.exec',
              input: { command: 'npm test', token: 'raw-secret-value' },
            },
            metadata: { runnerId: runner.id },
          },
        ],
      }),
    })
    expect(eventsRes.status).toBe(202)
    await expect(eventsRes.json()).resolves.toEqual({ accepted: 1 })

    const renewRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', leaseDurationSeconds: 120 }),
    })
    expect(renewRes.status).toBe(200)
    await expect(renewRes.json()).resolves.toMatchObject({
      id: lease.id,
      status: 'active',
      renewedAt: expect.any(String),
    })

    const completeRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)
    await expect(completeRes.json()).resolves.toMatchObject({
      id: lease.id,
      status: 'completed',
      result: { ok: true },
      workItem: { status: 'succeeded' },
    })

    const completedSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(completedSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'idle',
      statusReason: null,
    })

    const sessionEventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    expect(sessionEventsRes.status).toBe(200)
    const sessionEvents = (await sessionEventsRes.json()) as {
      data: Array<{ type: string; metadata: Record<string, unknown> }>
    }
    expect(sessionEvents.data).toEqual([
      expect.objectContaining({
        type: 'tool_call.started',
        metadata: expect.objectContaining({ source: 'self-hosted-runner', runnerId: runner.id }),
      }),
    ])
    expect(JSON.stringify(sessionEvents.data)).not.toContain('raw-secret-value')
  })

  it('rejects runner credential secret references that are not safe references', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)

    const rawSecretRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Raw credential runner',
        environmentId: environment.id,
        credentialSecretRef: 'raw-runner-token',
      }),
    })
    expect(rawSecretRes.status).toBe(400)
    const rawSecretBody = await rawSecretRes.json()
    expect(rawSecretBody).toMatchObject({
      error: { type: 'validation_error' },
    })
    expect(JSON.stringify(rawSecretBody)).not.toContain('raw-runner-token')
    const rejectedCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM runners WHERE name = ?')
      .bind('Raw credential runner')
      .first<{ count: number }>()
    expect(rejectedCount?.count).toBe(0)

    const paddedRefRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Padded credential runner',
        environmentId: environment.id,
        credentialSecretRef: ' cloudflare-secret:runner-token ',
      }),
    })
    expect(paddedRefRes.status).toBe(400)

    const safeRefRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Safe credential runner',
        environmentId: environment.id,
        credentialSecretRef: 'cloudflare-secret:runner-token',
      }),
    })
    expect(safeRefRes.status).toBe(201)
    const runner = (await safeRefRes.json()) as { id: string; credentialSecretRef?: string }
    expect(runner.credentialSecretRef).toBeUndefined()
    const persisted = await env.DB.prepare(
      'SELECT credential_secret_ref AS credentialSecretRef FROM runners WHERE id = ?',
    )
      .bind(runner.id)
      .first<{ credentialSecretRef: string | null }>()
    expect(persisted?.credentialSecretRef).toBe('cloudflare-secret:runner-token')
  })

  it('skips queued work when runner capabilities do not exactly match the required runtime provider model', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const exactCapability = runtimeProviderModelCapability('codex', 'provider_codex', 'gpt-5.3-codex')
    const nearCapability = runtimeProviderModelCapability('codex', 'provider_codex', 'gpt-5.3-codex-mini')

    const wrongRunnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Near-match runner',
        environmentId: environment.id,
        capabilities: [nearCapability],
      }),
    })
    expect(wrongRunnerRes.status).toBe(201)
    const wrongRunner = (await wrongRunnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${wrongRunner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', capabilities: [nearCapability] }),
    })

    const exactRunnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Exact-match runner',
        environmentId: environment.id,
        capabilities: [exactCapability],
      }),
    })
    expect(exactRunnerRes.status).toBe(201)
    const exactRunner = (await exactRunnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${exactRunner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', capabilities: [exactCapability] }),
    })

    const environmentRow = await env.DB.prepare('SELECT project_id AS projectId FROM environments WHERE id = ?')
      .bind(environment.id)
      .first<{ projectId: string }>()
    expect(environmentRow?.projectId).toEqual(expect.any(String))

    const timestamp = new Date().toISOString()
    const workId = `work_${crypto.randomUUID().replaceAll('-', '')}`
    await env.DB.prepare(
      `INSERT INTO runner_work_items (
        id, organization_id, project_id, session_id, environment_id, runner_id, lease_id,
        type, status, priority, attempts, max_attempts, payload, result, error,
        available_at, lease_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
    )
      .bind(
        workId,
        defaultClaims().org_id,
        environmentRow?.projectId,
        environment.id,
        'session.start',
        'available',
        0,
        0,
        3,
        JSON.stringify({ requiredRunnerCapability: exactCapability }),
        timestamp,
        timestamp,
        timestamp,
      )
      .run()

    const wrongLeaseRes = await jsonFetch(`/api/runners/${wrongRunner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(wrongLeaseRes.status).toBe(204)

    const exactLeaseRes = await jsonFetch(`/api/runners/${exactRunner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(exactLeaseRes.status).toBe(201)
    await expect(exactLeaseRes.json()).resolves.toMatchObject({
      workItem: {
        id: workId,
        status: 'leased',
      },
    })
  })

  it('returns expired runner leases to available work predictably', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Expiry runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string; workItem: { id: string } }
    await env.DB.prepare('UPDATE runner_work_leases SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', lease.id)
      .run()

    const listRes = await jsonFetch(`/api/runners/work-items?sessionId=${session.id}`, authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string; status: string; leaseId: string | null }> }
    expect(list.data).toEqual([
      expect.objectContaining({
        id: lease.workItem.id,
        status: 'available',
        leaseId: null,
      }),
    ])
    const releasedRunnerRes = await jsonFetch(`/api/runners/${runner.id}`, authorization)
    await expect(releasedRunnerRes.json()).resolves.toMatchObject({ currentLoad: 0 })

    const reclaimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(reclaimRes.status).toBe(201)
    const readSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(readSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'running',
      statusReason: null,
    })
  })

  it('does not let disabled runners heartbeat themselves active or claim work', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Disabled runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const disableRes = await jsonFetch(`/api/runners/${runner.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(disableRes.status).toBe(200)

    const heartbeatRes = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    expect(heartbeatRes.status).toBe(409)
    await expect(heartbeatRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Disabled runners cannot heartbeat until re-enabled by an operator',
      },
    })

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(409)
  })

  it('rejects stale leases that no longer own the work item', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ownership runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string; workItem: { id: string } }
    await env.DB.prepare('UPDATE runner_work_items SET lease_id = ? WHERE id = ?')
      .bind('lease_other', lease.workItem.id)
      .run()

    const eventsRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [{ type: 'tool_call.started', payload: { toolCall: { id: 'call_1', name: 'sandbox.exec' } } }],
      }),
    })
    expect(eventsRes.status).toBe(409)

    const renewRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', leaseDurationSeconds: 120 }),
    })
    expect(renewRes.status).toBe(409)

    const completeRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(409)
    const leaseRow = await env.DB.prepare('SELECT status FROM runner_work_leases WHERE id = ?').bind(lease.id).first()
    expect(leaseRow?.status).toBe('active')
  })

  it('keeps runner capacity bounded when concurrent claims race', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Capacity runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
        maxConcurrent: 1,
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0 }),
    })
    await createSelfHostedSession(authorization, agent.id, environment.id)
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const [first, second] = await Promise.all([
      jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    ])
    expect([first.status, second.status].sort()).toEqual([201, 204])
    const leases = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM runner_work_leases WHERE runner_id = ? AND status = ?',
    )
      .bind(runner.id, 'active')
      .first<{ count: number }>()
    expect(leases?.count).toBe(1)
    const updatedRunnerRes = await jsonFetch(`/api/runners/${runner.id}`, authorization)
    await expect(updatedRunnerRes.json()).resolves.toMatchObject({ currentLoad: 1 })
  })

  it('increments runner load from the database value across multiple claims', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Two slot capacity runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
        maxConcurrent: 2,
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0 }),
    })
    await createSelfHostedSession(authorization, agent.id, environment.id)
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const first = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const second = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const updatedRunnerRes = await jsonFetch(`/api/runners/${runner.id}`, authorization)
    await expect(updatedRunnerRes.json()).resolves.toMatchObject({ currentLoad: 2 })
  })
})
