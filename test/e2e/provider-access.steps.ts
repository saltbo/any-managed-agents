import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse, delay } from './local-app'
import {
  createAgent,
  createEnvironment,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

interface SessionAttempt {
  status: number
  body: Json
}

type AccessWorld = StepsWorld & {
  accessRule?: Json
  teamId?: string
  // Bearer token of the identity performing the session-creation attempt.
  // The e2e claim contract is `e2e:<runId>[;org=<orgRunId>][;teams=a,b][;roles=r1,r2]`.
  actorToken?: string
  adminToken?: string
  attempt?: SessionAttempt
}

function bearerHeaders(token: string) {
  return { authorization: `Bearer ${token}` }
}

// The org segment of the signed-in user's e2e token; secondary identities
// join the same organization (and therefore the same project) through the
// `org=` claim directive.
function orgRunIdOf(state: E2EState) {
  const accessToken = state.accessToken ?? ''
  assert.ok(accessToken.startsWith('e2e:'), 'the signed-in user must hold an e2e access token')
  return accessToken.slice('e2e:'.length).split(';')[0]
}

async function createAccessRule(state: E2EState, data: Json) {
  return await apiJson<Json>(state.page.request, '/api/governance/provider-access-rules', {
    method: 'POST',
    data,
  })
}

async function ensureWorkersAiAgentAndEnvironment(state: E2EState) {
  state.agent ??= await createAgent(state, {
    name: `${state.runId} access agent`,
    provider: 'workers-ai',
    model: WORKERS_AI_MODEL,
  })
  state.environment ??= await createEnvironment(state, { name: `${state.runId} access env` })
}

async function attemptSessionCreate(
  state: E2EState,
  headers: Record<string, string> | undefined,
  data: Json = {},
): Promise<SessionAttempt> {
  const response = await apiResponse(state.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: state.agent?.id,
      environmentId: state.environment?.id,
      runtime: 'ama',
      title: `${state.runId} access attempt session`,
      ...data,
    },
    ...(headers ? { headers } : {}),
  })
  const text = await response.text()
  return { status: response.status(), body: (text ? JSON.parse(text) : {}) as Json }
}

function attemptError(attempt: SessionAttempt | undefined) {
  assert.ok(attempt, 'a session-creation attempt must have been made')
  const error = (attempt.body.error ?? {}) as Json
  return { attempt, error, details: (error.details ?? {}) as Json }
}

async function assertNoSessionForAgent(state: E2EState) {
  const sessions = await apiJson<ListResponse<Json>>(state.page.request, '/api/sessions?limit=100')
  assert.ok(
    !sessions.data.some((session) => session.agentId === state.agent?.id),
    'no session row exists for the denied request',
  )
}

async function assertNoUsageForProject(state: E2EState) {
  const usage = await apiJson<ListResponse<Json>>(state.page.request, '/api/usage?limit=100')
  assert.equal(usage.data.length, 0, 'no model usage was recorded for the denied request')
}

async function waitForOwnedSessionStatus(state: E2EState, sessionId: string, expected: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await apiJson<Json>(state.page.request, `/api/sessions/${sessionId}`)
    if (session.status === expected) {
      return session
    }
    if (session.status === 'error') {
      throw new Error(`Session ${sessionId} failed to start: ${session.statusReason ?? 'unknown error'}`)
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not reach ${expected}`)
}

// ─── Scenario: Enforce provider access (project scope) ───────────────────────

Given('a provider is not allowed for a project', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  this.accessRule = await createAccessRule(state, {
    providerId: 'workers-ai',
    effect: 'deny',
    reason: `${state.runId} provider is not approved for this project`,
  })
})

When('a session requests that provider', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  await ensureWorkersAiAgentAndEnvironment(state)
  this.attempt = await attemptSessionCreate(state, undefined)
})

Then('the runtime rejects the request before contacting the provider', async function (this: AccessWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const { attempt, error, details } = attemptError(this.attempt)
  assert.equal(attempt.status, 403, 'the session request is rejected')
  assert.equal(error.type, 'policy_denied', 'the rejection uses the structured policy error envelope')
  assert.equal(details.ruleId, this.accessRule?.id, 'the rejection cites the governing access rule')
  assert.ok(String(error.message).includes(`${state.runId} provider is not approved`), 'the denial reason is surfaced')
  await assertNoSessionForAgent(state)
  await assertNoUsageForProject(state)
})

// ─── Scenario: Enforce provider policy (team-scoped models) ──────────────────

Given('a team is allowed to use only selected providers and models', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  this.teamId = `team-${state.runId}`
  this.accessRule = await createAccessRule(state, {
    providerId: 'workers-ai',
    modelId: WORKERS_AI_MODEL,
    teamId: this.teamId,
    effect: 'allow',
    reason: `${state.runId} provider and model are limited to the approved team`,
  })
})

When('an agent requests a blocked provider or model', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  await ensureWorkersAiAgentAndEnvironment(state)
  // The signed-in user carries no team claims, so the team-restricted
  // provider/model pair is blocked for them.
  this.attempt = await attemptSessionCreate(state, undefined)
})

Then('the request is rejected before a model call is started', async function (this: AccessWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const { attempt, error } = attemptError(this.attempt)
  assert.equal(attempt.status, 403, 'the session request is rejected')
  assert.equal(error.type, 'policy_denied', 'the rejection uses the structured policy error envelope')
  await assertNoSessionForAgent(state)
  await assertNoUsageForProject(state)
})

// ─── Scenario: Enforce team-scoped provider access ───────────────────────────

Given('a provider is allowed only for selected teams', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  this.teamId = `team-${state.runId}`
  this.accessRule = await createAccessRule(state, {
    providerId: 'workers-ai',
    teamId: this.teamId,
    effect: 'allow',
    reason: `${state.runId} provider is restricted to approved teams`,
  })
})

Given('a user is not a member of any allowed team', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  this.actorToken = `e2e:${state.runId}-outsider;org=${orgRunIdOf(state)}`
})

When('the user creates a session through an agent that uses the provider', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  assert.ok(this.actorToken, 'an actor identity must have been prepared')
  await ensureWorkersAiAgentAndEnvironment(state)
  this.attempt = await attemptSessionCreate(state, bearerHeaders(this.actorToken))
})

Then('the request is denied before model or sandbox work starts', async function (this: AccessWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const { attempt, error, details } = attemptError(this.attempt)
  assert.equal(attempt.status, 403, 'the session request is denied')
  assert.equal(error.type, 'policy_denied', 'the denial uses the structured policy error envelope')
  assert.equal(details.category, 'provider', 'the denial is categorized as a provider policy decision')
  await assertNoSessionForAgent(state)
  await assertNoUsageForProject(state)
})

Then(
  'the denial records the provider, policy rule, actor, and project without exposing credentials',
  async function (this: AccessWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const records = await apiJson<ListResponse<Json>>(
      state.page.request,
      '/api/audit-records?action=session.create&outcome=denied&limit=100',
    )
    const denial = records.data.find((record) => {
      const metadata = (record.metadata ?? {}) as Json
      return metadata.agentId === state.agent?.id && metadata.providerId === 'workers-ai'
    })
    assert.ok(denial, 'the denied session creation is audited')
    const metadata = (denial.metadata ?? {}) as Json
    const decision = (metadata.decision ?? {}) as Json
    assert.equal(decision.rule, this.accessRule?.id, 'the audit records the governing policy rule')
    assert.ok(typeof denial.actorUserId === 'string' && denial.actorUserId.length > 0, 'the audit records the actor')
    assert.equal(denial.projectId, (state.auth?.project as Json | undefined)?.id, 'the audit records the project')
    const serialized = JSON.stringify(denial)
    assert.ok(!serialized.includes('secret://'), 'the audit never exposes credential references')
    assert.ok(!serialized.includes('credentialSecretRef'), 'the audit never exposes credential fields')
  },
)

// ─── Scenario: Allow provider access through membership ──────────────────────

Given('a provider is allowed for a team', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  this.teamId = `team-${state.runId}`
  this.accessRule = await createAccessRule(state, {
    providerId: 'workers-ai',
    teamId: this.teamId,
    effect: 'allow',
    reason: `${state.runId} provider is available to the approved team`,
  })
})

Given('a user is a member of that team', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  assert.ok(this.teamId, 'a team-scoped rule must exist')
  this.actorToken = `e2e:${state.runId}-member;org=${orgRunIdOf(state)};teams=${this.teamId}`
})

Then('the session may start if every other policy check passes', async function (this: AccessWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  assert.ok(this.attempt, 'a session-creation attempt must have been made')
  assert.equal(this.attempt.status, 201, 'the team member may create the session')
  const sessionId = String(this.attempt.body.id)
  const session = await waitForOwnedSessionStatus(state, sessionId, 'idle')
  assert.equal(session.status, 'idle', 'the session started and reached an operational status')
})

// ─── Scenario: Admin override remains auditable ──────────────────────────────

Given('an organization admin uses a restricted provider', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  this.accessRule = await createAccessRule(state, {
    providerId: 'workers-ai',
    effect: 'deny',
    reason: `${state.runId} provider is restricted pending review`,
  })
  await ensureWorkersAiAgentAndEnvironment(state)
  this.adminToken = `e2e:${state.runId}-admin;org=${orgRunIdOf(state)};roles=admin`
})

When('policy allows admin override', async function (this: AccessWorld) {
  const state = await ensureSignedIn(this)
  assert.ok(this.adminToken, 'an admin identity must have been prepared')
  // The override flag is honored only for admin-role callers: the same
  // explicit request from a non-admin member stays denied.
  const memberToken = `e2e:${state.runId}-analyst;org=${orgRunIdOf(state)};roles=analyst`
  const denied = await attemptSessionCreate(state, bearerHeaders(memberToken), { providerAccessOverride: true })
  assert.equal(denied.status, 403, 'a non-admin explicit override request stays denied')
  this.attempt = await attemptSessionCreate(state, bearerHeaders(this.adminToken), { providerAccessOverride: true })
})

Then('the request succeeds', function (this: AccessWorld) {
  assert.ok(this.attempt, 'a session-creation attempt must have been made')
  assert.equal(this.attempt.status, 201, 'the admin override allows the session')
  assert.ok(typeof this.attempt.body.id === 'string', 'a session was created')
})

Then('the audit log records that override policy was used', async function (this: AccessWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const records = await apiJson<ListResponse<Json>>(
    state.page.request,
    '/api/audit-records?action=session.create&outcome=success&limit=100',
  )
  const override = records.data.find((record) => {
    const metadata = (record.metadata ?? {}) as Json
    return record.policyCategory === 'override' && metadata.agentId === state.agent?.id
  })
  assert.ok(override, 'the admin override is audited with an override marker')
  const metadata = (override.metadata ?? {}) as Json
  assert.equal(metadata.providerAccessOverride, true, 'the audit marks the explicit override request')
  const overridden = (metadata.overriddenDecision ?? {}) as Json
  assert.equal(overridden.allowed, false, 'the audit preserves the decision that was overridden')
  assert.equal(overridden.rule, this.accessRule?.id, 'the audit cites the rule that was overridden')
})
