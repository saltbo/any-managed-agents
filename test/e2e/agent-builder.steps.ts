import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, openLocalPage } from './local-app'
import {
  createEnvironment,
  createSession,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

interface HandoffState {
  maintainer: Json
  worker: Json
  reviewer: Json
  foreignWorker: Json
  sessionBefore?: Json
  workerBefore?: Json
  resolved?: ListResponse<Json>
  resolvedByRole?: ListResponse<Json>
}

type BuilderWorld = StepsWorld & {
  builderAgentName?: string
  builderEnvironmentName?: string
  apiExamplesText?: string
  handoff?: HandoffState
}

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const MOBILE_VIEWPORT = { width: 390, height: 844 }

async function openBuilder(page: Page) {
  await page.goto('/agents/new')
  await expect(page.getByRole('heading', { name: 'Agent builder' })).toBeVisible()
}

async function startFromScratch(page: Page) {
  await page.getByRole('button', { name: 'Start from scratch' }).click()
  await expect(page).toHaveURL(/step=core/)
}

async function fillCore(page: Page, name: string, instructions: string) {
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Instructions', { exact: true }).fill(instructions)
}

async function nextStep(page: Page, expected: string) {
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page).toHaveURL(new RegExp(`step=${expected}`))
}

async function goToTestStep(page: Page) {
  await nextStep(page, 'tools')
  await nextStep(page, 'sandbox')
  await nextStep(page, 'roles')
  await nextStep(page, 'test')
}

async function findAgentByName(page: Page, name: string) {
  // D1 rejects long LIKE patterns ("pattern too complex"), so filter the
  // project-scoped list instead of using the search query parameter.
  const list = await apiJson<ListResponse<Json>>(page.request, '/api/agents?limit=100')
  return list.data.find((agent) => agent.name === name)
}

// ─── Agent builder: core settings ───

When('the user opens the agent builder', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  await openBuilder(state.page)
  // The builder is a new console page: verify the 390px mobile layout has no
  // horizontal page scroll and keeps the primary content reachable.
  await state.page.setViewportSize(MOBILE_VIEWPORT)
  await expect(state.page.getByRole('heading', { name: 'Agent builder' })).toBeVisible()
  const overflow = await state.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert.ok(overflow <= 1, `Agent builder must not scroll horizontally at 390px (overflow ${overflow}px)`)
  await state.page.setViewportSize(DESKTOP_VIEWPORT)
})

Then('the builder captures name, description, instructions, and model', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await startFromScratch(page)
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Description', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Instructions', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Model', { exact: true })).toBeVisible()
  // The model field is a catalog-backed select; the trigger shows the drafted model id.
  await expect(page.getByLabel('Model', { exact: true })).toContainText('@cf/')
})

Then('required fields are validated before saving', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await page.getByLabel('Name', { exact: true }).clear()
  await page.getByLabel('Instructions', { exact: true }).clear()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Name is required.')).toBeVisible()
  await expect(page.getByText('Instructions are required.')).toBeVisible()
  await expect(page).toHaveURL(/step=core/)
  // Saving is blocked too: publishing from the test step bounces back to the
  // first invalid step instead of creating an agent.
  await page.getByRole('link', { name: /Test and publish/ }).click()
  await page.getByRole('button', { name: 'Publish agent' }).click()
  await expect(page).toHaveURL(/step=core/)
  await expect(page.getByText('Name is required.')).toBeVisible()
  await fillCore(page, `${state.runId} core agent`, 'Follow the project instructions.')
  await nextStep(page, 'tools')
})

// ─── Agent builder: tools and approvals ───

When('the user adds tools or MCP connectors', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  this.builderAgentName = `${state.runId} tools agent`
  await openBuilder(page)
  await startFromScratch(page)
  await fillCore(page, this.builderAgentName, 'Use only approved tooling.')
  await nextStep(page, 'tools')
  await page.getByLabel('Allowed tools', { exact: true }).fill('read\nsecrets.read')
})

Then('the builder shows schemas, approval mode, and policy status', async function (this: BuilderWorld) {
  const page = (await ensureSignedIn(this)).page
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
  await expect(page.getByText('repo.read').first()).toBeVisible()
  await expect(page.getByText(/Approval mode: project_policy/).first()).toBeVisible()
  await expect(page.getByText('allowed', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Schema: \{.*"repo".*\}/).first()).toBeVisible()
})

Then('blocked tools cannot be saved for the agent', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await nextStep(page, 'sandbox')
  await nextStep(page, 'roles')
  await nextStep(page, 'test')
  const publishResponse = page.waitForResponse(
    (response) => response.url().includes('/api/agents') && response.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: 'Publish agent' }).click()
  // The agents API rejects policy-blocked tools; the builder surfaces the
  // validation inline on the tools step.
  const response = await publishResponse
  const responseBody = await response.text()
  assert.equal(response.status(), 400, `publish must be rejected by policy, got ${response.status()}: ${responseBody}`)
  assert.ok(responseBody.includes('secrets.read'), `rejection must cite the blocked tool: ${responseBody}`)
  await expect(page).toHaveURL(/step=tools/, { timeout: 15_000 })
  await expect(page.getByText(/Tool is blocked by policy: secrets\.read/)).toBeVisible()
  const agentName = this.builderAgentName as string
  assert.equal(await findAgentByName(page, agentName), undefined, 'blocked agent must not be saved')
})

// ─── Agent builder: sandbox access ───

When('the user enables sandbox execution', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  this.builderAgentName = `${state.runId} sandbox agent`
  await openBuilder(page)
  await startFromScratch(page)
  await fillCore(page, this.builderAgentName, 'Execute development work in the sandbox.')
  await nextStep(page, 'tools')
  await nextStep(page, 'sandbox')
  await page.getByRole('checkbox', { name: 'Enable sandbox execution' }).click()
})

Then('the builder captures carried skills', async function (this: BuilderWorld) {
  const page = (await ensureSignedIn(this)).page
  await expect(page.getByLabel('Carried skills', { exact: true })).toBeVisible()
  await page.getByLabel('Carried skills', { exact: true }).fill('ama@coding-agent')
})

Then('the resulting agent version can request Cloudflare Sandbox execution', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await nextStep(page, 'roles')
  await nextStep(page, 'test')
  await page.getByRole('button', { name: 'Publish agent' }).click()
  await expect(page.getByText('Equivalent curl call')).toBeVisible({ timeout: 15_000 })

  const agent = await findAgentByName(page, this.builderAgentName as string)
  assert.ok(agent, 'published sandbox agent must exist')
  assert.deepEqual(agent.skills, ['ama@coding-agent'], 'agent version carries the configured skills')
  assert.ok(agent.currentVersionId, 'published agent pins a current version')

  state.agent = agent
  state.environment = await createEnvironment(state, {
    name: `${state.runId} sandbox env`,
    hostingMode: 'cloud',
  })
  const created = await createSession(state, { title: `${state.runId} sandbox session` })
  const session = await apiJson<Json>(page.request, `/api/sessions/${created.id}`)
  const runtimeMetadata = session.runtimeMetadata as Json
  assert.equal(runtimeMetadata.hostingMode, 'cloud', 'session from the agent runs in the cloud sandbox hosting mode')
})

// ─── Agent builder: test before publishing ───

Given('the user has configured an agent draft', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  this.builderAgentName = `${state.runId} draft agent`
  this.builderEnvironmentName = `${state.runId} draft env`
  await createEnvironment(state, { name: this.builderEnvironmentName })
  await openBuilder(page)
  await startFromScratch(page)
  await fillCore(page, this.builderAgentName, 'Confirm draft behavior before publishing.')
  await goToTestStep(page)
})

When('the user starts a test session', async function (this: BuilderWorld) {
  const page = (await ensureSignedIn(this)).page
  await page.getByRole('combobox', { name: 'Test environment' }).click()
  await page.getByRole('option', { name: this.builderEnvironmentName as string }).click()
  await page.getByRole('button', { name: 'Start test session' }).click()
  await expect(page.getByText('Draft test transcript')).toBeVisible({ timeout: 30_000 })
})

Then('the draft runs in an isolated session', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await expect(page.getByText(/AMA runtime processed:/).first()).toBeVisible({ timeout: 30_000 })

  const draftAgent = await findAgentByName(page, this.builderAgentName as string)
  assert.ok(draftAgent, 'testing saved the draft agent definition')
  assert.equal((draftAgent.metadata as Json).builderDraft, true, 'tested agent is marked as a builder draft')
  const sessions = await apiJson<ListResponse<Json>>(page.request, '/api/sessions?limit=50')
  const draftSession = sessions.data.find((session) => session.agentId === draftAgent.id)
  assert.ok(draftSession, 'the draft ran in its own session')
})

Then('publishing creates a versioned agent definition', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await page.getByRole('button', { name: 'Publish agent' }).click()
  await expect(page.getByText('Equivalent curl call')).toBeVisible({ timeout: 15_000 })

  const agent = await findAgentByName(page, this.builderAgentName as string)
  assert.ok(agent, 'published agent must exist')
  assert.ok(Number(agent.version) >= 2, 'publishing created a new agent version after the draft test')
  assert.ok(agent.currentVersionId, 'publishing activated a current version')
  assert.equal((agent.metadata as Json).builderDraft, undefined, 'publishing cleared the draft marker')
  const versions = await apiJson<ListResponse<Json>>(page.request, `/api/agents/${agent.id}/versions`)
  assert.ok(versions.data.length >= 2, 'draft and published versions are both retained')
})

// ─── Agent builder: guided first-run flow ───

When('the user describes the agent goal in natural language or picks a template', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  await openBuilder(page)
  await expect(page.getByText('Coding agent')).toBeVisible()
  await page
    .getByLabel('Agent goal', { exact: true })
    .fill('Review incoming pull requests and summarize risky changes for maintainers')
  await page.getByRole('button', { name: 'Draft agent configuration' }).click()
})

Then(
  'the builder drafts name, instructions, model choice, tool policy, and MCP connectors',
  async function (this: BuilderWorld) {
    const page = (await ensureSignedIn(this)).page
    await expect(page).toHaveURL(/step=core/)
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(/Review incoming pull requests/)
    await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(/summarize risky changes/)
    await expect(page.getByLabel('Model', { exact: true })).toContainText('@cf/')
    await nextStep(page, 'tools')
    await expect(page.getByLabel('Allowed tools', { exact: true })).toHaveValue('read\nwrite\nshell')
    await expect(page.getByText('MCP connectors', { exact: true })).toBeVisible()
    await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: /Core settings/ }).click()
    await expect(page).toHaveURL(/step=core/)
  },
)

Then('the user can inspect and edit the generated configuration before saving', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  const editedName = `${state.runId} guided agent`
  await page.getByLabel('Name', { exact: true }).fill(editedName)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(editedName)
  assert.equal(await findAgentByName(page, editedName), undefined, 'nothing is saved until the user publishes')
})

Then(
  'the builder asks for one missing decision at a time instead of blocking on a long form',
  async function (this: BuilderWorld) {
    const page = (await ensureSignedIn(this)).page
    // The core step asks only for the core decision: tool fields are not on screen.
    await expect(page.getByLabel('Allowed tools', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Builder steps' })).toBeVisible()
    // Advancing moves exactly one decision forward.
    await nextStep(page, 'tools')
    await expect(page.getByLabel('Allowed tools', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0)
  },
)

// ─── Agent builder: API examples ───

Given('the builder has created an agent', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const page = state.page
  this.builderAgentName = `${state.runId} api agent`
  await openBuilder(page)
  await startFromScratch(page)
  await fillCore(page, this.builderAgentName, 'Demonstrate the control-plane API.')
  await goToTestStep(page)
  await page.getByRole('button', { name: 'Publish agent' }).click()
  await expect(page.getByText('Equivalent curl call')).toBeVisible({ timeout: 15_000 })
  this.apiExamplesText = (await page.locator('pre').allInnerTexts()).join('\n')
})

Then(
  'the builder shows the equivalent create-agent API call using this platform origin',
  async function (this: BuilderWorld) {
    const state = await ensureSignedIn(this)
    const page = state.page
    const origin = new URL(page.url()).origin
    const examples = this.apiExamplesText as string
    assert.ok(examples.includes('curl -X POST'), 'shows the create-agent curl call')
    assert.ok(examples.includes(`${origin}/api/agents`), 'examples target this platform origin')
    const agent = await findAgentByName(page, this.builderAgentName as string)
    assert.ok(agent, 'published agent exists')
    assert.ok(examples.includes(String(agent.id)), 'examples reference the created agent id')
  },
)

Then('examples use AMA control-plane routes, not upstream vendor API URLs', async function (this: BuilderWorld) {
  const examples = this.apiExamplesText as string
  assert.ok(examples.includes('/api/agents'), 'examples call the AMA control plane')
  assert.ok(examples.includes('restish'), 'examples include restish workflows')
  assert.ok(!/\b(?:api\.)?(?:openai|anthropic)\.com\b/.test(examples), 'examples never target vendor API hosts')
})

Then('examples never include raw secrets', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const examples = this.apiExamplesText as string
  assert.ok(examples.includes('$AMA_ACCESS_TOKEN'), 'examples use an environment placeholder for the token')
  const accessToken = await state.page.evaluate(() => window.localStorage.getItem('ama:e2e-access-token'))
  assert.ok(accessToken, 'authenticated page exposes an access token to compare against')
  assert.ok(!examples.includes(accessToken as string), 'examples never embed the live access token')
})

// ─── Handoff policy is generic and product-agnostic ───

Given('an agent definition can hand work to another agent by role or capability', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const maintainer = await apiJson<Json>(state.page.request, '/api/agents', {
    method: 'POST',
    data: {
      name: `${state.runId} handoff maintainer`,
      role: 'maintainer',
      handoffPolicy: { targets: [{ role: 'worker' }, { capability: 'implementation' }] },
    },
  })
  const worker = await apiJson<Json>(state.page.request, '/api/agents', {
    method: 'POST',
    data: { name: `${state.runId} handoff worker`, role: 'worker', capabilityTags: ['implementation'] },
  })
  const reviewer = await apiJson<Json>(state.page.request, '/api/agents', {
    method: 'POST',
    data: { name: `${state.runId} handoff reviewer`, role: 'reviewer' },
  })
  // A matching agent in a different project must never resolve as a candidate.
  const foreignPage = await openLocalPage()
  await authenticateE2EPage(foreignPage)
  const foreignWorker = await apiJson<Json>(foreignPage.request, '/api/agents', {
    method: 'POST',
    data: { name: `${state.runId} foreign worker`, role: 'worker', capabilityTags: ['implementation'] },
  })
  await foreignPage.close()
  this.handoff = { maintainer, worker, reviewer, foreignWorker }
  state.agent = maintainer
})

When('a runtime session requests a handoff target', async function (this: BuilderWorld) {
  const state = await ensureSignedIn(this)
  const handoff = this.handoff as HandoffState
  state.environment ??= await createEnvironment(state, { name: `${state.runId} handoff env` })
  const session = await createSession(state, { title: `${state.runId} handoff session` })
  handoff.sessionBefore = await apiJson<Json>(state.page.request, `/api/sessions/${session.id}`)
  handoff.workerBefore = await apiJson<Json>(state.page.request, `/api/agents/${handoff.worker.id}`)
  handoff.resolved = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/agents/${handoff.maintainer.id}/handoff-candidates`,
  )
  handoff.resolvedByRole = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/agents/${handoff.maintainer.id}/handoff-candidates?role=worker`,
  )
})

Then('AMA resolves candidates inside the same project scope', function (this: BuilderWorld) {
  const handoff = this.handoff as HandoffState
  const resolvedIds = (handoff.resolved as ListResponse<Json>).data.map((candidate) => candidate.id)
  assert.ok(resolvedIds.includes(handoff.worker.id), 'matching project agent resolves as a candidate')
  assert.ok(!resolvedIds.includes(handoff.reviewer.id), 'non-matching project agent is excluded')
  assert.ok(!resolvedIds.includes(handoff.maintainer.id), 'the requesting agent never resolves itself')
  assert.ok(!resolvedIds.includes(handoff.foreignWorker.id), 'agents from other projects never resolve')
  const byRoleIds = (handoff.resolvedByRole as ListResponse<Json>).data.map((candidate) => candidate.id)
  assert.deepEqual(byRoleIds, [handoff.worker.id], 'explicit role requests resolve the same project-scoped agents')
})

Then('AMA does not require any product-specific task, board, review, or issue model', function (this: BuilderWorld) {
  const handoff = this.handoff as HandoffState
  for (const candidate of (handoff.resolved as ListResponse<Json>).data) {
    assert.deepEqual(
      Object.keys(candidate).sort(),
      ['capabilityTags', 'id', 'name', 'role', 'status'],
      'candidates expose only generic agent definition fields',
    )
  }
})

Then(
  'the requesting product decides how the handoff affects its own workflow records',
  async function (this: BuilderWorld) {
    const state = await ensureSignedIn(this)
    const handoff = this.handoff as HandoffState
    // Resolution is read-only: AMA records no workflow state of its own, so the
    // session and the candidate agent are untouched after resolving targets.
    const sessionBefore = handoff.sessionBefore as Json
    const sessionAfter = await apiJson<Json>(state.page.request, `/api/sessions/${sessionBefore.id}`)
    assert.equal(sessionAfter.status, sessionBefore.status, 'resolution does not move the session lifecycle')
    assert.equal(sessionAfter.updatedAt, sessionBefore.updatedAt, 'resolution does not mutate the session record')
    const workerBefore = handoff.workerBefore as Json
    const workerAfter = await apiJson<Json>(state.page.request, `/api/agents/${workerBefore.id}`)
    assert.equal(workerAfter.updatedAt, workerBefore.updatedAt, 'resolution does not mutate the candidate agent')
  },
)
