import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse, delay, waitForSession } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
  sessionEvents,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

interface Attempt {
  status: number
  body: Json
}

type PolicyWorld = StepsWorld & {
  teamId?: string
  memberToken?: string
  budget?: Json
  usageCountBeforeAttempt?: number
  sessionAttempt?: Attempt
  blockedHost?: string
  blockedFetchStatus?: number
  configDocument?: Json
  validateResult?: Attempt
  denyReason?: string
  accessRule?: Json
  historicalMarker?: string
  historicalSnapshots?: { agentSnapshot: unknown; environmentSnapshot: unknown }
}

function state(world: PolicyWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function bearerHeaders(token: string) {
  return { authorization: `Bearer ${token}` }
}

// The org segment of the signed-in user's e2e token; secondary identities
// join the same organization and project through the `org=` claim directive.
function orgRunIdOf(e2e: E2EState) {
  const accessToken = e2e.accessToken ?? ''
  assert.ok(accessToken.startsWith('e2e:'), 'the signed-in user must hold an e2e access token')
  return accessToken.slice('e2e:'.length).split(';')[0]
}

async function applyConfig(e2e: E2EState, document: Json) {
  return await apiJson<Json>(e2e.page.request, '/api/governance/config', { method: 'POST', data: document })
}

async function runPrompt(e2e: E2EState, message: string, headers?: Record<string, string>): Promise<Attempt> {
  const response = await apiResponse(e2e.page.request, `/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message },
    ...(headers ? { headers } : {}),
  })
  const text = await response.text()
  return { status: response.status(), body: (text ? JSON.parse(text) : {}) as Json }
}

async function waitForPolicyDenial(e2e: E2EState, predicate: (payload: Json) => boolean, label: string) {
  let observed: string[] = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(e2e)
    observed = events.data.map((event) => `${event.sequence}:${event.type}`)
    const match = events.data.find((event) => {
      if (event.type !== 'policy.decision') {
        return false
      }
      const payload = objectValue(event.payload)
      return payload.allowed === false && predicate(payload)
    })
    if (match) {
      return objectValue(match.payload)
    }
    await delay(500)
  }
  throw new Error(`Session ${e2e.latestSession?.id} did not record ${label}. Events: ${observed.join(', ')}`)
}

async function waitForSuccessfulCommand(e2e: E2EState, marker: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(e2e)
    const match = events.data.find(
      (event) =>
        event.type === 'tool_execution_end' &&
        objectValue(event.payload).isError === false &&
        JSON.stringify(event.payload).includes(marker),
    )
    if (match) {
      return match
    }
    await delay(500)
  }
  const events = await sessionEvents(e2e)
  throw new Error(
    `Session ${e2e.latestSession?.id} never executed the command carrying ${marker}. Events: ${JSON.stringify(events.data.map((event) => ({ type: event.type, payload: event.payload })))}`,
  )
}

async function attemptSessionCreate(e2e: E2EState, headers?: Record<string, string>): Promise<Attempt> {
  const response = await apiResponse(e2e.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: e2e.agent?.id,
      environmentId: e2e.environment?.id,
      runtime: 'ama',
      title: `${e2e.runId} policy attempt session`,
    },
    ...(headers ? { headers } : {}),
  })
  const text = await response.text()
  return { status: response.status(), body: (text ? JSON.parse(text) : {}) as Json }
}

// ─── Background ───────────────────────────────────────────────────────────────

Given('an organization has teams and projects', async function (this: PolicyWorld) {
  const e2e = await ensureSignedIn(this)
  this.teamId = `team-${e2e.runId}`
  // Team membership comes from OIDC claims: this member identity belongs to
  // the run's organization (and therefore its project) and to the team.
  this.memberToken = `e2e:${e2e.runId}-member;org=${orgRunIdOf(e2e)};teams=${this.teamId}`
})

// ─── Scenario: Resolve policy hierarchy ──────────────────────────────────────

When('a session starts', { timeout: 180_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.ok(this.teamId && this.memberToken, 'background team fixtures must exist')
  await applyConfig(e2e, {
    organization: { sandboxPolicy: { blockedCommands: ['rm'] } },
    teams: [{ teamId: this.teamId, sandboxPolicy: { blockedCommands: ['curl'] } }],
    project: { sandboxPolicy: { blockedCommands: ['mkfs'] } },
  })
  e2e.agent = await createAgent(e2e, { name: `${e2e.runId} hierarchy agent`, allowedTools: ['sandbox.exec'] })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} hierarchy env`, hostingMode: 'cloud' })
  const created = await attemptSessionCreate(e2e, bearerHeaders(this.memberToken))
  assert.equal(created.status, 201, `team member session creation failed: ${JSON.stringify(created.body)}`)
  e2e.latestSession = await waitForSession(e2e.page.request, String(created.body.id))
})

Then(
  'organization policy, team policy, project policy, and agent policy are resolved',
  async function (this: PolicyWorld) {
    const e2e = state(this)
    assert.ok(this.memberToken, 'a team member identity must exist')
    const effective = await apiJson<Json>(e2e.page.request, '/api/governance/effective-policy', {
      headers: bearerHeaders(this.memberToken),
    })
    const sources = (effective.sources ?? []) as Json[]
    const scopes = sources.map((source) => source.scope)
    assert.deepEqual(scopes, ['organization', 'team', 'project'], 'all hierarchy levels resolved in order')
    assert.equal(
      sources.find((source) => source.scope === 'team')?.teamId,
      this.teamId,
      'the team level resolved through the OIDC team claim',
    )
    const blockedCommands = (objectValue(effective.sandboxPolicy).blockedCommands ?? []) as string[]
    assert.deepEqual([...blockedCommands].sort(), ['curl', 'mkfs', 'rm'], 'hierarchy rules merged most-restrictively')
    // Agent policy resolved into the immutable session snapshot.
    const session = await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}`)
    assert.deepEqual(objectValue(session.agentSnapshot).allowedTools, ['sandbox.exec'])
  },
)

Then('the most restrictive applicable rule is enforced', { timeout: 180_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.ok(this.memberToken, 'a team member identity must exist')
  const headers = bearerHeaders(this.memberToken)

  const allowed = await runPrompt(e2e, `run the sandbox command "echo hierarchy-ok-${e2e.runId}"`, headers)
  assert.equal(allowed.status, 200, 'a command no level blocks still executes')
  await waitForSuccessfulCommand(e2e, `hierarchy-ok-${e2e.runId}`)

  const orgBlocked = await runPrompt(e2e, 'run the sandbox command "rm -rf /workspace/tmp"', headers)
  assert.equal(orgBlocked.status, 500, 'the organization-blocked command fails')
  const orgDenial = await waitForPolicyDenial(
    e2e,
    (payload) => String(payload.command ?? '').startsWith('rm'),
    'the organization-level command denial',
  )
  assert.equal(orgDenial.ruleId, 'sandboxPolicy.blockedCommands')

  const teamBlocked = await runPrompt(e2e, 'run the sandbox command "curl https://example.com"', headers)
  assert.equal(teamBlocked.status, 500, 'the team-blocked command fails for the team member')
  await waitForPolicyDenial(
    e2e,
    (payload) => String(payload.command ?? '').startsWith('curl'),
    'the team-level command denial',
  )

  const projectBlocked = await runPrompt(e2e, 'run the sandbox command "mkfs /dev/sda"', headers)
  assert.equal(projectBlocked.status, 500, 'the project-blocked command fails')
  await waitForPolicyDenial(
    e2e,
    (payload) => String(payload.command ?? '').startsWith('mkfs'),
    'the project-level command denial',
  )
})

// ─── Scenario: Enforce model budget ──────────────────────────────────────────

Given('a project has a monthly model budget', { timeout: 180_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  e2e.agent = await createAgent(e2e, {
    name: `${e2e.runId} budget agent`,
    provider: 'workers-ai',
    model: WORKERS_AI_MODEL,
  })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} budget env` })
  // Real spend first: one completed model turn records token usage.
  e2e.latestSession = await createSession(e2e, { title: `${e2e.runId} budget spend session` })
  const turn = await runPrompt(e2e, `hello budget usage ${e2e.runId}`)
  assert.equal(turn.status, 200, 'the funded model turn completes')
  let usageCount = 0
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const usage = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/usage?limit=100')
    const modelRecords = usage.data.filter((record) => record.usageType === 'model' && Number(record.totalTokens) > 0)
    usageCount = usage.data.length
    if (modelRecords.length > 0) {
      break
    }
    await delay(500)
    assert.notEqual(attempt, 29, 'model usage was never recorded for the funded turn')
  }
  this.usageCountBeforeAttempt = usageCount
  this.budget = await apiJson<Json>(e2e.page.request, '/api/governance/budgets', {
    method: 'POST',
    data: { scope: 'project', limitType: 'tokens', limitValue: 1, window: 'month' },
  })
})

When('a session would exceed the budget', async function (this: PolicyWorld) {
  const e2e = state(this)
  this.sessionAttempt = await attemptSessionCreate(e2e)
})

Then('the model call is rejected before provider execution', async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.ok(this.sessionAttempt, 'a session attempt must have been made')
  assert.equal(this.sessionAttempt.status, 403, 'the over-budget session is denied')
  const error = objectValue(this.sessionAttempt.body.error)
  assert.equal(error.type, 'policy_denied')
  const details = objectValue(error.details)
  assert.equal(details.category, 'budget')
  assert.equal(details.ruleId, this.budget?.id, 'the denial cites the governing budget')
  assert.match(String(error.message), /month tokens limit of 1/, 'the denial explains the exhausted budget')
  // Nothing executed: no new session exists and no new usage was recorded.
  const sessions = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/sessions?limit=100')
  const agentSessions = sessions.data.filter((session) => session.agentId === e2e.agent?.id)
  assert.equal(agentSessions.length, 1, 'only the funded session exists')
  const usage = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/usage?limit=100')
  assert.equal(usage.data.length, this.usageCountBeforeAttempt, 'the denied request reached no provider')
})

Then('a governance event is recorded', async function (this: PolicyWorld) {
  const e2e = state(this)
  const records = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    '/api/audit-records?action=session.create&outcome=denied&limit=50',
  )
  const denial = records.data.find((record) => {
    const metadata = objectValue(record.metadata)
    return record.policyCategory === 'budget' && metadata.agentId === e2e.agent?.id
  })
  assert.ok(denial, 'the budget denial is recorded as a governance event')
  assert.equal(objectValue(objectValue(denial.metadata).decision).rule, this.budget?.id)
})

// ─── Scenario: Enforce sandbox restrictions ──────────────────────────────────

Given('a project disables sandbox network access', { timeout: 180_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  await applyConfig(e2e, { project: { sandboxPolicy: { network: 'disabled' } } })
  e2e.agent = await createAgent(e2e, { name: `${e2e.runId} sandbox-net agent` })
  e2e.environment = await createEnvironment(e2e, {
    name: `${e2e.runId} sandbox-net env`,
    hostingMode: 'cloud',
    networkPolicy: { mode: 'unrestricted' },
  })
  e2e.latestSession = await createSession(e2e, { title: `${e2e.runId} sandbox-net session` })
})

When('the agent requests a networked sandbox operation', { timeout: 60_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  this.blockedHost = `service-${e2e.runId}.example.net`
  const attempt = await runPrompt(e2e, `fetch https://${this.blockedHost}/data`)
  this.blockedFetchStatus = attempt.status
})

Then('the runtime denies the operation', { timeout: 60_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.equal(this.blockedFetchStatus, 500, 'the blocked network turn surfaces a runtime failure')
  const events = await sessionEvents(e2e)
  assert.equal(
    JSON.stringify(events.data).includes(`simulated fetch ${this.blockedHost}`),
    false,
    'the network operation never executed in the sandbox',
  )
})

Then('explains which policy blocked it', { timeout: 60_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  const denial = await waitForPolicyDenial(
    e2e,
    (payload) => payload.host === this.blockedHost,
    'the sandbox network denial',
  )
  assert.equal(denial.category, 'sandbox_network')
  assert.equal(denial.ruleId, 'sandboxPolicy.network', 'the denial names the governing policy rule')
  assert.match(
    String(objectValue(denial.decision).message),
    /network access is disabled by policy/i,
    'the denial explains the blocking policy',
  )
})

// ─── Scenario: Load governance from configuration ────────────────────────────

When('an operator provides a governance config', async function (this: PolicyWorld) {
  const e2e = state(this)
  this.denyReason = `${e2e.runId} workers-ai paused via config`
  this.configDocument = {
    version: `${e2e.runId}-policy-config`,
    project: { providerRules: [{ providerId: 'workers-ai', effect: 'deny', reason: this.denyReason }] },
  }
  const response = await apiResponse(e2e.page.request, '/api/governance/config/validate', {
    method: 'POST',
    data: this.configDocument,
  })
  this.validateResult = { status: response.status(), body: (await response.json()) as Json }
})

Then('the platform validates the config', async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.ok(this.validateResult, 'the config must have been validated')
  assert.equal(this.validateResult.status, 200)
  assert.equal(this.validateResult.body.valid, true)
  // The same validator rejects an incoherent variant, so validation is real.
  const invalid = await apiResponse(e2e.page.request, '/api/governance/config/validate', {
    method: 'POST',
    data: { project: { providerRules: [{ providerId: `provider-bogus-${e2e.runId}`, effect: 'deny' }] } },
  })
  assert.equal(invalid.status(), 400)
})

Then('applies it without requiring source code changes', async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.ok(this.configDocument, 'a config document must exist')
  const applied = await applyConfig(e2e, this.configDocument)
  assert.equal(applied.applied, true)
  const evaluation = await apiResponse(e2e.page.request, '/api/governance/evaluations', {
    method: 'POST',
    data: { providerId: 'workers-ai', modelId: WORKERS_AI_MODEL },
  })
  assert.equal(evaluation.status(), 403, 'the configured rule now governs policy decisions')
  const body = (await evaluation.json()) as Json
  assert.equal(String(objectValue(body.error).message), this.denyReason, 'the configured rule reason is enforced')
})

// ─── Scenario: Explain policy denials to operators ───────────────────────────

Given(
  'a request is denied by provider, tool, MCP, sandbox, or budget policy',
  { timeout: 120_000 },
  async function (this: PolicyWorld) {
    const e2e = state(this)
    this.denyReason = `${e2e.runId} provider requires security review`
    this.accessRule = await apiJson<Json>(e2e.page.request, '/api/governance/provider-access-rules', {
      method: 'POST',
      data: { providerId: 'workers-ai', effect: 'deny', reason: this.denyReason },
    })
    e2e.agent = await createAgent(e2e, {
      name: `${e2e.runId} denial agent`,
      provider: 'workers-ai',
      model: WORKERS_AI_MODEL,
    })
    e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} denial env` })
    this.sessionAttempt = await attemptSessionCreate(e2e)
    assert.equal(this.sessionAttempt.status, 403, 'the session request is denied by policy')
  },
)

When('the user inspects the failure', function (this: PolicyWorld) {
  assert.ok(this.sessionAttempt, 'a denied request must exist')
  assert.equal(objectValue(this.sessionAttempt.body.error).type, 'policy_denied')
})

Then('the response identifies the policy category and safe resource reference', function (this: PolicyWorld) {
  const details = objectValue(objectValue(this.sessionAttempt?.body.error).details)
  assert.equal(details.category, 'provider', 'the denial names the policy category')
  assert.equal(details.resourceType, 'provider', 'the denial names the resource type')
  assert.equal(details.resourceId, 'workers-ai', 'the denial names a safe resource reference')
  assert.equal(details.ruleId, this.accessRule?.id, 'the denial cites the governing rule')
})

Then('the UI can link to the effective policy view', async function (this: PolicyWorld) {
  const e2e = state(this)
  const details = objectValue(objectValue(this.sessionAttempt?.body.error).details)
  const effective = await apiJson<Json>(e2e.page.request, '/api/governance/effective-policy')
  const cited = ((effective.accessRules ?? []) as Json[]).find((rule) => rule.id === details.ruleId)
  assert.ok(cited, 'the cited rule resolves in the effective policy view the UI links to')
  assert.equal(cited.effect, 'deny')
})

Then('no secret or raw credential values are included', function (this: PolicyWorld) {
  const serialized = JSON.stringify(this.sessionAttempt?.body)
  assert.equal(serialized.includes('secret://'), false, 'no secret references leak')
  assert.equal(serialized.includes('credentialSecretRef'), false, 'no credential fields leak')
  assert.equal(/Bearer\s/i.test(serialized), false, 'no bearer credentials leak')
})

// ─── Scenario: Preserve historical sessions after policy changes ─────────────

Given('a session was created under an older policy', { timeout: 180_000 }, async function (this: PolicyWorld) {
  const e2e = state(this)
  e2e.agent = await createAgent(e2e, { name: `${e2e.runId} history agent` })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} history env`, hostingMode: 'cloud' })
  e2e.latestSession = await createSession(e2e, { title: `${e2e.runId} history session` })
  this.historicalMarker = `history-${e2e.runId}`
  const turn = await runPrompt(e2e, `run the sandbox command "echo ${this.historicalMarker}"`)
  assert.equal(turn.status, 200, 'the command executed under the older policy')
  await waitForSuccessfulCommand(e2e, this.historicalMarker)
  const session = await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}`)
  this.historicalSnapshots = {
    agentSnapshot: session.agentSnapshot,
    environmentSnapshot: session.environmentSnapshot,
  }
})

When('governance policy changes', async function (this: PolicyWorld) {
  const e2e = state(this)
  const applied = await applyConfig(e2e, { project: { sandboxPolicy: { blockedCommands: ['echo'] } } })
  assert.equal(applied.applied, true, 'the stricter policy applied')
})

Then('historical session events and snapshots remain readable', async function (this: PolicyWorld) {
  const e2e = state(this)
  assert.ok(this.historicalSnapshots && this.historicalMarker, 'historical fixtures must exist')
  const session = await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}`)
  assert.deepEqual(session.agentSnapshot, this.historicalSnapshots.agentSnapshot, 'the agent snapshot is unchanged')
  assert.deepEqual(
    session.environmentSnapshot,
    this.historicalSnapshots.environmentSnapshot,
    'the environment snapshot is unchanged',
  )
  const events = await sessionEvents(e2e)
  const marker = this.historicalMarker
  const historical = events.data.find(
    (event) =>
      event.type === 'tool_execution_end' &&
      objectValue(event.payload).isError === false &&
      JSON.stringify(event.payload).includes(marker),
  )
  assert.ok(historical, 'the pre-change execution remains readable in the session history')
})

Then(
  'reconnecting or sending new work uses the current effective policy',
  { timeout: 60_000 },
  async function (this: PolicyWorld) {
    const e2e = state(this)
    const blocked = await runPrompt(e2e, `run the sandbox command "echo after-${e2e.runId}"`)
    assert.equal(blocked.status, 500, 'new work on the historical session is governed by the current policy')
    const denial = await waitForPolicyDenial(
      e2e,
      (payload) => String(payload.command ?? '').includes(`after-${e2e.runId}`),
      'the post-change command denial',
    )
    assert.equal(denial.category, 'sandbox_command')
    assert.equal(denial.ruleId, 'sandboxPolicy.blockedCommands')
  },
)
