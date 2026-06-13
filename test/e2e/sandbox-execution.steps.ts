import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { apiJson, apiResponse } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  delay,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
  sessionEvents,
} from './shared-helpers'

type SandboxWorld = StepsWorld & {
  secondSession?: Json
  commandMarker?: string
  sandboxFilePath?: string
  sandboxFileContent?: string
  blockedOperationStatus?: number
  blockedCommand?: string
  allowedHost?: string
  blockedHost?: string
  blockedFetchStatus?: number
  localServiceCommand?: string
}

function state(world: SandboxWorld): E2EState {
  assert.ok(world.e2e, 'e2e state must be initialized')
  return world.e2e
}

function objectValue(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

async function setupCloudSandboxSession(world: SandboxWorld, label: string) {
  const e2e = await ensureSignedIn(world)
  e2e.agent ??= await createAgent(e2e, { name: `${e2e.runId} ${label} agent` })
  e2e.environment ??= await createEnvironment(e2e, {
    name: `${e2e.runId} ${label} env`,
    hostingMode: 'cloud',
    networkPolicy: { mode: 'unrestricted' },
  })
  e2e.latestSession = await createSession(e2e, { title: `${e2e.runId} ${label} session` })
  return e2e
}

// Drives one real agent turn through the AMA runtime endpoint. The test-mode
// prompt grammar maps the message onto a concrete sandbox tool call.
async function runRuntimePrompt(e2e: E2EState, message: string) {
  return await apiJson<Json>(e2e.page.request, `/api/v1/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message },
  })
}

async function waitForToolExecutionEnd(e2e: E2EState, predicate: (payload: Json) => boolean, label: string) {
  let observed: string[] = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await sessionEvents(e2e)
    observed = events.data.map((event) => `${event.sequence}:${event.type}`)
    const match = events.data.find(
      (event) => event.type === 'tool_execution_end' && predicate(objectValue(event.payload)),
    )
    if (match) {
      return match
    }
    await delay(500)
  }
  throw new Error(`Session ${e2e.latestSession?.id} did not persist ${label}. Events: ${observed.join(', ')}`)
}

async function findPolicyDecisionEvents(e2e: E2EState) {
  const events = await sessionEvents(e2e)
  return events.data.filter((event) => event.type === 'policy.decision')
}

async function auditRecords(e2e: E2EState, action: string) {
  return await apiJson<ListResponse<Json>>(e2e.page.request, `/api/v1/audit-records?action=${action}&limit=50`)
}

// Scoped policies are addressable resources: upsert the project-scope policy by
// replacing it when one already exists, otherwise create it.
async function upsertProjectPolicy(e2e: E2EState, body: Json) {
  const existing = await apiJson<ListResponse<Json>>(e2e.page.request, '/api/v1/policies?limit=100')
  const projectPolicy = existing.data.find((policy) => objectValue(policy.scope).level === 'project')
  const data = { scope: { level: 'project' }, ...body }
  if (projectPolicy) {
    return await apiJson<Json>(e2e.page.request, `/api/v1/policies/${projectPolicy.id}`, { method: 'PUT', data })
  }
  return await apiJson<Json>(e2e.page.request, '/api/v1/policies', { method: 'POST', data })
}

// ─── sandbox-execution: Create a sandbox for a session ───────────────────────

When('the agent needs isolated execution', { timeout: 120_000 }, async function (this: SandboxWorld) {
  await setupCloudSandboxSession(this, 'sandbox create')
})

Then('AMA creates a Cloudflare Sandbox for a cloud hosting mode session', async function (this: SandboxWorld) {
  const e2e = state(this)
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  e2e.latestSession = session
  assert.equal(objectValue(session.environmentSnapshot).hostingMode, 'cloud')
  // The v1 Session response no longer exposes the sandbox implementation detail.
  // A cloud-owned sandbox is observable through the running session lifecycle and
  // the cloud runtime metadata that drives execution.
  assert.ok(['pending', 'running', 'idle'].includes(String(session.state)), 'the session is live')
  const runtimeMetadata = objectValue(session.runtimeMetadata)
  assert.equal(runtimeMetadata.hostingMode, 'cloud', 'runtime metadata reports the cloud sandbox host')
  assert.equal(runtimeMetadata.driver, 'ama-cloud', 'a cloud sandbox executor drives the session')
  assert.equal(runtimeMetadata.backend, 'ama-cloud')
  const audit = await auditRecords(e2e, 'session.runtime.start')
  const startRecord = audit.data.find((record) => record.sessionId === session.id && record.outcome === 'success')
  assert.ok(startRecord, 'sandbox runtime startup is audited for the session')
  // The audit metadata is an internal record and still names the sandbox it created.
  assert.ok(typeof objectValue(startRecord.metadata).sandboxId === 'string', 'audit records the created sandbox')
})

Then('the sandbox is associated with the organization, project, and session', async function (this: SandboxWorld) {
  const e2e = state(this)
  const session = objectValue(e2e.latestSession)
  // The v1 session no longer exposes organizationId/sandboxId; tenant scope is
  // carried by projectId (which determines the organization), and the sandbox
  // binding is observable through the audited runtime startup for this session.
  assert.equal(session.projectId, objectValue(objectValue(e2e.auth).project).id)
  const audit = await auditRecords(e2e, 'session.runtime.start')
  const startRecord = audit.data.find((record) => record.sessionId === session.id && record.outcome === 'success')
  assert.ok(startRecord, 'the sandbox runtime startup is bound to this session')
  assert.equal(
    startRecord.projectId,
    objectValue(objectValue(e2e.auth).project).id,
    'the sandbox is bound to the project',
  )
  assert.ok(
    typeof objectValue(startRecord.metadata).sandboxId === 'string',
    'the sandbox is bound to the session through its runtime startup',
  )
})

Then('the sandbox is created from the session environment snapshot', async function (this: SandboxWorld) {
  const e2e = state(this)
  const before = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  const snapshot = objectValue(before.environmentSnapshot)
  assert.equal(snapshot.environmentId, objectValue(e2e.environment).id, 'snapshot points at the selected environment')
  assert.equal(objectValue(before.runtimeMetadata).hostingMode, snapshot.hostingMode)
  // Mutating the environment after sandbox creation must not move the
  // snapshot the sandbox was created from.
  await apiJson<Json>(e2e.page.request, `/api/v1/environments/${objectValue(e2e.environment).id}`, {
    method: 'PATCH',
    data: { description: 'Changed after sandbox creation — the session snapshot must not follow.' },
  })
  const after = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.deepEqual(after.environmentSnapshot, before.environmentSnapshot, 'sandbox keeps its environment snapshot')
})

Then('the sandbox is owned by exactly one session', { timeout: 120_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const firstSessionId = objectValue(e2e.latestSession).id
  this.secondSession = await createSession(e2e, { title: `${e2e.runId} second sandbox session` })
  // The sandbox is an internal detail; one-sandbox-per-session is observable as a
  // distinct, independently cloud-hosted session — each session owns its runtime.
  assert.notEqual(this.secondSession.id, firstSessionId, 'each session is a distinct runtime owner')
  const secondMeta = objectValue(this.secondSession.runtimeMetadata)
  assert.equal(secondMeta.hostingMode, 'cloud', 'the second session owns its own cloud sandbox runtime')
  // Each session's runtime startup is audited separately: one startup per session.
  const audit = await auditRecords(e2e, 'session.runtime.start')
  const firstStarts = audit.data.filter((record) => record.sessionId === firstSessionId && record.outcome === 'success')
  assert.equal(firstStarts.length, 1, 'exactly one runtime startup is bound to the first session')
  const firstSandboxId = objectValue(firstStarts[0]?.metadata).sandboxId
  const secondStart = audit.data.find(
    (record) => record.sessionId === this.secondSession?.id && record.outcome === 'success',
  )
  assert.notEqual(
    objectValue(secondStart?.metadata).sandboxId,
    firstSandboxId,
    'each session is created with its own distinct sandbox',
  )
})

Then('clients do not connect directly to a sandbox-owned runtime process', async function (this: SandboxWorld) {
  const e2e = state(this)
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  const connection = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${session.id}/connection`)
  assert.equal(connection.path, `/api/v1/runtime/sessions/${session.id}/rpc`, 'runtime traffic uses AMA endpoints')
  const serialized = JSON.stringify(session)
  assert.equal(serialized.includes('localhost'), false)
  assert.equal(serialized.includes('127.0.0.1'), false)
  // The AMA endpoint itself answers runtime traffic for the sandbox.
  const accepted = await runRuntimePrompt(e2e, 'hello sandbox-owner check')
  assert.equal(accepted.runtime, 'ama-cloud')
  assert.equal(accepted.accepted, true)
})

// ─── sandbox-execution: Run a command in the sandbox ─────────────────────────

When(
  'the selected session runtime dispatches an approved command tool request',
  { timeout: 120_000 },
  async function (this: SandboxWorld) {
    const e2e = await setupCloudSandboxSession(this, 'sandbox command')
    this.commandMarker = `sandbox-cmd-${e2e.runId}`
    await runRuntimePrompt(e2e, `run the sandbox command "echo ${this.commandMarker}"`)
  },
)

Then('the command runs inside the sandbox', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const marker = this.commandMarker
  assert.ok(marker, 'command marker must be set')
  const event = await waitForToolExecutionEnd(
    e2e,
    (payload) => payload.toolName === 'sandbox.exec' && JSON.stringify(payload).includes(marker),
    'the sandbox command execution result',
  )
  const payload = objectValue(event.payload)
  assert.equal(payload.isError, false, 'the approved command completed inside the sandbox')
  const details = objectValue(objectValue(payload.result).details)
  assert.equal(details.stdout, marker, 'sandbox stdout carries the command output')
})

Then(
  'stdout, stderr, exit code, and timing are recorded as session events',
  { timeout: 60_000 },
  async function (this: SandboxWorld) {
    const e2e = state(this)
    const marker = this.commandMarker
    assert.ok(marker, 'command marker must be set')
    const event = await waitForToolExecutionEnd(
      e2e,
      (payload) => JSON.stringify(payload).includes(marker),
      'the sandbox command execution result',
    )
    const details = objectValue(objectValue(objectValue(event.payload).result).details)
    assert.equal(details.stdout, marker)
    assert.equal(details.stderr, '')
    assert.equal(details.exitCode, 0)
    assert.ok(typeof details.durationMs === 'number' && details.durationMs >= 1, 'command timing is recorded')
  },
)

// ─── sandbox-execution: Manage sandbox files ─────────────────────────────────

When(
  'the selected session runtime dispatches approved file tool requests',
  { timeout: 120_000 },
  async function (this: SandboxWorld) {
    const e2e = await setupCloudSandboxSession(this, 'sandbox files')
    this.sandboxFilePath = `notes/sandbox-file-${e2e.runId}.txt`
    this.sandboxFileContent = `sandbox-file-content-${e2e.runId}`
    await runRuntimePrompt(e2e, `write the file ${this.sandboxFilePath} with content ${this.sandboxFileContent}`)
    await runRuntimePrompt(e2e, `read the file ${this.sandboxFilePath}`)
  },
)

Then(
  'file operations happen inside the Cloudflare Sandbox filesystem',
  { timeout: 60_000 },
  async function (this: SandboxWorld) {
    const e2e = state(this)
    const path = this.sandboxFilePath
    const content = this.sandboxFileContent
    assert.ok(path && content, 'file fixtures must be set')
    const writeEvent = await waitForToolExecutionEnd(
      e2e,
      (payload) => payload.toolName === 'sandbox.write' && JSON.stringify(payload).includes(path),
      'the sandbox file write result',
    )
    assert.equal(objectValue(writeEvent.payload).isError, false, 'the file write succeeded in the sandbox')
    // The read-back proves the write landed on the sandbox-owned filesystem:
    // the content only exists inside that sandbox.
    const readEvent = await waitForToolExecutionEnd(
      e2e,
      (payload) => payload.toolName === 'sandbox.read' && JSON.stringify(payload).includes(content),
      'the sandbox file read result',
    )
    const readDetails = objectValue(objectValue(objectValue(readEvent.payload).result).details)
    assert.equal(readDetails.content, content, 'the sandbox filesystem returns the written content')
  },
)

Then('file metadata is visible in the session debug view', { timeout: 90_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const path = this.sandboxFilePath
  const content = this.sandboxFileContent
  assert.ok(path && content, 'file fixtures must be set')
  const writeEvent = await waitForToolExecutionEnd(
    e2e,
    (payload) => payload.toolName === 'sandbox.write' && JSON.stringify(payload).includes(path),
    'the sandbox file write result',
  )
  const writeDetails = objectValue(objectValue(objectValue(writeEvent.payload).result).details)
  assert.equal(writeDetails.path, `/workspace/${path}`, 'the canonical event exposes the file path metadata')
  assert.equal(writeDetails.bytes, content.length, 'the canonical event exposes the file size metadata')
  // The same metadata is inspectable in the console session debug view.
  await e2e.page.goto(`/sessions/${e2e.latestSession?.id}`)
  const toolsTab = e2e.page.getByRole('tab', { name: 'Tools' })
  await expect(toolsTab).toBeVisible()
  await toolsTab.click()
  const writeEntry = e2e.page.locator('details[data-status]', { hasText: 'sandbox.write' })
  await expect(writeEntry).toHaveCount(1)
  await writeEntry.locator('summary').click()
  await expect(writeEntry.getByText(new RegExp(path.replaceAll('.', '\\.'))).first()).toBeVisible()
})

// ─── sandbox-execution: End sandbox with the session ─────────────────────────

When('the session stops, completes, or fails', { timeout: 120_000 }, async function (this: SandboxWorld) {
  const e2e = await setupCloudSandboxSession(this, 'sandbox end')
  // Touch the sandbox so its termination ends real workspace state.
  await runRuntimePrompt(e2e, `run the sandbox command "echo sandbox-end-${e2e.runId}"`)
  e2e.latestSession = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`, {
    method: 'PATCH',
    data: { state: 'stopped' },
  })
})

Then('the sandbox is terminated with the session', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  assert.equal(session.state, 'stopped')
  assert.ok(session.stoppedAt, 'the stop time is recorded')
  const events = await sessionEvents(e2e)
  const stopEvent = events.data.find((event) => event.type === 'session_stop')
  assert.ok(stopEvent, 'the lifecycle stream records the sandbox-owning session stop')
  // The session response no longer exposes sandboxId; the internal stop event still
  // names the sandbox it tore down, which is the observable termination signal.
  assert.ok(typeof objectValue(stopEvent.metadata).sandboxId === 'string', 'the stop event names the sandbox')
  // The terminated sandbox accepts no further runtime work.
  const blocked = await apiResponse(e2e.page.request, `/api/v1/runtime/sessions/${session.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message: `run the sandbox command "echo after-stop-${e2e.runId}"` },
  })
  assert.equal(blocked.status(), 409, 'the stopped session cannot execute sandbox work')
})

Then('the sandbox is not reused by another session', { timeout: 120_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const stoppedSessionId = objectValue(e2e.latestSession).id
  // The terminated session's sandbox is read from its internal stop event, since
  // sandboxId is no longer on the session response.
  const stoppedEvents = await sessionEvents(e2e)
  const stoppedSandboxId = objectValue(
    stoppedEvents.data.find((event) => event.type === 'session_stop')?.metadata,
  ).sandboxId
  assert.ok(stoppedSandboxId, 'the stopped session owned a sandbox')
  const created = await createSession(e2e, { title: `${e2e.runId} post-stop session` })
  const nextSession = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${created.id}`)
  assert.equal(
    objectValue(nextSession.runtimeMetadata).hostingMode,
    'cloud',
    'the next session gets its own cloud sandbox',
  )
  // The new session's sandbox comes from its own audited runtime startup and is
  // never the terminated session's sandbox.
  const audit = await auditRecords(e2e, 'session.runtime.start')
  const nextStart = audit.data.find((record) => record.sessionId === created.id && record.outcome === 'success')
  const nextSandboxId = objectValue(nextStart?.metadata).sandboxId
  assert.ok(nextSandboxId, 'the next session gets a sandbox')
  assert.notEqual(nextSandboxId, stoppedSandboxId, 'a stopped sandbox is never handed to another session')
  // Only the terminated session is bound to its sandbox — across all startup
  // records, that sandbox id appears once, for the original session.
  const owners = audit.data.filter(
    (record) => objectValue(record.metadata).sandboxId === stoppedSandboxId && record.outcome === 'success',
  )
  assert.deepEqual(
    owners.map((record) => record.sessionId),
    [stoppedSessionId],
    'the terminated sandbox stays bound to its original session only',
  )
})

// ─── sandbox-execution: Do not expose sandbox ports ──────────────────────────

When('a sandbox process starts a local service', { timeout: 120_000 }, async function (this: SandboxWorld) {
  const e2e = await setupCloudSandboxSession(this, 'sandbox ports')
  this.localServiceCommand = 'python3 -m http.server 8080'
  await runRuntimePrompt(e2e, `run the sandbox command "${this.localServiceCommand}"`)
  await waitForToolExecutionEnd(
    e2e,
    (payload) => JSON.stringify(payload).includes('http.server'),
    'the local service command execution',
  )
})

Then('the platform does not expose a public port or preview URL for that service', async function (this: SandboxWorld) {
  const e2e = state(this)
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  for (const key of ['previewUrl', 'previewUrls', 'publicUrl', 'exposedPorts', 'ports', 'portMappings']) {
    assert.equal(key in session, false, `session surface must not expose ${key}`)
  }
  const events = await sessionEvents(e2e)
  const serialized = JSON.stringify(session) + JSON.stringify(events.data)
  assert.equal(/previewUrl|exposedPort|publicUrl|portMapping/i.test(serialized), false)
  assert.equal(/https?:\/\/[^"\s]*:8080/.test(serialized), false, 'no reachable URL for the sandbox port is exposed')
})

Then('access remains internal to the session runtime', async function (this: SandboxWorld) {
  const e2e = state(this)
  const session = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${e2e.latestSession?.id}`)
  const connection = await apiJson<Json>(e2e.page.request, `/api/v1/sessions/${session.id}/connection`)
  assert.equal(
    connection.path,
    `/api/v1/runtime/sessions/${session.id}/rpc`,
    'the AMA runtime endpoint is the only session execution surface',
  )
  const events = await sessionEvents(e2e)
  const serialized = JSON.stringify(session) + JSON.stringify(events.data)
  assert.equal(serialized.includes('localhost'), false)
  assert.equal(serialized.includes('127.0.0.1'), false)
})

// ─── sandbox-execution: Enforce sandbox policy ───────────────────────────────

Given(
  'a project policy disables network access or restricts commands',
  { timeout: 120_000 },
  async function (this: SandboxWorld) {
    const e2e = await ensureSignedIn(this)
    await upsertProjectPolicy(e2e, { sandboxPolicy: { blockedCommands: ['rm'] } })
    await setupCloudSandboxSession(this, 'sandbox policy')
  },
)

When('the agent attempts a blocked sandbox operation', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  this.blockedCommand = 'rm -rf /workspace'
  const response = await apiResponse(e2e.page.request, `/api/v1/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message: `run the sandbox command "${this.blockedCommand}"` },
  })
  this.blockedOperationStatus = response.status()
})

Then('the platform denies the operation', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  assert.equal(this.blockedOperationStatus, 500, 'the blocked sandbox turn surfaces a runtime failure')
  const events = await sessionEvents(e2e)
  const serialized = JSON.stringify(events.data)
  assert.equal(
    serialized.includes(`simulated sandbox exec: ${this.blockedCommand}`),
    false,
    'the blocked command never executed in the sandbox',
  )
  const failedExecution = events.data.find(
    (event) => event.type === 'tool_execution_end' && objectValue(event.payload).isError === true,
  )
  assert.ok(failedExecution, 'the denied tool call ends as a failed execution')
})

Then('records a sandbox policy event', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const policyEvents = await findPolicyDecisionEvents(e2e)
  const denial = policyEvents.find((event) => {
    const payload = objectValue(event.payload)
    return payload.allowed === false && payload.command === this.blockedCommand
  })
  assert.ok(denial, 'the denied sandbox command is recorded as a canonical policy event')
  assert.equal(objectValue(denial.payload).category, 'sandbox_command')
  const audit = await auditRecords(e2e, 'runtime_sandbox.operation')
  assert.ok(
    audit.data.some((record) => record.sessionId === objectValue(e2e.latestSession).id && record.outcome === 'denied'),
    'the denial is auditable',
  )
})

// ─── environments / environments-api: network policy at the sandbox seam ─────

Given('an environment allows only selected outbound hosts', { timeout: 120_000 }, async function (this: SandboxWorld) {
  const e2e = await ensureSignedIn(this)
  this.allowedHost = `allowed-${e2e.runId}.example.com`
  this.blockedHost = `blocked-${e2e.runId}.example.net`
  e2e.agent = await createAgent(e2e, { name: `${e2e.runId} network policy agent` })
  e2e.environment = await createEnvironment(e2e, {
    name: `${e2e.runId} network policy env`,
    hostingMode: 'cloud',
    networkPolicy: { mode: 'restricted', allowedHosts: [this.allowedHost] },
  })
  e2e.latestSession = await createSession(e2e, { title: `${e2e.runId} network policy session` })
})

async function attemptRestrictedNetworkAccess(world: SandboxWorld, blockedQuery: string) {
  const e2e = state(world)
  assert.ok(world.allowedHost && world.blockedHost, 'network policy hosts must be set')
  await runRuntimePrompt(e2e, `fetch https://${world.allowedHost}/status`)
  const blocked = await apiResponse(e2e.page.request, `/api/v1/runtime/sessions/${e2e.latestSession?.id}/rpc`, {
    method: 'POST',
    data: { type: 'prompt', message: `fetch https://${world.blockedHost}/${blockedQuery}` },
  })
  world.blockedFetchStatus = blocked.status()
}

When('a session sandbox attempts network access', { timeout: 120_000 }, async function (this: SandboxWorld) {
  // The blocked URL carries a credential-style query value: policy events must
  // record the decision without persisting it.
  await attemptRestrictedNetworkAccess(this, 'data?token=raw-network-secret-marker')
})

Then('allowed hosts are reachable', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const allowedHost = this.allowedHost
  assert.ok(allowedHost, 'allowed host must be set')
  const event = await waitForToolExecutionEnd(
    e2e,
    (payload) => payload.toolName === 'sandbox.fetch' && JSON.stringify(payload).includes(allowedHost),
    'the allowed outbound fetch result',
  )
  const details = objectValue(objectValue(objectValue(event.payload).result).details)
  assert.equal(details.host, allowedHost)
  assert.equal(details.status, 200, 'the allowed host responded through the sandbox network')
})

Then(
  'blocked hosts fail with a policy event recorded on the session',
  { timeout: 60_000 },
  async function (this: SandboxWorld) {
    const e2e = state(this)
    assert.equal(this.blockedFetchStatus, 500, 'the blocked outbound turn surfaces a runtime failure')
    const policyEvents = await findPolicyDecisionEvents(e2e)
    const denial = policyEvents.find((event) => {
      const payload = objectValue(event.payload)
      return payload.allowed === false && payload.host === this.blockedHost
    })
    assert.ok(denial, 'the blocked host is recorded as a canonical policy event on the session')
    const payload = objectValue(denial.payload)
    assert.equal(payload.category, 'sandbox_network')
    assert.equal(payload.ruleId, 'environment.networkPolicy.allowedHosts')
    const events = await sessionEvents(e2e)
    const blockedHost = this.blockedHost as string
    assert.equal(
      JSON.stringify(events.data).includes(`simulated fetch ${blockedHost}`),
      false,
      'the blocked host was never fetched from the sandbox',
    )
  },
)

Then('policy event payloads do not include secrets', async function (this: SandboxWorld) {
  const e2e = state(this)
  const policyEvents = await findPolicyDecisionEvents(e2e)
  assert.ok(policyEvents.length > 0, 'policy events must exist')
  const serialized = JSON.stringify(policyEvents)
  assert.equal(serialized.includes('raw-network-secret-marker'), false, 'policy payloads never carry secret values')
})

When('a sandbox process attempts outbound network access', { timeout: 120_000 }, async function (this: SandboxWorld) {
  await attemptRestrictedNetworkAccess(this, 'outbound-check')
})

Then('the runtime allows only matching hosts', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const allowedHost = this.allowedHost
  assert.ok(allowedHost, 'allowed host must be set')
  const event = await waitForToolExecutionEnd(
    e2e,
    (payload) => payload.toolName === 'sandbox.fetch' && JSON.stringify(payload).includes(allowedHost),
    'the allowed outbound fetch result',
  )
  assert.equal(objectValue(event.payload).isError, false, 'the matching host fetch completed')
  assert.equal(this.blockedFetchStatus, 500, 'the non-matching host attempt failed')
  const events = await sessionEvents(e2e)
  assert.equal(
    JSON.stringify(events.data).includes(`simulated fetch ${this.blockedHost}`),
    false,
    'no sandbox network operation ran against the blocked host',
  )
})

Then('blocked attempts are recorded as policy events', { timeout: 60_000 }, async function (this: SandboxWorld) {
  const e2e = state(this)
  const policyEvents = await findPolicyDecisionEvents(e2e)
  const denial = policyEvents.find((event) => {
    const payload = objectValue(event.payload)
    return payload.allowed === false && payload.host === this.blockedHost
  })
  assert.ok(denial, 'the blocked outbound attempt is a canonical policy event')
  assert.equal(objectValue(denial.payload).operation, 'network')
})
