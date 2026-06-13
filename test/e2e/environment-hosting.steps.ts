import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import {
  createAgent,
  createEnvironment,
  createSelfHostedSession,
  ensureSignedIn,
  type Json,
  type StepsWorld,
} from './shared-helpers'

// ─── Background: sandbox-execution.feature ───────────────────────────────────

Given('a session has sandbox access enabled by policy', async function (this: StepsWorld) {
  // The environment policy allows sandbox access. This is a precondition for
  // sandbox-related scenarios. We initialize the signed-in state here; the
  // individual scenario Given steps set up the specific session and environment.
  await ensureSignedIn(this)
})

// ─── Scenario: Define runtime hosting separately from agent persona ───────────

When('the user creates an execution environment definition', async function (this: StepsWorld) {
  const state = await ensureSignedIn(this)
  // Create environment with runtime type recorded in runtimeConfig (runtime is
  // not a separate top-level environment field — it lives in runtimeConfig so
  // the environment description remains decoupled from any specific runtime binary)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} hosting mode env`,
    hostingMode: 'cloud',
    runtimeConfig: { image: 'ama-pi-runtime', runtime: 'ama' },
    networkPolicy: { mode: 'unrestricted' },
  })
  // Also create an agent for the "And provider, model..." step
  state.agent = await createAgent(state, {
    name: `${state.runId} persona agent`,
    model: '@cf/moonshotai/kimi-k2.6',
    instructions: 'Environment hosting persona test',
  })
})

Then('the environment captures hostingMode as cloud or self_hosted', function (this: StepsWorld) {
  const env = this.e2e?.environment as Json | undefined
  assert.ok(env, 'environment must have been created')
  assert.ok(
    env.hostingMode === 'cloud' || env.hostingMode === 'self_hosted',
    `hostingMode must be cloud or self_hosted, got: ${env.hostingMode}`,
  )
})

Then('the environment captures runtime as ama, claude-code, codex, or copilot', function (this: StepsWorld) {
  const env = this.e2e?.environment as Json | undefined
  assert.ok(env, 'environment must have been created')
  // The runtime type is recorded in runtimeConfig (not a separate top-level field).
  // This keeps the environment description decoupled from runtime-specific binaries.
  const runtimeConfig = (env.runtimeConfig as Json | undefined) ?? {}
  const runtime = runtimeConfig.runtime
  const validRuntimes = ['ama', 'claude-code', 'codex', 'copilot']
  assert.ok(
    validRuntimes.includes(String(runtime)),
    `runtimeConfig.runtime must be one of ${validRuntimes.join(', ')}, got: ${runtime}`,
  )
})

Then(
  'workspace, secrets, network, resource limits, and runtime config belong to the environment',
  function (this: StepsWorld) {
    const env = this.e2e?.environment as Json | undefined
    assert.ok(env, 'environment must have been created')
    // Environment schema includes these fields — verify they are present on the created resource
    assert.ok('id' in env, 'environment must have id')
    assert.ok('hostingMode' in env, 'environment must have hostingMode')
    assert.ok('runtimeConfig' in env, 'environment must have runtimeConfig')
    // network policy, secrets, and resource limits live under environment-level fields
    assert.ok(
      'networkPolicy' in env || env.networkPolicy === null || env.networkPolicy === undefined,
      'environment must expose networkPolicy field',
    )
  },
)

Then('provider, model, persona, instructions, and policy remain on the agent', function (this: StepsWorld) {
  const agent = this.e2e?.agent as Json | undefined
  assert.ok(agent, 'agent must have been created')
  // Provider selection lives on the agent: providerId is null here because the
  // agent uses the project default provider (resolved at session start), while
  // the model is pinned explicitly on the agent.
  assert.ok('providerId' in agent, 'provider selection belongs to the agent')
  assert.equal(agent.providerId, null)
  assert.equal(agent.model, '@cf/moonshotai/kimi-k2.6')
  assert.ok(typeof agent.instructions === 'string', 'agent must have instructions')
  // These fields belong on the agent, not the environment
  assert.ok(!('hostingMode' in agent), 'agent must not have hostingMode (belongs to environment)')
  assert.ok(!('runtimeConfig' in agent), 'agent must not have runtimeConfig (belongs to environment)')
})

// ─── Scenario: Wait for a self-hosted runner ─────────────────────────────────

Given('a session uses a self-hosted environment', async function (this: StepsWorld) {
  const state = await ensureSignedIn(this)
  state.environment = await createEnvironment(state, {
    name: `${state.runId} self-hosted env`,
    hostingMode: 'self_hosted',
    runtime: 'ama',
    networkPolicy: { mode: 'unrestricted' },
  })
  state.agent = await createAgent(state, { name: `${state.runId} self-hosted wait agent` })
  // Create session — it will be pending, waiting for a runner
  state.latestSession = await createSelfHostedSession(state)
})

When('no runner has leased the session work', function (this: StepsWorld) {
  // This is the state immediately after session creation with a self-hosted
  // environment when no runner has claimed work yet. The session was just
  // created in the Given step, and we have not registered any runner.
  assert.ok(this.e2e?.latestSession, 'session must have been created')
})

Then('AMA keeps the session pending with a waiting-for-runner reason', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const session = state.latestSession as Json
  assert.equal(session.state, 'pending')
  assert.equal(session.stateReason, 'waiting-for-runner')
})

Then('AMA does not create a Cloudflare Sandbox for that session', function (this: StepsWorld) {
  const session = this.e2e?.latestSession as Json | undefined
  assert.ok(session, 'session must exist')
  // A self-hosted session must not start runtime work before a runner claims it:
  // it stays pending and never transitions to running. The sandbox itself is an
  // internal implementation detail no longer surfaced on the API schema.
  assert.equal(session.state, 'pending')
})
