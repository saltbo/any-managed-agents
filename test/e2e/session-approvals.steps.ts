import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

type ApprovalsWorld = StepsWorld & {
  pendingApproval?: Json
  decisionResponse?: Json
}

interface ApprovalsState {
  page: { request: Parameters<typeof apiJson>[0] }
  latestSession?: Json
}

function e2eState(world: ApprovalsWorld) {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e as unknown as ApprovalsState & { runId: string }
}

async function setupApprovalGatedSession(world: ApprovalsWorld) {
  const e2e = await ensureSignedIn(world)
  // sandbox.exec is declared a sensitive tool through the governance policy.
  await apiJson<Json>(e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: { toolPolicy: { requireApprovalTools: ['sandbox.exec'] } },
  })
  e2e.agent = await createAgent(e2e, {
    name: `${e2e.runId} approval agent`,
    allowedTools: ['sandbox.exec'],
  })
  e2e.environment = await createEnvironment(e2e, { name: `${e2e.runId} approval env` })
  e2e.latestSession = await createSession(e2e)
  return e2e
}

async function requestSensitiveTool(world: ApprovalsWorld) {
  const e2e = e2eState(world)
  // A status prompt drives the real agent loop into a sandbox.exec tool call.
  await apiJson<Json>(e2e.page.request, `/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { message: 'inspect the sandbox status' },
  })
}

async function readSession(world: ApprovalsWorld) {
  const e2e = e2eState(world)
  return await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}`)
}

async function listApprovals(world: ApprovalsWorld) {
  const e2e = e2eState(world)
  return await apiJson<{ data: Json[] }>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}/approvals`)
}

async function listEvents(world: ApprovalsWorld) {
  const e2e = e2eState(world)
  return await apiJson<ListResponse<Json>>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}/events?limit=200`)
}

function toolExecutionEvents(events: ListResponse<Json>) {
  return events.data.filter((event) => String(event.type).startsWith('tool_execution'))
}

// ─── tools-mcp feature background ───

Given('a project has tool and MCP policies', async function (this: ApprovalsWorld) {
  const e2e = await ensureSignedIn(this)
  await apiJson<Json>(e2e.page.request, '/api/governance/policy', {
    method: 'PUT',
    data: {
      toolPolicy: { requireApprovalTools: ['sandbox.exec'] },
      mcpPolicy: { blockedConnectors: [] },
    },
  })
})

// ─── tools-mcp: Require approval for sensitive tools ───

Given('a tool requires human approval', async function (this: ApprovalsWorld) {
  await setupApprovalGatedSession(this)
})

When('the agent requests that tool', async function (this: ApprovalsWorld) {
  await requestSensitiveTool(this)
})

Then('the session pauses for approval', async function (this: ApprovalsWorld) {
  const session = await readSession(this)
  assert.equal(session.status, 'idle', 'the paused session is idle')
  assert.equal(session.statusReason, 'requires-action', 'the pause carries the requires-action reason')
  const approvals = await listApprovals(this)
  assert.equal(approvals.data.length, 1, 'one approval is pending')
  assert.equal(approvals.data[0]?.toolName, 'sandbox.exec')
  const pending = approvals.data[0]
  assert.ok(pending, 'pending approval must exist')
  this.pendingApproval = pending
})

Then('the tool does not execute until an authorized user approves it', async function (this: ApprovalsWorld) {
  const e2e = e2eState(this)
  const before = await listEvents(this)
  // The tool call request is recorded, but no execution result may exist
  // until an authorized user approves it.
  assert.ok(
    !before.data.some((event) => event.type === 'tool_execution_end'),
    'no tool executed while approval is pending',
  )

  const approval = this.pendingApproval as Json
  await apiJson<Json>(e2e.page.request, `/api/sessions/${e2e.latestSession?.id}/approvals/${approval.id}`, {
    method: 'POST',
    data: { decision: 'approve' },
  })

  const after = await listEvents(this)
  const toolEvents = toolExecutionEvents(after)
  assert.ok(
    toolEvents.some((event) => event.type === 'tool_execution_end'),
    'the approved tool executed and recorded its result',
  )
  const session = await readSession(this)
  assert.equal(session.statusReason, null, 'the requires-action reason clears after approval')
})

// ─── sessions-api: Require user action for approvals and custom tools ───

Given('a running session reaches a tool approval or custom tool call', async function (this: ApprovalsWorld) {
  await setupApprovalGatedSession(this)
})

When('the runtime requires user action', async function (this: ApprovalsWorld) {
  await requestSensitiveTool(this)
})

Then(
  'the session becomes idle with a requiresAction reason and related event ids',
  async function (this: ApprovalsWorld) {
    const session = await readSession(this)
    assert.equal(session.status, 'idle')
    assert.equal(session.statusReason, 'requires-action')
    const approvals = await listApprovals(this)
    assert.equal(approvals.data.length, 1)
    const relatedEventIds = approvals.data[0]?.relatedEventIds as string[]
    assert.ok(Array.isArray(relatedEventIds) && relatedEventIds.length > 0, 'the approval links its request events')
    const events = await listEvents(this)
    for (const eventId of relatedEventIds) {
      assert.ok(
        events.data.some((event) => event.id === eventId),
        `related event ${eventId} is part of the canonical stream`,
      )
    }
    const pending = approvals.data[0]
    assert.ok(pending, 'pending approval must exist')
    this.pendingApproval = pending
  },
)

When('the user sends a tool approval, denial, or custom tool result', async function (this: ApprovalsWorld) {
  const e2e = e2eState(this)
  const approval = this.pendingApproval as Json
  this.decisionResponse = await apiJson<Json>(
    e2e.page.request,
    `/api/sessions/${e2e.latestSession?.id}/approvals/${approval.id}`,
    {
      method: 'POST',
      data: { decision: 'approve', result: { stdout: 'custom tool outcome', exitCode: 0 } },
    },
  )
})

Then('the runtime resumes with that result', async function (this: ApprovalsWorld) {
  const events = await listEvents(this)
  const serialized = JSON.stringify(events.data)
  assert.ok(serialized.includes('custom tool outcome'), 'the provided custom result entered the runtime history')
  const session = await readSession(this)
  assert.equal(session.status, 'idle', 'the resumed turn ran to completion')
  assert.equal(session.statusReason, null)
})

Then('all approval decisions are recorded as audit-safe events', async function (this: ApprovalsWorld) {
  const e2e = e2eState(this)
  const events = await listEvents(this)
  const policyEvents = events.data.filter((event) => event.type === 'policy.decision')
  const request = policyEvents.find((event) => JSON.stringify(event.payload).includes('tool_approval_request'))
  const decision = policyEvents.find((event) => JSON.stringify(event.payload).includes('tool_approval_decision'))
  assert.ok(request, 'the approval request is a canonical policy event')
  assert.ok(decision, 'the approval decision is a canonical policy event')
  assert.equal((decision?.payload as Record<string, unknown>).allowed, true, 'the decision records the approval')

  const audit = await apiJson<ListResponse<Json>>(
    e2e.page.request,
    '/api/audit-records?action=session.tool_approval_approved&limit=20',
  )
  assert.ok(
    audit.data.some((record) => record.sessionId === e2e.latestSession?.id),
    'the approval decision is auditable',
  )
})
