import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse, delay } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  type E2EState,
  type Json,
  type StepsWorld,
  sessionEvents,
} from './shared-helpers'

const NETWORK_SECRET_MARKER = 'raw-governance-query-secret'

type GovernanceApiWorld = StepsWorld & {
  allowedHost?: string
  blockedCommandStatus?: number
  blockedFetchStatus?: number
  mcpCallStatus?: number
  mcpCallBody?: Json
}

function state(world: GovernanceApiWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

async function runPrompt(e2e: E2EState, message: string) {
  const response = await apiResponse(e2e.page.request, `/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message },
  })
  return response.status()
}

async function policyDecisionEvents(e2e: E2EState) {
  const events = await sessionEvents(e2e)
  return events.data.filter((event) => event.type === 'policy.decision')
}

async function waitForDeniedDecision(e2e: E2EState, predicate: (payload: Json) => boolean, label: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const decisions = await policyDecisionEvents(e2e)
    const match = decisions.find((event) => {
      const payload = objectValue(event.payload)
      return payload.allowed === false && predicate(payload)
    })
    if (match) {
      return objectValue(match.payload)
    }
    await delay(500)
  }
  throw new Error(`Session ${e2e.latestSession?.id} never recorded ${label}`)
}

// ─── governance-api: Manage tool, MCP, and sandbox policy ────────────────────

When(
  'the admin updates allowed tools, MCP connectors, approval modes, sandbox networking, or command restrictions',
  { timeout: 180_000 },
  async function (this: GovernanceApiWorld) {
    const e2e = state(this)
    this.allowedHost = `api-${e2e.runId}.example.com`
    await apiJson<Json>(e2e.page.request, '/api/governance/policy', {
      method: 'PUT',
      data: {
        toolPolicy: { allowedTools: ['*'] },
        mcpPolicy: { allowedConnectors: ['linear'], connectorApprovalModes: { linear: 'require_approval' } },
        sandboxPolicy: {
          // 'rm' is both allowed and blocked: the blocking rule is the most
          // restrictive applicable rule and must win.
          allowedCommands: ['echo', 'rm'],
          blockedCommands: ['rm'],
          allowedHosts: [this.allowedHost],
        },
      },
    })
    // Sessions created after the policy update are governed by it.
    e2e.agent = await createAgent(e2e, { name: `${e2e.runId} governance api agent` })
    e2e.environment = await createEnvironment(e2e, {
      name: `${e2e.runId} governance api env`,
      hostingMode: 'cloud',
      networkPolicy: { mode: 'unrestricted' },
    })
    e2e.latestSession = await createSession(e2e, { title: `${e2e.runId} governance api session` })
  },
)

Then(
  'future sessions enforce the most restrictive applicable rule',
  { timeout: 180_000 },
  async function (this: GovernanceApiWorld) {
    const e2e = state(this)
    const allowedCommand = await runPrompt(e2e, `run the sandbox command "echo governance-api-${e2e.runId}"`)
    assert.equal(allowedCommand, 200, 'an allow-listed command still executes')

    this.blockedCommandStatus = await runPrompt(e2e, 'run the sandbox command "rm -rf /workspace"')
    assert.equal(this.blockedCommandStatus, 500, 'the blocked command is denied even though it is allow-listed')

    this.blockedFetchStatus = await runPrompt(
      e2e,
      `fetch https://other-${e2e.runId}.example.net/data?token=${NETWORK_SECRET_MARKER}`,
    )
    assert.equal(this.blockedFetchStatus, 500, 'sandbox networking is restricted to the allowed hosts')

    const mcpCall = await apiResponse(
      e2e.page.request,
      `/runtime/sessions/${e2e.latestSession?.id}/mcp/github/tools/repo.read/calls`,
      { method: 'POST', data: { input: { repo: 'saltbo/any-managed-agents' } } },
    )
    this.mcpCallStatus = mcpCall.status()
    this.mcpCallBody = (await mcpCall.json()) as Json
    assert.equal(this.mcpCallStatus, 403, 'a connector outside the allow list is denied')
    assert.equal(objectValue(objectValue(this.mcpCallBody.error).details).category, 'mcp')
  },
)

Then(
  'blocked runtime actions emit policy events with safe details',
  { timeout: 60_000 },
  async function (this: GovernanceApiWorld) {
    const e2e = state(this)
    const commandDenial = await waitForDeniedDecision(
      e2e,
      (payload) => String(payload.command ?? '').startsWith('rm'),
      'the blocked command policy event',
    )
    assert.equal(commandDenial.category, 'sandbox_command')
    assert.equal(commandDenial.ruleId, 'sandboxPolicy.blockedCommands')

    const networkDenial = await waitForDeniedDecision(
      e2e,
      (payload) => String(payload.host ?? '').startsWith(`other-${e2e.runId}`),
      'the blocked network policy event',
    )
    assert.equal(networkDenial.category, 'sandbox_network')
    assert.equal(networkDenial.ruleId, 'sandboxPolicy.allowedHosts')

    const mcpDenial = await waitForDeniedDecision(
      e2e,
      (payload) => payload.connectorId === 'github',
      'the blocked MCP connector policy event',
    )
    assert.equal(mcpDenial.category, 'mcp')

    const serialized = JSON.stringify(await policyDecisionEvents(e2e))
    assert.equal(serialized.includes(NETWORK_SECRET_MARKER), false, 'policy events never carry request secrets')
    assert.equal(serialized.includes('secret://'), false, 'policy events never carry credential references')
  },
)
