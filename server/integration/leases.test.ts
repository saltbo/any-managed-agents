import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { runtimeProviderModelCapability } from '@server/domain/runtime-catalog'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupOidcProvider, signIn } from './auth'

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
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Self-hosted workspace ${crypto.randomUUID()}`,
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Runner-backed agent ${crypto.randomUUID()}`,
      instructions: 'Use AMA-owned self-hosted runner work.',
      tools: [{ name: 'sandbox.exec' }],
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createSessionSecretEnv(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: `Runner runtime secrets ${crypto.randomUUID()}` }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'AK agent session key',
      type: 'session_env_secret',
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-ak-agent-key' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as { id: string; activeVersion: { id: string } }
  return [
    { name: 'AK_AGENT_KEY', credentialRef: { credentialId: credential.id, versionId: credential.activeVersion.id } },
  ]
}

async function createSelfHostedSession(
  authorization: string,
  agentId: string,
  environmentId: string,
  executionOverrides: Record<string, unknown> = {},
) {
  const res = await jsonFetch('/api/v1/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      environmentId,
      initialPrompt: 'Run the first queued self-hosted task.',
      runtime: 'ama',
      ...executionOverrides,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; state: string; stateReason: string }
}

async function registerActiveRunner(
  authorization: string,
  environmentId: string,
  options: { capabilities?: string[]; maxConcurrent?: number } = {},
) {
  const capabilities = options.capabilities ?? [DEFAULT_AMA_RUNNER_CAPABILITY]
  const runnerRes = await jsonFetch('/api/v1/runners', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Lease runner ${crypto.randomUUID()}`,
      environmentId,
      capabilities,
      maxConcurrent: options.maxConcurrent ?? 2,
    }),
  })
  expect(runnerRes.status).toBe(201)
  const runner = (await runnerRes.json()) as { id: string }
  const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, authorization, {
    method: 'PUT',
    body: JSON.stringify({ state: 'active', currentLoad: 0, capabilities }),
  })
  expect(heartbeatRes.status).toBe(200)
  return runner
}

async function availableWorkItem(authorization: string, sessionId: string) {
  const res = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${sessionId}`, authorization)
  expect(res.status).toBe(200)
  const list = (await res.json()) as { data: Array<{ id: string }> }
  expect(list.data.length).toBeGreaterThan(0)
  return list.data[0]
}

async function claimLease(authorization: string, workItemId: string, runnerId: string, leaseDurationSeconds = 90) {
  return await jsonFetch('/api/v1/leases', authorization, {
    method: 'POST',
    body: JSON.stringify({ workItemId, runnerId, leaseDurationSeconds }),
  })
}

async function openLeaseChannel(authorization: string, leaseId: string) {
  const res = await SELF.fetch(`https://example.com/api/v1/leases/${leaseId}/channel`, {
    headers: { authorization, upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  expect(res.webSocket).toBeTruthy()
  const socket = res.webSocket as WebSocket
  socket.accept()
  return socket
}

describe('[CF] /api/v1/leases', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('claims a specific work item, opens the channel, renews, and completes the lease [spec: runners/lease-claim]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const secretEnv = await createSessionSecretEnv(authorization)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, {
      env: { AK_API_URL: 'https://ak.example.test' },
      secretEnv,
    })

    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as Record<string, unknown>
    expect(lease).toMatchObject({
      workItemId: workItem.id,
      runnerId: runner.id,
      state: 'active',
      expiresAt: expect.any(String),
      renewedAt: null,
      resumeToken: null,
    })
    // The lease no longer embeds the work item: details come from /work-items.
    expect(lease.workItem).toBeUndefined()
    const leaseId = lease.id as string

    const leasedWorkRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    expect(leasedWorkRes.status).toBe(200)
    const leasedWork = (await leasedWorkRes.json()) as {
      state: string
      attempts: number
      leaseId: string
      runnerId: string
      payload: { runtimeEnv?: Record<string, string> }
    }
    expect(leasedWork).toMatchObject({ state: 'leased', attempts: 1, leaseId, runnerId: runner.id })
    // The leasing runner receives the materialized payload with vault secret
    // env resolved into runtimeEnv.
    expect(leasedWork.payload.runtimeEnv).toMatchObject({
      AK_API_URL: 'https://ak.example.test',
      AK_AGENT_KEY: 'raw-ak-agent-key',
    })

    // The same item cannot be claimed twice.
    const conflictRes = await claimLease(authorization, workItem.id, runner.id)
    expect(conflictRes.status).toBe(409)

    const channel = await openLeaseChannel(authorization, leaseId)
    const runningSessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(runningSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      state: 'running',
      stateReason: null,
    })

    const renewRes = await jsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ leaseDurationSeconds: 120 }),
    })
    expect(renewRes.status).toBe(200)
    await expect(renewRes.json()).resolves.toMatchObject({
      id: leaseId,
      state: 'active',
      renewedAt: expect.any(String),
    })

    const explicitExpiry = new Date(Date.now() + 120_000).toISOString()
    const renewByExpiryRes = await jsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ expiresAt: explicitExpiry }),
    })
    expect(renewByExpiryRes.status).toBe(200)
    await expect(renewByExpiryRes.json()).resolves.toMatchObject({ id: leaseId, expiresAt: explicitExpiry })

    const completeRes = await jsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)
    const completedLease = (await completeRes.json()) as Record<string, unknown>
    expect(completedLease).toMatchObject({ id: leaseId, state: 'completed' })
    // Outcomes land on the work item, not the lease.
    expect(completedLease.result).toBeUndefined()

    const succeededWorkRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    await expect(succeededWorkRes.json()).resolves.toMatchObject({
      id: workItem.id,
      state: 'succeeded',
      result: { ok: true },
    })

    const completedSessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(completedSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      state: 'idle',
      stateReason: null,
    })
    channel.close()
  })

  it('rejects claims for inactive runners, missing work, and over-capacity runners', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)

    const offlineRunnerRes = await jsonFetch('/api/v1/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Offline runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const offlineRunner = (await offlineRunnerRes.json()) as { id: string }
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)

    const inactiveClaimRes = await claimLease(authorization, workItem.id, offlineRunner.id)
    expect(inactiveClaimRes.status).toBe(409)
    await expect(inactiveClaimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is not active' },
    })

    const runner = await registerActiveRunner(authorization, environment.id, { maxConcurrent: 1 })
    const missingClaimRes = await claimLease(authorization, 'work_missing', runner.id)
    expect(missingClaimRes.status).toBe(404)

    const missingRunnerClaimRes = await claimLease(authorization, workItem.id, 'runner_missing')
    expect(missingRunnerClaimRes.status).toBe(404)

    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)

    const secondSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const secondWorkItem = await availableWorkItem(authorization, secondSession.id)
    const capacityClaimRes = await claimLease(authorization, secondWorkItem.id, runner.id)
    expect(capacityClaimRes.status).toBe(409)
    await expect(capacityClaimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is at capacity' },
    })
  })

  it('rejects claims when runner capabilities do not match the required runtime', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    // Queue the work before any runner exists so session creation does not gate
    // on runner eligibility; the capability mismatch is enforced at claim time.
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const runner = await registerActiveRunner(authorization, environment.id, { capabilities: ['node'] })
    const workItem = await availableWorkItem(authorization, session.id)

    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(409)
    await expect(claimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is not eligible for this work item' },
    })
  })

  it('requeues interrupted work with the freshest resume token [spec: runners/lease-recovery]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id, {
      capabilities: ['claude-code'],
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, { runtime: 'claude-code' })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const channel = await openLeaseChannel(authorization, lease.id)
    channel.close()

    const renewRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'active', leaseDurationSeconds: 90, resumeToken: 'runtime-resume-1' }),
    })
    expect(renewRes.status).toBe(200)
    await expect(renewRes.json()).resolves.toMatchObject({ id: lease.id, resumeToken: 'runtime-resume-1' })

    const interruptRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'interrupted', resumeToken: 'runtime-resume-2' }),
    })
    expect(interruptRes.status).toBe(200)
    await expect(interruptRes.json()).resolves.toMatchObject({
      id: lease.id,
      state: 'expired',
      resumeToken: 'runtime-resume-2',
    })

    const requeuedRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    const requeued = (await requeuedRes.json()) as {
      state: string
      payload: Record<string, unknown>
      runnerId: string | null
    }
    expect(requeued).toMatchObject({ state: 'available', runnerId: null })
    expect(requeued.payload).toMatchObject({ resume: true, resumeToken: 'runtime-resume-2' })

    const sessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(sessionRes.json()).resolves.toMatchObject({
      id: session.id,
      state: 'pending',
      stateReason: 'waiting-for-runner-recovery',
    })
  })

  it('marks failed work and surfaces the error on the work item and session [spec: runners/lease-lifecycle]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const failRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'failed', error: { message: 'Command failed' } }),
    })
    expect(failRes.status).toBe(200)
    await expect(failRes.json()).resolves.toMatchObject({ id: lease.id, state: 'failed' })

    const failedWorkRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    await expect(failedWorkRes.json()).resolves.toMatchObject({
      id: workItem.id,
      state: 'failed',
      error: { message: 'Command failed' },
    })

    const sessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(sessionRes.json()).resolves.toMatchObject({
      id: session.id,
      state: 'error',
      stateReason: 'runner-failed',
    })

    // A finished lease can no longer be renewed or completed again.
    const staleRenewRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ leaseDurationSeconds: 60 }),
    })
    expect(staleRenewRes.status).toBe(409)
  })

  it('returns expired leases to available work predictably', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const expired = new Date(Date.now() - 60_000).toISOString()
    await env.DB.prepare('UPDATE leases SET expires_at = ? WHERE id = ?').bind(expired, lease.id).run()

    // Any queue read sweeps stale leases back to available work.
    const sweptRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    expect(sweptRes.status).toBe(200)
    const listRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}`, authorization)
    const list = (await listRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(list.data).toEqual([expect.objectContaining({ id: workItem.id, state: 'available' })])

    const expiredLeaseRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization)
    expect(expiredLeaseRes.status).toBe(200)
    await expect(expiredLeaseRes.json()).resolves.toMatchObject({ id: lease.id, state: 'expired' })

    // The runner can claim the recovered work again.
    const reclaimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(reclaimRes.status).toBe(201)
    const reclaimed = (await reclaimRes.json()) as { id: string }
    expect(reclaimed.id).not.toBe(lease.id)
  })

  it('filters lease lists by runner and state', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const otherRunner = await registerActiveRunner(authorization, environment.id)

    const firstSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const firstWorkItem = await availableWorkItem(authorization, firstSession.id)
    const firstClaim = await claimLease(authorization, firstWorkItem.id, runner.id)
    expect(firstClaim.status).toBe(201)
    const firstLease = (await firstClaim.json()) as { id: string }

    const secondSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const secondWorkItem = await availableWorkItem(authorization, secondSession.id)
    const secondClaim = await claimLease(authorization, secondWorkItem.id, otherRunner.id)
    expect(secondClaim.status).toBe(201)
    const secondLease = (await secondClaim.json()) as { id: string }

    const completeRes = await jsonFetch(`/api/v1/leases/${secondLease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)

    const runnerListRes = await jsonFetch(`/api/v1/leases?runnerId=${runner.id}`, authorization)
    const runnerList = (await runnerListRes.json()) as { data: Array<{ id: string }> }
    expect(runnerList.data.map((entry) => entry.id)).toEqual([firstLease.id])

    const activeListRes = await jsonFetch('/api/v1/leases?state=active', authorization)
    const activeList = (await activeListRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(activeList.data.map((entry) => entry.id)).toContain(firstLease.id)
    expect(activeList.data.map((entry) => entry.id)).not.toContain(secondLease.id)

    const completedListRes = await jsonFetch(`/api/v1/leases?runnerId=${otherRunner.id}&state=completed`, authorization)
    const completedList = (await completedListRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(completedList.data).toEqual([expect.objectContaining({ id: secondLease.id, state: 'completed' })])
  })

  it('guards the lease channel against non-upgrade requests and finished leases', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const noUpgradeRes = await jsonFetch(`/api/v1/leases/${lease.id}/channel`, authorization)
    expect(noUpgradeRes.status).toBe(426)

    const missingLeaseRes = await SELF.fetch('https://example.com/api/v1/leases/lease_missing/channel', {
      headers: { authorization, upgrade: 'websocket' },
    })
    expect(missingLeaseRes.status).toBe(404)

    const completeRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)

    const staleChannelRes = await SELF.fetch(`https://example.com/api/v1/leases/${lease.id}/channel`, {
      headers: { authorization, upgrade: 'websocket' },
    })
    expect(staleChannelRes.status).toBe(409)
    await expect(staleChannelRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner lease no longer owns a self-hosted session' },
    })
  })
})
