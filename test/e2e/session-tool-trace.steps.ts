import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, apiResponse } from './local-app'
import {
  claimRunnerLease,
  createAgent,
  createAndActivateRunner,
  createEnvironment,
  createSelfHostedSession,
  createSession,
  delay,
  type E2EState,
  ensureSignedIn,
  type Json,
  type StepsWorld,
  sessionEvents,
  uploadRunnerEvent,
} from './shared-helpers'

const PROMPT_SECRET_MARKER = 'raw-trace-secret-marker'
const TOOL_SECRET_MARKER = 'raw-tool-secret-marker'

type ToolTraceWorld = StepsWorld & {
  pairedToolCallId?: string
  orphanToolCallId?: string
  failedToolCallId?: string
  succeededToolCallId?: string
  transcriptPrompt?: string
}

function state(world: ToolTraceWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e
}

async function waitForToolEvents(e2e: E2EState, predicate: (events: Json[]) => boolean, description: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const events = await sessionEvents(e2e)
    if (predicate(events.data)) {
      return events.data
    }
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function openToolTraceView(e2e: E2EState) {
  await e2e.page.goto(`/sessions/${e2e.latestSession?.id}`)
  const toolsTab = e2e.page.getByRole('tab', { name: 'Tools' })
  await expect(toolsTab).toBeVisible()
  await toolsTab.click()
  await expect(toolsTab).toHaveAttribute('aria-selected', 'true')
}

async function assertNoMobileHorizontalOverflow(page: Page) {
  const desktopViewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement
    return root ? root.scrollWidth - root.clientWidth : 0
  })
  assert.ok(overflow <= 1, `Expected no horizontal page overflow at 390px, got ${overflow}px`)
  if (desktopViewport) {
    await page.setViewportSize(desktopViewport)
  }
}

async function assertPageTextOmits(page: Page, marker: string) {
  const bodyText = await page.evaluate(() => document.body.innerText)
  assert.ok(!bodyText.includes(marker), `Raw secret marker must never render: ${marker}`)
}

// ─── Scenario: Inspect tool trace ─────────────────────────────────────────────

Given('a session has tool calls', { timeout: 120_000 }, async function (this: ToolTraceWorld) {
  const e2e = await ensureSignedIn(this)
  e2e.agent = await createAgent(e2e, { name: `${e2e.runId} tool trace agent`, allowedTools: ['sandbox.exec'] })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} tool trace env` })
  e2e.latestSession = await createSession(e2e)
  // A status prompt drives the real agent loop through a sandbox.exec
  // round-trip; the credential-style marker must be redacted before storage.
  await apiJson<Json>(e2e.page.request, `/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message: `inspect the sandbox status using token=${PROMPT_SECRET_MARKER}` },
  })
  // Block git and drive a second real turn so the same trace also contains a
  // policy-denied, failed tool execution.
  await apiJson<Json>(e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: { sandboxPolicy: { blockedCommands: ['git'] } },
  })
  const blocked = await apiResponse(e2e.page.request, `/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message: 'check the sandbox status again' },
  })
  assert.equal(blocked.status(), 500, 'the policy-blocked tool turn surfaces a runtime error')
  await waitForToolEvents(
    e2e,
    (events) => events.filter((event) => event.type === 'tool_execution_end').length >= 2,
    'two persisted tool executions',
  )
})

When('the user opens session debug view', { timeout: 60_000 }, async function (this: ToolTraceWorld) {
  await openToolTraceView(state(this))
})

Then(
  'tool inputs, outputs, approval state, errors, and timing are visible with secrets redacted',
  { timeout: 90_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    const entries = page.locator('details[data-status]')
    await expect(entries).toHaveCount(2)

    const completed = page.locator('details[data-status="completed"]')
    await expect(completed).toHaveCount(1)
    await expect(completed.getByText('sandbox.exec', { exact: true })).toBeVisible()
    await expect(completed.getByText('approved', { exact: true })).toBeVisible()
    await expect(completed.getByText('Input', { exact: true })).toBeVisible()
    await expect(completed.getByText('Output', { exact: true })).toBeVisible()
    await expect(completed.getByText(/git status/).first()).toBeVisible()
    // Expandable per-call detail keeps the full input/output payloads.
    await completed.locator('summary').click()
    await expect(completed.getByText('Input detail')).toBeVisible()
    await expect(completed.getByText(/"command": "git status"/)).toBeVisible()

    const failed = page.locator('details[data-status="failed"]')
    await expect(failed).toHaveCount(1)
    await expect(failed.getByText('failed', { exact: true })).toBeVisible()
    await expect(failed.getByText('denied', { exact: true })).toBeVisible()
    await expect(failed.getByText('Sandbox command is blocked by policy.').first()).toBeVisible()

    // Timing is visible per call.
    await expect(page.getByText(/^\d+ms$|^\d+\.\d+s$/).first()).toBeVisible()
    await assertPageTextOmits(page, PROMPT_SECRET_MARKER)

    // The transcript surface shows the redacted stand-in for the leaked value.
    await page.getByRole('tab', { name: 'Transcript' }).click()
    await expect(page.getByText('[REDACTED]').first()).toBeVisible()
    await assertPageTextOmits(page, PROMPT_SECRET_MARKER)

    await page.getByRole('tab', { name: 'Tools' }).click()
    await assertNoMobileHorizontalOverflow(page)
  },
)

// ─── Scenario: Pair tool results with tool calls ──────────────────────────────

Given(
  'a session emits a tool call and a later tool result',
  { timeout: 120_000 },
  async function (this: ToolTraceWorld) {
    const e2e = await ensureSignedIn(this)
    await createSelfHostedSession(e2e)
    await createAndActivateRunner(e2e)
    await claimRunnerLease(e2e)
    this.pairedToolCallId = `call_pair_${e2e.runId}`
    this.orphanToolCallId = `call_orphan_${e2e.runId}`
    await uploadRunnerEvent(e2e, { type: 'turn_start', payload: {} })
    await uploadRunnerEvent(e2e, {
      type: 'tool_execution_start',
      payload: { toolCallId: this.pairedToolCallId, toolName: 'sandbox.exec', args: { command: 'git status --short' } },
    })
    await uploadRunnerEvent(e2e, {
      type: 'tool_execution_end',
      payload: {
        toolCallId: this.pairedToolCallId,
        toolName: 'sandbox.exec',
        result: { content: [{ type: 'text', text: 'workspace clean' }] },
        isError: false,
        durationMs: 1250,
      },
    })
    // A result the runner reports without ever reporting the call: the page
    // must degrade gracefully instead of crashing.
    await uploadRunnerEvent(e2e, {
      type: 'tool_execution_end',
      payload: {
        toolCallId: this.orphanToolCallId,
        toolName: 'sandbox.read',
        result: { content: [{ type: 'text', text: 'orphan result payload' }] },
        isError: false,
      },
    })
    await uploadRunnerEvent(e2e, { type: 'turn_end', payload: {} })
    const events = await waitForToolEvents(
      e2e,
      (stored) => stored.filter((event) => String(event.type).startsWith('tool_execution_')).length >= 3,
      'persisted runner tool events',
    )
    // The canonical protocol pairs call and result through one correlation id.
    const paired = events.filter((event) => event.correlationId === `tool:${this.pairedToolCallId}`)
    assert.deepEqual(
      paired.map((event) => event.type),
      ['tool_execution_start', 'tool_execution_end'],
      'tool call and result share one canonical correlation id',
    )
  },
)

When('the user opens transcript or debug view', { timeout: 60_000 }, async function (this: ToolTraceWorld) {
  await openToolTraceView(state(this))
})

Then(
  'the result shows the matching tool name, duration, approval state, and error state',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    const paired = page.locator('details[data-status="completed"]', { hasText: 'sandbox.exec' })
    await expect(paired).toHaveCount(1)
    await expect(paired.getByText('completed', { exact: true })).toBeVisible()
    await expect(paired.getByText('approved', { exact: true })).toBeVisible()
    await expect(paired.getByText('1.3s', { exact: true })).toBeVisible()
    await expect(paired.getByText('workspace clean', { exact: true })).toBeVisible()
  },
)

Then(
  'orphaned results degrade gracefully without crashing the page',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    const orphan = page.locator('details[data-status]', { hasText: 'sandbox.read' })
    await expect(orphan).toHaveCount(1)
    await expect(
      orphan.getByText('Result without a recorded tool call. Showing the result data that was received.'),
    ).toBeVisible()
    await expect(orphan.getByText('orphan result payload', { exact: true })).toBeVisible()
    // The page survives the orphaned data: tab navigation keeps working.
    await page.getByRole('tab', { name: 'Transcript' }).click()
    const toolsTab = page.getByRole('tab', { name: 'Tools' })
    await toolsTab.click()
    await expect(toolsTab).toHaveAttribute('aria-selected', 'true')
  },
)

// ─── Scenario: Display failed tools clearly ───────────────────────────────────

Given('a tool result is marked as failed', { timeout: 120_000 }, async function (this: ToolTraceWorld) {
  const e2e = await ensureSignedIn(this)
  await createSelfHostedSession(e2e)
  await createAndActivateRunner(e2e)
  await claimRunnerLease(e2e)
  this.succeededToolCallId = `call_ok_${e2e.runId}`
  this.failedToolCallId = `call_fail_${e2e.runId}`
  await uploadRunnerEvent(e2e, { type: 'turn_start', payload: {} })
  await uploadRunnerEvent(e2e, {
    type: 'tool_execution_start',
    payload: { toolCallId: this.succeededToolCallId, toolName: 'sandbox.exec', args: { command: 'ls /workspace' } },
  })
  await uploadRunnerEvent(e2e, {
    type: 'tool_execution_end',
    payload: {
      toolCallId: this.succeededToolCallId,
      toolName: 'sandbox.exec',
      result: { content: [{ type: 'text', text: 'README.md' }] },
      isError: false,
      durationMs: 25,
    },
  })
  // The failing call carries credential material in its input; the platform
  // must store the safe replacement, never the raw value.
  await uploadRunnerEvent(e2e, {
    type: 'tool_execution_start',
    payload: {
      toolCallId: this.failedToolCallId,
      toolName: 'sandbox.exec',
      args: { command: 'deploy --target production', apiKey: TOOL_SECRET_MARKER },
    },
  })
  await uploadRunnerEvent(e2e, {
    type: 'tool_execution_end',
    payload: {
      toolCallId: this.failedToolCallId,
      toolName: 'sandbox.exec',
      result: { content: [{ type: 'text', text: 'Command failed: unauthorized' }] },
      isError: true,
      durationMs: 40,
    },
  })
  await uploadRunnerEvent(e2e, { type: 'turn_end', payload: {} })
  await waitForToolEvents(
    e2e,
    (stored) =>
      stored.some(
        (event) =>
          event.type === 'tool_execution_end' &&
          event.correlationId === `tool:${this.failedToolCallId}` &&
          (event.payload as Json).isError === true,
      ),
    'a persisted failed tool result',
  )
})

When('the user views the event', { timeout: 60_000 }, async function (this: ToolTraceWorld) {
  await openToolTraceView(state(this))
})

Then(
  'the event is visually distinguishable from a successful result',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    const failed = page.locator('details[data-status="failed"]')
    const succeeded = page.locator('details[data-status="completed"]')
    await expect(failed).toHaveCount(1)
    await expect(succeeded).toHaveCount(1)
    await expect(failed.getByText('failed', { exact: true })).toBeVisible()
    await expect(succeeded.getByText('completed', { exact: true })).toBeVisible()
    const failedClass = await failed.getAttribute('class')
    const succeededClass = await succeeded.getAttribute('class')
    assert.ok(failedClass?.includes('destructive'), 'failed results use destructive styling')
    assert.ok(!succeededClass?.includes('destructive'), 'successful results stay neutral')
  },
)

Then('safe error details are visible', { timeout: 60_000 }, async function (this: ToolTraceWorld) {
  const page = state(this).page
  const failed = page.locator('details[data-status="failed"]')
  await expect(failed.getByText('Command failed: unauthorized').first()).toBeVisible()
  await failed.locator('summary').click()
  await expect(failed.getByText('Error detail')).toBeVisible()
})

Then(
  'raw input\\/output values that contain secrets remain redacted',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    const failed = page.locator('details[data-status="failed"]')
    await expect(failed.getByText(/"apiKey": "\[REDACTED\]"/)).toBeVisible()
    await assertPageTextOmits(page, TOOL_SECRET_MARKER)
    await assertNoMobileHorizontalOverflow(page)
  },
)

// ─── Scenario: Inspect a session transcript (web-ui.feature) ──────────────────

Given(
  'a session has messages, tool calls, and sandbox events',
  { timeout: 120_000 },
  async function (this: ToolTraceWorld) {
    const e2e = await ensureSignedIn(this)
    e2e.agent = await createAgent(e2e, { name: `${e2e.runId} transcript agent`, allowedTools: ['sandbox.exec'] })
    e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} transcript env` })
    e2e.latestSession = await createSession(e2e)
    this.transcriptPrompt = `inspect the sandbox status for ${e2e.runId}`
    await apiJson<Json>(e2e.page.request, `/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
      method: 'POST',
      data: { type: 'prompt', message: this.transcriptPrompt },
    })
    await waitForToolEvents(
      e2e,
      (events) =>
        events.some((event) => event.type === 'tool_execution_end') &&
        events.some((event) => event.type === 'message_end'),
      'persisted transcript and tool events',
    )
  },
)

When('the user opens the session detail page', { timeout: 60_000 }, async function (this: ToolTraceWorld) {
  const e2e = state(this)
  await e2e.page.goto(`/sessions/${e2e.latestSession?.id}`)
  await expect(e2e.page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
})

Then(
  'the transcript view shows selected runtime messages as chat turns',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    assert.ok(this.transcriptPrompt, 'transcript prompt must be recorded')
    const userTurn = page.locator('article[data-role="user"]', { hasText: this.transcriptPrompt })
    await expect(userTurn.first()).toBeVisible()
    const assistantTurn = page.locator('article[data-role="assistant"]', { hasText: 'Tool result observed:' })
    await expect(assistantTurn.first()).toBeVisible()
  },
)

Then(
  'tool calls render with structured status, input summary, output summary, and duration',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    await expect(page.getByText('sandbox.exec').first()).toBeVisible()
    await expect(page.getByText('success').first()).toBeVisible()
    await expect(page.getByText('Input').first()).toBeVisible()
    await expect(page.getByText('Output').first()).toBeVisible()
    await expect(page.getByText(/git status/).first()).toBeVisible()
    await expect(page.getByText(/^\d+ms$|^\d+\.\d+s$/).first()).toBeVisible()
  },
)

Then(
  'the debug view shows runtime events with structured details',
  { timeout: 60_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    await page.getByRole('tab', { name: 'Debug' }).click()
    const toolRow = page.locator('details', { hasText: 'Tool execution completed' }).first()
    await expect(toolRow).toBeVisible()
    await expect(page.getByText('tool', { exact: true }).first()).toBeVisible()
    await toolRow.locator('summary').click()
    await expect(toolRow.getByText(/"toolCallId"/).first()).toBeVisible()
  },
)

Then(
  'the composer sends normal chat messages instead of a task form',
  { timeout: 90_000 },
  async function (this: ToolTraceWorld) {
    const page = state(this).page
    await page.getByRole('tab', { name: 'Transcript' }).click()
    const composer = page.getByPlaceholder('Send a message to the agent')
    await expect(composer).toBeVisible()
    await expect(composer).toBeEnabled({ timeout: 30_000 })
    const chatMessage = `hello transcript check ${Date.now()}`
    await composer.fill(chatMessage)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(`AMA runtime processed: ${chatMessage}`).first()).toBeVisible({ timeout: 60_000 })
  },
)
