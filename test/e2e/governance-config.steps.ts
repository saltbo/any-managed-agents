import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

interface ConfigAttempt {
  status: number
  body: Json
}

type ConfigWorld = StepsWorld & {
  configDocument?: Json
  validateResult?: ConfigAttempt
  applyResult?: ConfigAttempt
  previewResult?: ConfigAttempt
  baselineEffectivePolicy?: Json
  teamId?: string
  denyReason?: string
}

function state(world: ConfigWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

async function postConfig(e2e: E2EState, path: string, document: Json): Promise<ConfigAttempt> {
  const response = await apiResponse(e2e.page.request, path, { method: 'POST', data: document })
  const text = await response.text()
  return { status: response.status(), body: (text ? JSON.parse(text) : {}) as Json }
}

async function effectivePolicy(e2e: E2EState) {
  return await apiJson<Json>(e2e.page.request, '/api/governance/effective-policy')
}

// ─── governance-config: Load governance config ───────────────────────────────

When('an operator provides a governance config file', async function (this: ConfigWorld) {
  const e2e = await ensureSignedIn(this)
  this.teamId = `team-${e2e.runId}`
  this.configDocument = {
    version: `${e2e.runId}-load`,
    organization: {
      providerRules: [{ providerId: 'workers-ai', effect: 'allow' }],
      toolPolicy: { blockedTools: ['sandbox.fetch'] },
    },
    teams: [{ teamId: this.teamId, sandboxPolicy: { blockedCommands: ['rm'] } }],
    project: {
      sandboxPolicy: { network: 'restricted', allowedHosts: [`api-${e2e.runId}.example.com`] },
      budgetPolicy: { monthlyTokens: 100000 },
    },
    budgets: [{ scope: 'project', limitType: 'tokens', limitValue: 100000, window: 'month' }],
  }
  this.validateResult = await postConfig(e2e, '/api/governance/config/validate', this.configDocument)
})

Then(
  'the platform validates hierarchy, provider rules, tool rules, sandbox rules, and budgets',
  function (this: ConfigWorld) {
    assert.ok(this.validateResult, 'a validation attempt must have been made')
    assert.equal(this.validateResult.status, 200, 'a coherent config document validates cleanly')
    assert.equal(this.validateResult.body.valid, true)
    const summary = objectValue(this.validateResult.body.summary)
    const hierarchy = objectValue(summary.hierarchy)
    assert.equal(hierarchy.organization, true, 'the organization level was validated')
    assert.deepEqual(hierarchy.teams, [this.teamId], 'the declared team level was validated')
    assert.equal(hierarchy.project, true, 'the project level was validated')
    assert.equal(summary.providerRules, 1, 'provider rules were validated')
    assert.equal(summary.toolRules, 1, 'tool rules were validated')
    assert.ok(Number(summary.sandboxRules) >= 2, 'sandbox rules were validated')
    assert.equal(summary.budgets, 1, 'budgets were validated')
    assert.ok(typeof this.validateResult.body.configVersion === 'number', 'a config version is assigned')
  },
)

// ─── governance-config: Validate governance config before applying ───────────

Given('an operator submits declarative governance configuration', async function (this: ConfigWorld) {
  const e2e = await ensureSignedIn(this)
  this.baselineEffectivePolicy = await effectivePolicy(e2e)
})

When(
  'the config references unknown providers, teams, projects, tools, MCP connectors, or invalid budgets',
  async function (this: ConfigWorld) {
    const e2e = state(this)
    this.configDocument = {
      projectId: `project_unknown_${e2e.runId}`,
      project: {
        providerRules: [{ providerId: `provider-unknown-${e2e.runId}`, effect: 'deny' }],
        toolPolicy: { blockedTools: [`tool-unknown-${e2e.runId}`] },
        mcpPolicy: { allowedConnectors: [`connector-unknown-${e2e.runId}`] },
      },
      providerAccessRules: [{ teamId: `team-unknown-${e2e.runId}`, effect: 'deny' }],
      budgets: [{ scope: 'project', limitType: 'tokens', limitValue: 0, window: 'month' }],
    }
    this.validateResult = await postConfig(e2e, '/api/governance/config/validate', this.configDocument)
    this.applyResult = await postConfig(e2e, '/api/governance/config', this.configDocument)
  },
)

Then('the platform rejects the config with field-level errors', function (this: ConfigWorld) {
  const e2e = state(this)
  for (const attempt of [this.validateResult, this.applyResult]) {
    assert.ok(attempt, 'validate and apply attempts must have been made')
    assert.equal(attempt.status, 400, 'the invalid config is rejected')
    const error = objectValue(attempt.body.error)
    assert.equal(error.type, 'validation_error')
    const fields = objectValue(objectValue(error.details).fields)
    assert.match(String(fields.projectId), /Unknown project/, 'unknown project is reported on its field')
    assert.match(
      String(fields['project.providerRules[0].providerId']),
      new RegExp(`provider-unknown-${e2e.runId}`),
      'unknown provider is reported on its field',
    )
    assert.match(String(fields['project.toolPolicy.blockedTools[0]']), /Unknown tool/)
    assert.match(String(fields['project.mcpPolicy.allowedConnectors[0]']), /Unknown MCP connector/)
    assert.match(String(fields['providerAccessRules[0].teamId']), /Unknown team/)
    assert.match(String(fields['budgets[0].limitValue']), /positive integer/)
  }
})

Then('no partial policy changes are applied', async function (this: ConfigWorld) {
  const e2e = state(this)
  assert.ok(this.baselineEffectivePolicy, 'a baseline effective policy must have been captured')
  const current = await effectivePolicy(e2e)
  assert.deepEqual(current, this.baselineEffectivePolicy, 'the effective policy is unchanged')
  const accessRules = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/governance/provider-access-rules')
  assert.equal(accessRules.data.length, 0, 'no access rule from the rejected config exists')
  const budgets = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/governance/budgets')
  assert.equal(budgets.data.length, 0, 'no budget from the rejected config exists')
})

// ─── governance-config: Apply governance config atomically ───────────────────

Given('a valid governance config is submitted', async function (this: ConfigWorld) {
  const e2e = await ensureSignedIn(this)
  this.teamId = `team-${e2e.runId}`
  this.denyReason = `${e2e.runId} provider denied by declarative config`
  this.configDocument = {
    version: `${e2e.runId}-apply`,
    organization: { sandboxPolicy: { blockedCommands: ['rm'] } },
    teams: [{ teamId: this.teamId }],
    project: {
      providerRules: [{ providerId: 'workers-ai', effect: 'deny', reason: this.denyReason }],
      modelRules: [{ providerId: 'workers-ai', modelId: WORKERS_AI_MODEL, effect: 'deny' }],
      toolPolicy: { blockedTools: ['sandbox.fetch'] },
      mcpPolicy: { allowedConnectors: ['linear'] },
      sandboxPolicy: { blockedCommands: ['mkfs'] },
      budgetPolicy: { monthlyCostMicros: 5000000 },
    },
    providerAccessRules: [
      { providerId: 'workers-ai', modelId: WORKERS_AI_MODEL, teamId: this.teamId, effect: 'allow' },
    ],
    budgets: [{ scope: 'project', limitType: 'tokens', limitValue: 500, window: 'month' }],
  }
})

When('the platform applies it', async function (this: ConfigWorld) {
  const e2e = state(this)
  assert.ok(this.configDocument, 'a config document must have been prepared')
  this.applyResult = await postConfig(e2e, '/api/governance/config', this.configDocument)
  assert.equal(this.applyResult.status, 200, `apply failed: ${JSON.stringify(this.applyResult.body)}`)
})

Then('provider, model, tool, MCP, sandbox, and budget policies update together', async function (this: ConfigWorld) {
  const e2e = state(this)
  const configVersion = this.applyResult?.body.configVersion
  assert.ok(typeof configVersion === 'number', 'the apply result carries a config version')

  const policy = await apiJson<Json>(e2e.page.request, '/api/governance/policy')
  assert.deepEqual(policy.providerRules, [{ providerId: 'workers-ai', effect: 'deny', reason: this.denyReason }])
  assert.deepEqual(policy.modelRules, [{ providerId: 'workers-ai', modelId: WORKERS_AI_MODEL, effect: 'deny' }])
  assert.deepEqual(objectValue(policy.toolPolicy).blockedTools, ['sandbox.fetch'])
  assert.deepEqual(objectValue(policy.mcpPolicy).allowedConnectors, ['linear'])
  assert.deepEqual(objectValue(policy.sandboxPolicy).blockedCommands, ['mkfs'])
  assert.equal(objectValue(policy.budgetPolicy).monthlyCostMicros, 5000000)
  assert.equal(objectValue(policy.metadata).configVersion, configVersion, 'the policy row carries the config version')

  const accessRules = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/governance/provider-access-rules')
  assert.equal(accessRules.data.length, 1, 'the declared access rule set replaced the project rules')
  assert.equal(accessRules.data[0]?.teamId, this.teamId)
  assert.equal(objectValue(accessRules.data[0]?.metadata).configVersion, configVersion)

  const budgets = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/governance/budgets')
  assert.equal(budgets.data.length, 1, 'the declared budget set replaced the project budgets')
  assert.equal(budgets.data[0]?.limitValue, 500)
  assert.equal(objectValue(budgets.data[0]?.metadata).configVersion, configVersion)

  // The hierarchy merged: organization-level and project-level sandbox
  // command restrictions are both part of the effective policy.
  const effective = await effectivePolicy(e2e)
  const blockedCommands = objectValue(effective.sandboxPolicy).blockedCommands as string[]
  assert.deepEqual([...blockedCommands].sort(), ['mkfs', 'rm'], 'organization and project sandbox rules merged')
})

Then('the audit log records the config version, actor, and safe summary', async function (this: ConfigWorld) {
  const e2e = state(this)
  const records = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    '/api/audit-records?action=governance_config.apply&limit=10',
  )
  const record = records.data.find(
    (entry) => objectValue(entry.metadata).configVersion === this.applyResult?.body.configVersion,
  )
  assert.ok(record, 'the applied config is audited')
  assert.equal(record.outcome, 'success')
  assert.ok(typeof record.actorUserId === 'string' && record.actorUserId.length > 0, 'the audit records the actor')
  const metadata = objectValue(record.metadata)
  assert.equal(metadata.configLabel, `${e2e.runId}-apply`, 'the audit records the operator-supplied config label')
  const summary = objectValue(metadata.summary)
  assert.equal(summary.providerRules, 1)
  assert.equal(summary.budgets, 1)
  const serialized = JSON.stringify(record)
  assert.ok(this.denyReason, 'the deny reason fixture must exist')
  assert.equal(
    serialized.includes(this.denyReason),
    false,
    'the audit summary stays safe and never embeds rule reason text',
  )
  assert.equal(serialized.includes('secret://'), false, 'the audit never exposes credential references')
})

// ─── governance-config: Preview governance config impact ─────────────────────

Given('a proposed config would block existing agents or future sessions', async function (this: ConfigWorld) {
  const e2e = await ensureSignedIn(this)
  e2e.agent = await createAgent(e2e, {
    name: `${e2e.runId} preview agent`,
    provider: 'workers-ai',
    model: WORKERS_AI_MODEL,
  })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} preview env`, hostingMode: 'cloud' })
  this.denyReason = `${e2e.runId} workers-ai is paused`
  this.configDocument = {
    project: {
      providerRules: [{ providerId: 'workers-ai', effect: 'deny', reason: this.denyReason }],
      sandboxPolicy: { enabled: false },
    },
  }
})

When('the operator previews the config', async function (this: ConfigWorld) {
  const e2e = state(this)
  assert.ok(this.configDocument, 'a config document must have been prepared')
  this.previewResult = await postConfig(e2e, '/api/governance/config/preview', this.configDocument)
  assert.equal(this.previewResult.status, 200, `preview failed: ${JSON.stringify(this.previewResult.body)}`)
})

Then(
  'the platform reports affected agents, environments, providers, and session creation paths',
  function (this: ConfigWorld) {
    const e2e = state(this)
    const impact = objectValue(this.previewResult?.body.impact)
    const affectedAgents = (impact.affectedAgents ?? []) as Json[]
    const agent = affectedAgents.find((entry) => entry.agentId === e2e.agent?.id)
    assert.ok(agent, 'the existing agent is reported as affected')
    assert.equal(objectValue(agent.deniedBy).category, 'provider')

    const affectedProviders = (impact.affectedProviders ?? []) as string[]
    assert.ok(affectedProviders.includes('workers-ai'), 'the denied provider is reported')

    const affectedEnvironments = (impact.affectedEnvironments ?? []) as Json[]
    const environment = affectedEnvironments.find((entry) => entry.environmentId === e2e.environment?.id)
    assert.ok(environment, 'the cloud environment is reported as affected by the sandbox restriction')

    const sessionPaths = (impact.sessionCreationPaths ?? []) as Json[]
    assert.ok(
      sessionPaths.some(
        (entry) => entry.agentId === e2e.agent?.id && objectValue(entry.deniedBy).category === 'provider',
      ),
      'the agent session-creation path is reported as failing on provider policy',
    )
    assert.ok(
      sessionPaths.some(
        (entry) => entry.environmentId === e2e.environment?.id && objectValue(entry.deniedBy).category === 'sandbox',
      ),
      'the environment session-creation path is reported as failing on sandbox policy',
    )
  },
)

Then('the preview does not change active policy', { timeout: 120_000 }, async function (this: ConfigWorld) {
  const e2e = state(this)
  const effective = await effectivePolicy(e2e)
  assert.deepEqual(effective.providerRules, [], 'no provider rule from the preview is active')
  assert.notEqual(objectValue(effective.sandboxPolicy).enabled, false, 'the sandbox stays enabled')
  // The strongest non-mutation proof: the previewed denial does not block a
  // real session today.
  const session = await createSession(e2e, { title: `${e2e.runId} post-preview session` })
  assert.equal(session.status, 'idle', 'session creation still succeeds after the preview')
})
