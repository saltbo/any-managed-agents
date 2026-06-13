import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { apiJson, apiResponse, authenticateE2EPage, delay, openLocalPage, waitForSession } from './local-app'
import type { AmaWorld } from './world'

export type Json = Record<string, unknown>

export interface ListResponse<T> {
  data: T[]
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
}

export interface E2EState {
  page: Page
  auth?: Json
  runId: string
  agent?: Json
  environment?: Json
  provider?: Json
  providerModel?: Json
  latestSession?: Json
  previousSession?: Json
  runner?: Json
  lease?: Json
  events?: ListResponse<Json>
  list?: ListResponse<Json>
  response?: Json
  responseStatus?: number
  accessToken?: string
  sessionRuntime?: string
}

export type StepsWorld = AmaWorld & { e2e?: E2EState }

const DEFAULT_AMA_RUNNER_CAPABILITY = 'runtime-provider-model:ama:workers-ai:@cf/moonshotai/kimi-k2.6'

export async function ensureSignedIn(world: StepsWorld): Promise<E2EState> {
  if (world.e2e) return world.e2e
  const page = await openLocalPage()
  const auth = (await authenticateE2EPage(page)) as Json
  const accessToken = (await page.evaluate(() => window.localStorage.getItem('ama:e2e-access-token') ?? undefined)) as
    | string
    | undefined
  const state: E2EState = {
    page,
    auth,
    runId: `e2e-shared-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }
  if (accessToken !== undefined) state.accessToken = accessToken
  world.e2e = state
  return state
}

export async function ensureAgentAndEnvironment(world: StepsWorld): Promise<E2EState> {
  const state = await ensureSignedIn(world)
  state.agent ??= await createAgent(state, { name: `${state.runId} agent` })
  state.environment ??= await createEnvironment(state, { name: `${state.runId} env` })
  return state
}

export async function createAgent(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/v1/agents', {
    method: 'POST',
    data: {
      name: `${state.runId} agent`,
      instructions: 'E2E shared agent',
      ...data,
    },
  })
}

export async function createEnvironment(state: E2EState, data: Json = {}) {
  const { runtime, ...rest } = data
  if (typeof runtime === 'string') state.sessionRuntime = runtime
  return await apiJson<Json>(state.page.request, '/api/v1/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} env`,
      runtimeConfig: { image: 'ama-pi-runtime' },
      ...rest,
    },
  })
}

export async function createSession(state: E2EState, data: Json = {}) {
  const session = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      title: `${state.runId} session`,
      ...data,
      runtime: typeof data.runtime === 'string' ? data.runtime : (state.sessionRuntime ?? 'ama'),
    },
  })
  return await waitForSession(state.page.request, String(session.id))
}

export async function createProvider(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/v1/providers', {
    method: 'POST',
    data,
  })
}

// Model upsert moved from POST /models to PUT /models/{modelId}.
export async function createProviderModel(state: E2EState, provider: Json, data: Json = {}) {
  const modelId = String((data as { modelId?: string }).modelId)
  return await apiJson<Json>(
    state.page.request,
    `/api/v1/providers/${provider?.id}/models/${encodeURIComponent(modelId)}`,
    {
      method: 'PUT',
      data,
    },
  )
}

export async function sessionEvents(state: E2EState) {
  return await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/sessions/${state.latestSession?.id}/events?limit=200`,
  )
}

export async function waitForSessionEventMatch(state: E2EState, predicate: (event: Json) => boolean, label: string) {
  let latest: ListResponse<Json> | null = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(state)
    latest = events
    const match = events.data.find(predicate)
    if (match) {
      return match
    }
    await delay(500)
  }
  const observed = latest?.data.map((event) => `${event.sequence}:${event.type}`).join(', ')
  throw new Error(`Session ${state.latestSession?.id} did not persist ${label}. Event types: ${observed}`)
}

export async function createSelfHostedSession(state: E2EState) {
  state.environment ??= await createEnvironment(state, {
    name: `${state.runId} self-hosted env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent ??= await createAgent(state, { name: `${state.runId} self-hosted agent` })
  const session = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent.id,
      environmentId: state.environment.id,
      runtime: 'ama',
      title: `${state.runId} self-hosted session`,
    },
  })
  state.latestSession = session
  return session
}

export async function createAndActivateRunner(state: E2EState) {
  const runner = await apiJson<Json>(state.page.request, '/api/v1/runners', {
    method: 'POST',
    data: {
      name: `${state.runId} runner`,
      environmentId: state.environment?.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  // Heartbeat is now an idempotent PUT singleton; it returns the heartbeat
  // representation, so keep the runner row (which carries `id`) in state.
  await apiJson<Json>(state.page.request, `/api/v1/runners/${runner.id}/heartbeat`, {
    method: 'PUT',
    data: {
      state: 'active',
      currentLoad: 0,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    },
  })
  state.runner = runner
  return runner
}

// Two-step claim: discover an available work item, then create a lease for it.
export async function claimRunnerLease(state: E2EState) {
  assert.ok(state.runner, 'runner must exist')
  const sessionId = state.latestSession?.id
  const query = sessionId ? `?state=available&sessionId=${sessionId}` : '?state=available'
  const available = await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/work-items${query}`)
  const workItem = available.data[0]
  assert.ok(workItem, 'an available work item must exist to claim')
  const lease = await apiJson<Json>(state.page.request, '/api/v1/leases', {
    method: 'POST',
    data: { workItemId: workItem.id, runnerId: state.runner.id, leaseDurationSeconds: 90 },
  })
  state.lease = lease
  return lease
}

export async function stopSession(state: E2EState) {
  state.latestSession = await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.latestSession?.id}`, {
    method: 'PATCH',
    data: { state: 'stopped' },
  })
  return state.latestSession
}

// Event ingest is per-session now (was per-lease).
export async function uploadRunnerEvent(state: E2EState, event: Json) {
  assert.ok(state.lease, 'lease must exist')
  const sessionId = state.latestSession?.id
  assert.ok(sessionId, 'session must exist')
  return await apiJson<Json>(state.page.request, `/api/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    data: { events: [event] },
  })
}

export async function completeRunnerLease(state: E2EState, lifecycle: 'completed' | 'failed' | 'cancelled') {
  assert.ok(state.lease, 'lease must exist')
  return await apiJson<Json>(state.page.request, `/api/v1/leases/${state.lease.id}`, {
    method: 'PATCH',
    data: { state: lifecycle },
  })
}

export async function emptyApiResponse(state: E2EState, path: string, method: string, data?: Json) {
  const response = await apiResponse(state.page.request, path, { method, ...(data ? { data } : {}) })
  if (!response.ok()) {
    throw new Error(`${method} ${path} returned ${response.status()}: ${await response.text()}`)
  }
}

export { delay }
