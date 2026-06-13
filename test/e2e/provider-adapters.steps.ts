import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import {
  createAgent,
  createEnvironment,
  createProvider,
  createProviderModel,
  createSession,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
  waitForSessionEventMatch,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'
const RUNTIME_WORKERS_AI_PROVIDER = 'cloudflare-workers-ai'
const PROVIDER_ERROR_CATEGORIES = [
  'auth',
  'quota',
  'rate_limit',
  'model_unavailable',
  'invalid_request',
  'network',
  'unknown',
]
// Test-runtime prompts that make the (simulated) provider call fail with a
// raw provider-shaped error; the adapter must normalize each into the
// expected stable category before anything is persisted.
const SIMULATED_FAILURES: Array<{ prompt: string; category: string }> = [
  { prompt: 'simulate provider auth error', category: 'auth' },
  { prompt: 'simulate provider rate limit error', category: 'rate_limit' },
  { prompt: 'simulate provider model unavailable error', category: 'model_unavailable' },
  { prompt: 'simulate provider invalid request error', category: 'invalid_request' },
  { prompt: 'simulate provider network error', category: 'network' },
]
const RAW_PROVIDER_ERROR_MARKER = 'raw-provider-error-detail'

type AdapterWorld = StepsWorld & {
  usageEvent?: Json
  usageEvents?: Json[]
  providerErrorEvent?: Json
  providerErrorEvents?: Array<{ category: string; payload: Json }>
  policyEvaluation?: Json
}

function eventPayload(event: Json): Json {
  const payload = event.payload
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Json) : {}
}

async function sendPrompt(state: E2EState, content: string) {
  await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.latestSession?.id}/messages`, {
    method: 'POST',
    data: { type: 'prompt', content },
  })
}

// Failing turns surface the normalized provider error on the message
// response itself; the canonical events are still persisted, so the step
// tolerates the non-2xx status and inspects the event stream.
async function sendFailingPrompt(state: E2EState, content: string) {
  await apiResponse(state.page.request, `/api/v1/sessions/${state.latestSession?.id}/messages`, {
    method: 'POST',
    data: { type: 'prompt', content },
  })
}

async function createWorkersAiSession(state: E2EState, label: string) {
  state.agent ??= await createAgent(state, {
    name: `${state.runId} ${label} agent`,
    model: WORKERS_AI_MODEL,
  })
  state.environment ??= await createEnvironment(state, { name: `${state.runId} ${label} env` })
  state.latestSession = await createSession(state, { title: `${state.runId} ${label} session` })
  return state.latestSession
}

async function runPromptTurnAndCollectUsage(state: E2EState, message: string) {
  await sendPrompt(state, message)
  return await waitForSessionEventMatch(state, (event) => event.type === 'usage.recorded', 'a usage.recorded event')
}

async function runFailingTurnAndCollectError(state: E2EState, prompt: string) {
  await sendFailingPrompt(state, prompt)
  return await waitForSessionEventMatch(
    state,
    (event) => event.type === 'runtime.error' && typeof eventPayload(event).category === 'string',
    'a categorized runtime.error event',
  )
}

async function usageRecordsForSession(state: E2EState) {
  return await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/usage-records?sessionId=${state.latestSession?.id}&limit=100`,
  )
}

// ─── Scenario: Use Workers AI as a first-class provider ─────────────────────

When('an agent selects a Workers AI model', async function (this: AdapterWorld) {
  const state = await ensureSignedIn(this)
  await createWorkersAiSession(state, 'workers-ai')
  this.usageEvent = await runPromptTurnAndCollectUsage(state, `${state.runId} workers-ai first-class turn`)
})

Then('the runtime calls the Cloudflare Workers AI binding', async function (this: AdapterWorld) {
  const state = this.e2e
  assert.ok(state && this.usageEvent, 'a Workers AI turn must have produced a usage event')
  const payload = eventPayload(this.usageEvent)
  assert.equal(
    payload.provider,
    RUNTIME_WORKERS_AI_PROVIDER,
    'runtime turn routed through the Workers AI binding provider',
  )
  assert.equal(payload.model, WORKERS_AI_MODEL, 'runtime turn used the selected Workers AI model')
  const session = await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.latestSession?.id}`)
  const runtimeMetadata = session.runtimeMetadata as Json
  assert.equal(runtimeMetadata.provider, 'workers-ai', 'session runtime metadata pins the Workers AI provider')
  assert.equal(runtimeMetadata.model, WORKERS_AI_MODEL, 'session runtime metadata pins the selected model')
})

Then('usage is attributed to the project and session', async function (this: AdapterWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const records = await usageRecordsForSession(state)
  const modelRecords = records.data.filter((record) => record.usageType === 'model')
  assert.ok(modelRecords.length >= 1, 'the turn produced at least one model usage record')
  const project = (state.auth?.project ?? {}) as Json
  for (const record of modelRecords) {
    assert.equal(record.projectId, project.id, 'usage is attributed to the project')
    assert.equal(record.sessionId, state.latestSession?.id, 'usage is attributed to the session')
    assert.ok(Number(record.totalTokens) > 0, 'usage carries the recorded token totals')
  }
})

// ─── Scenario: Route through provider adapters ───────────────────────────────

When('a session requests any configured provider', async function (this: AdapterWorld) {
  const state = await ensureSignedIn(this)
  state.provider = await createProvider(state, {
    type: 'workers-ai',
    displayName: `${state.runId} configured workers ai`,
  })
  await createWorkersAiSession(state, 'adapter-route')
  this.usageEvent = await runPromptTurnAndCollectUsage(state, `${state.runId} adapter route turn`)
  // A second session exercises the same adapter seam on the failure path.
  state.latestSession = await createSession(state, { title: `${state.runId} adapter failure session` })
  this.providerErrorEvent = await runFailingTurnAndCollectError(state, 'simulate provider rate limit error')
})

Then('the runtime uses the provider adapter for that provider', function (this: AdapterWorld) {
  assert.ok(this.usageEvent && this.providerErrorEvent, 'adapter turns must have produced usage and error events')
  const usage = eventPayload(this.usageEvent)
  assert.equal(usage.provider, RUNTIME_WORKERS_AI_PROVIDER, 'usage extraction ran for the requested provider')
  assert.ok(typeof usage.promptTokens === 'number', 'adapter produced normalized prompt token usage')
  assert.ok(typeof usage.completionTokens === 'number', 'adapter produced normalized completion token usage')
  const error = eventPayload(this.providerErrorEvent)
  assert.equal(error.category, 'rate_limit', 'the raw provider failure was normalized by the provider adapter')
  assert.equal(error.provider, RUNTIME_WORKERS_AI_PROVIDER, 'the normalized error names the routed provider')
})

Then('usage, errors, and policy decisions are normalized across providers', async function (this: AdapterWorld) {
  const state = this.e2e
  assert.ok(state && this.usageEvent && this.providerErrorEvent, 'adapter evidence must exist')
  const usageSerialized = JSON.stringify(eventPayload(this.usageEvent))
  assert.ok(!usageSerialized.includes('prompt_tokens'), 'usage events never expose provider wire-format usage keys')
  assert.ok(!usageSerialized.includes('prompt_eval_count'), 'usage events never expose Ollama wire-format usage keys')
  const error = eventPayload(this.providerErrorEvent)
  assert.ok(
    PROVIDER_ERROR_CATEGORIES.includes(String(error.category)),
    'runtime errors carry a stable provider error category',
  )
  assert.equal(typeof error.retryable, 'boolean', 'runtime errors carry normalized retry metadata')
  const effective = await apiJson<Json>(
    state.page.request,
    `/api/v1/effective-policy?providerId=workers-ai&modelId=${encodeURIComponent(WORKERS_AI_MODEL)}`,
  )
  const decision = (effective.decision ?? {}) as Json
  assert.equal(decision.allowed, true, 'policy evaluation returns a normalized decision')
  assert.ok(typeof decision.category === 'string', 'policy decisions carry a category')
  assert.ok(typeof decision.message === 'string', 'policy decisions carry a safe message')
  this.policyEvaluation = decision
})

// ─── Scenario: Track model usage and cost ────────────────────────────────────

When('a provider returns token or usage metadata', async function (this: AdapterWorld) {
  const state = await ensureSignedIn(this)
  state.provider = await createProvider(state, {
    type: 'workers-ai',
    displayName: `${state.runId} priced workers ai`,
  })
  state.providerModel = await createProviderModel(state, state.provider, {
    modelId: WORKERS_AI_MODEL,
    displayName: 'Priced Kimi',
    capabilities: ['text'],
    pricing: { inputMicrosPerToken: 7, outputMicrosPerToken: 11 },
  })
  await createWorkersAiSession(state, 'usage-cost')
  this.usageEvent = await runPromptTurnAndCollectUsage(state, `${state.runId} priced usage turn`)
})

Then(
  'the platform records usage by organization, project, agent, session, provider, and model',
  async function (this: AdapterWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const records = await usageRecordsForSession(state)
    const record = records.data.find((candidate) => candidate.usageType === 'model')
    assert.ok(record, 'a model usage record was written for the turn')
    const auth = (state.auth ?? {}) as Json
    // Usage records no longer expose organizationId (projectId already determines
    // the organization); attribution is verified through projectId downward.
    assert.equal(record.projectId, (auth.project as Json | undefined)?.id, 'usage records the project')
    assert.equal(record.agentId, state.agent?.id, 'usage records the agent')
    assert.equal(record.sessionId, state.latestSession?.id, 'usage records the session')
    assert.equal(record.providerId, state.provider?.id, 'usage resolves the configured provider')
    assert.equal(record.modelId, WORKERS_AI_MODEL, 'usage records the model')
    // Cost comes from the configured model pricing metadata.
    const expectedCost = Number(record.promptTokens) * 7 + Number(record.completionTokens) * 11
    assert.ok(expectedCost > 0, 'the turn recorded non-zero token usage')
    assert.equal(Number(record.costMicros), expectedCost, 'cost is computed from model pricing metadata')
    assert.equal((record.metadata as Json | undefined)?.costSource, 'model_pricing', 'cost source is the model catalog')
  },
)

// ─── Scenario: Normalize provider error categories ───────────────────────────

When(
  'any provider returns authentication, rate limit, overload, invalid model, safety, or network errors',
  async function (this: AdapterWorld) {
    const state = await ensureSignedIn(this)
    state.agent = await createAgent(state, {
      name: `${state.runId} error matrix agent`,
      model: WORKERS_AI_MODEL,
    })
    state.environment = await createEnvironment(state, { name: `${state.runId} error matrix env` })
    this.providerErrorEvents = []
    for (const failure of SIMULATED_FAILURES) {
      state.latestSession = await createSession(state, { title: `${state.runId} ${failure.category} session` })
      const event = await runFailingTurnAndCollectError(state, failure.prompt)
      this.providerErrorEvents.push({ category: failure.category, payload: eventPayload(event) })
    }
  },
)

Then('the runtime records a normalized error type', function (this: AdapterWorld) {
  assert.ok(this.providerErrorEvents?.length, 'provider failures must have been recorded')
  for (const { category, payload } of this.providerErrorEvents) {
    assert.equal(payload.category, category, `the ${category} failure normalized to its stable category`)
    assert.ok(
      PROVIDER_ERROR_CATEGORIES.includes(String(payload.category)),
      'every recorded category is part of the stable enum',
    )
  }
})

Then('user-facing messages are safe and actionable', function (this: AdapterWorld) {
  assert.ok(this.providerErrorEvents?.length, 'provider failures must have been recorded')
  for (const { category, payload } of this.providerErrorEvents) {
    const serialized = JSON.stringify(payload)
    assert.ok(
      !serialized.includes(RAW_PROVIDER_ERROR_MARKER),
      `the raw ${category} provider payload never reaches the persisted event`,
    )
    assert.ok(!serialized.includes('sk-'), 'credential-shaped fragments never reach the persisted event')
    assert.ok(
      typeof payload.message === 'string' && payload.message.length > 20,
      'the normalized message is a human-actionable sentence',
    )
  }
})

Then('retryable errors include retry metadata when available', function (this: AdapterWorld) {
  assert.ok(this.providerErrorEvents?.length, 'provider failures must have been recorded')
  const byCategory = new Map(this.providerErrorEvents.map((entry) => [entry.category, entry.payload]))
  const rateLimit = byCategory.get('rate_limit')
  assert.ok(rateLimit, 'a rate limit failure was recorded')
  assert.equal(rateLimit.retryable, true, 'rate limit errors are retryable')
  assert.equal(rateLimit.retryAfterSeconds, 7, 'provider retry-after metadata is preserved')
  const network = byCategory.get('network')
  assert.ok(network, 'a network failure was recorded')
  assert.equal(network.retryable, true, 'network errors are retryable')
  const auth = byCategory.get('auth')
  assert.ok(auth, 'an auth failure was recorded')
  assert.equal(auth.retryable, false, 'credential failures are not retryable')
})

// ─── Scenario: Use provider adapters without changing session protocol ──────

Given('an agent uses any supported provider', async function (this: AdapterWorld) {
  const state = await ensureSignedIn(this)
  await createWorkersAiSession(state, 'protocol')
})

When('a session sends a runtime message', async function (this: AdapterWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  this.usageEvent = await runPromptTurnAndCollectUsage(state, `${state.runId} protocol invariance turn`)
})

Then(
  'provider-specific calls happen behind the selected session runtime adapter boundary',
  async function (this: AdapterWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const events = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/v1/sessions/${state.latestSession?.id}/events?limit=200`,
    )
    assert.ok(events.data.length > 0, 'the turn persisted canonical session events')
    const serialized = JSON.stringify(events.data)
    assert.ok(!serialized.includes('prompt_tokens'), 'provider wire-format usage keys stay behind the adapter')
    assert.ok(!serialized.includes('prompt_eval_count'), 'provider wire-format counters stay behind the adapter')
    assert.ok(!serialized.includes('cloudflare-ai-binding://'), 'provider transport details stay behind the adapter')
  },
)

Then(
  'clients continue to interact through the AMA session endpoint and canonical event protocol',
  async function (this: AdapterWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const connection = await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.latestSession?.id}/connection`)
    assert.equal(
      connection.path,
      `/api/v1/runtime/sessions/${state.latestSession?.id}/rpc`,
      'the session advertises only the AMA runtime endpoint',
    )
    const events = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/v1/sessions/${state.latestSession?.id}/events?limit=200`,
    )
    const canonicalTypes = new Set([
      'agent_start',
      'agent_end',
      'turn_start',
      'turn_end',
      'session_stop',
      'session_checkpoint',
      'session_resume',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'usage.recorded',
      'policy.decision',
      'runtime.error',
      'runtime.metadata',
      'runtime.output',
      'runner.metadata',
    ])
    for (const event of events.data) {
      assert.ok(canonicalTypes.has(String(event.type)), `event type ${event.type} is part of the canonical protocol`)
    }
  },
)
