import type { AmaClient } from '../../sdk/typescript/src/index'
import { operations } from '../../sdk/typescript/src/index'
import { isAmaSessionEventType } from '../../shared/session-events'
import { expect, test } from './fixtures'

type Json = Record<string, unknown>
type SdkList = { data: Json[]; pagination: { limit: number; hasMore: boolean; nextCursor: string | null } }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const STANDARD_AGENT_FIELDS = new Set([
  'id',
  'projectId',
  'name',
  'description',
  'instructions',
  'providerId',
  'model',
  'skills',
  'subagents',
  'role',
  'capabilityTags',
  'handoffPolicy',
  'memoryPolicy',
  'tools',
  'mcpConnectors',
  'metadata',
  'archivedAt',
  'currentVersionId',
  'version',
  'createdAt',
  'updatedAt',
])
const STANDARD_ENVIRONMENT_FIELDS = new Set([
  'id',
  'projectId',
  'name',
  'description',
  'packages',
  'variables',
  'credentialRefs',
  'hostingMode',
  'networkPolicy',
  'mcpPolicy',
  'packageManagerPolicy',
  'resourceLimits',
  'runtimeConfig',
  'metadata',
  'archivedAt',
  'currentVersionId',
  'version',
  'createdAt',
  'updatedAt',
])

// The external product owns these workflow ids; AMA only ever sees them as opaque metadata.
function externalRefs(runId: string) {
  return { product: 'agent-kanban', boardId: `board_${runId}`, taskId: `task_${runId}` }
}
function externalMetadata(refs: ReturnType<typeof externalRefs>): Json {
  return { externalProduct: refs.product, externalBoardId: refs.boardId, externalTaskId: refs.taskId }
}
function obj(value: unknown): Json {
  expect(value && typeof value === 'object' && !Array.isArray(value)).toBe(true)
  return value as Json
}

async function createAgentThroughSdk(ama: AmaClient, runId: string, refs: ReturnType<typeof externalRefs>) {
  return await ama.request<Json>('createAgent', {
    body: {
      name: `${runId} external agent`,
      instructions: 'Work items arrive from an external product over the AMA SDK.',
      model: '@cf/moonshotai/kimi-k2.6',
      metadata: externalMetadata(refs),
    },
  })
}
async function createEnvironmentThroughSdk(ama: AmaClient, runId: string, refs: ReturnType<typeof externalRefs>) {
  return await ama.request<Json>('createEnvironment', {
    body: {
      name: `${runId} external env`,
      runtimeConfig: { image: 'ama-pi-runtime' },
      metadata: externalMetadata(refs),
    },
  })
}
const readSession = (ama: AmaClient, sessionId: string) => ama.request<Json>('readSession', { path: { sessionId } })
const listEvents = (ama: AmaClient, sessionId: string) =>
  ama.request<SdkList>('listSessionEvents', { path: { sessionId }, query: { limit: 200 } })

async function waitForIdleSession(ama: AmaClient, sessionId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await readSession(ama, sessionId)
    if (session.state === 'idle') return session
    if (session.state === 'error') throw new Error(`Session startup failed: ${session.stateReason ?? 'unknown'}`)
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not become idle before timeout`)
}
async function waitForEventText(ama: AmaClient, sessionId: string, text: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const events = await listEvents(ama, sessionId)
    if (JSON.stringify(events.data).includes(text)) return events
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} events never contained "${text}"`)
}
async function createSessionThroughSdk(
  ama: AmaClient,
  runId: string,
  refs: ReturnType<typeof externalRefs>,
  agent: Json,
  environment: Json,
  extra: Json,
) {
  const created = await ama.request<Json>('createSession', {
    body: {
      agentId: obj(agent).id,
      environmentId: obj(environment).id,
      runtime: 'ama',
      title: `${runId} external session`,
      metadata: externalMetadata(refs),
      ...extra,
    },
  })
  const session = await waitForIdleSession(ama, String(created.id))
  return { created, session }
}

// [spec: projects/external-resources] External product manages standard AMA resources through the SDK.
test('external product manages standard AMA resources through the SDK [spec: projects/external-resources]', async ({
  ama,
  runId,
}) => {
  const refs = externalRefs(runId)

  const createdAgent = await createAgentThroughSdk(ama, runId, refs)
  const updatedAgent = await ama.request<Json>('updateAgent', {
    path: { agentId: String(createdAgent.id) },
    body: { description: 'Updated by the external product through the SDK.' },
  })
  const createdEnv = await createEnvironmentThroughSdk(ama, runId, refs)

  // AMA stores only standard resource fields; external ids survive only in metadata.
  const agent = await ama.request<Json>('readAgent', { path: { agentId: String(obj(updatedAgent).id) } })
  for (const key of Object.keys(agent)) {
    expect(STANDARD_AGENT_FIELDS.has(key), `agent field "${key}" is not standard`).toBe(true)
  }
  const environment = await ama.request<Json>('readEnvironment', {
    path: { environmentId: String(obj(createdEnv).id) },
  })
  for (const key of Object.keys(environment)) {
    expect(STANDARD_ENVIRONMENT_FIELDS.has(key), `environment field "${key}" is not standard`).toBe(true)
  }
  expect(obj(agent.metadata).externalTaskId).toBe(refs.taskId)
  expect(obj(environment.metadata).externalBoardId).toBe(refs.boardId)

  // No product-workflow references leak outside metadata.
  for (const resource of [agent, environment]) {
    for (const key of Object.keys(resource)) {
      expect(/external|board|task|review|pull/i.test(key), `"${key}" looks like a workflow field`).toBe(false)
    }
    const { metadata: _m, ...standard } = resource
    const serialized = JSON.stringify(standard)
    expect(serialized.includes(refs.taskId)).toBe(false)
    expect(serialized.includes(refs.boardId)).toBe(false)
  }

  // The product keeps its own mapping; AMA ids resolve back through it.
  const productRecords = new Map<string, string>()
  productRecords.set(refs.taskId, String(agent.id))
  productRecords.set(refs.boardId, String(environment.id))
  expect(
    (await ama.request<Json>('readAgent', { path: { agentId: productRecords.get(refs.taskId) as string } })).id,
  ).toBe(agent.id)
  expect(
    (
      await ama.request<Json>('readEnvironment', {
        path: { environmentId: productRecords.get(refs.boardId) as string },
      })
    ).id,
  ).toBe(environment.id)

  // The SDK inventory exposes no product-workflow concepts.
  const asyncTaskResource = /[a-z]+-tasks(\/|\b)/i
  const workflowWords = new Set(['board', 'boards', 'task', 'tasks', 'review', 'reviews'])
  const workflowOps = operations.filter((op) => {
    if (asyncTaskResource.test(op.path)) return false
    const surface = `${op.path} ${op.operationId}`
    const words = surface
      .split(/[^A-Za-z]+/)
      .flatMap((s) => s.split(/(?=[A-Z])/))
      .map((w) => w.toLowerCase())
    return words.some((w) => workflowWords.has(w)) || /pull[-_]?request/i.test(surface)
  })
  expect(workflowOps.map((op) => op.operationId)).toEqual([])
})

// [spec: projects/external-session] External product starts work by creating an AMA session.
test('external product starts work by creating an AMA session [spec: projects/external-session]', async ({
  ama,
  runId,
}) => {
  const refs = externalRefs(runId)
  const agent = await createAgentThroughSdk(ama, runId, refs)
  const environment = await createEnvironmentThroughSdk(ama, runId, refs)
  const resourceRefs = [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }]

  const { created, session } = await createSessionThroughSdk(ama, runId, refs, agent, environment, {
    resourceRefs,
    initialPrompt: `Start the external product work item for ${runId}.`,
  })
  const sessionId = String(obj(session).id)

  // Snapshots pin the selected agent/environment and are immutable after creation.
  const before = await readSession(ama, sessionId)
  expect(obj(before.agentSnapshot).agentId).toBe(obj(agent).id)
  expect(typeof obj(before.agentSnapshot).version).toBe('number')
  expect(obj(before.environmentSnapshot).environmentId).toBe(obj(environment).id)
  await ama.request<Json>('updateAgent', {
    path: { agentId: String(obj(agent).id) },
    body: { instructions: 'Changed after session creation — the snapshot must not follow.' },
  })
  const after = await readSession(ama, sessionId)
  expect(after.agentSnapshot).toEqual(before.agentSnapshot)
  expect(after.environmentSnapshot).toEqual(before.environmentSnapshot)

  // The runtime/provider/model were validated before runtime work started.
  const runtimeMetadata = obj((await readSession(ama, sessionId)).runtimeMetadata)
  expect(runtimeMetadata.runtime).toBe('ama')
  expect(runtimeMetadata.hostingMode).toBe('cloud')
  expect(runtimeMetadata.provider).toBeTruthy()
  expect(runtimeMetadata.model).toBeTruthy()

  // Stable id/status/runtime + the canonical event endpoint advertised on the connection resource.
  expect(typeof created.id === 'string' && (created.id as string).length > 0).toBe(true)
  const fetched = await readSession(ama, String(created.id))
  expect(fetched.id).toBe(created.id)
  expect('stateReason' in fetched).toBe(true)
  const connection = await ama.request<Json>('readSessionConnection', { path: { sessionId: String(created.id) } })
  expect(connection.path).toBe(`/api/v1/runtime/sessions/${created.id}/rpc`)
  const eventsOperation = operations.find((op) => op.operationId === 'listSessionEvents')
  expect(eventsOperation?.path).toBe('/api/v1/sessions/{sessionId}/events')

  // Canonical progress events exist in renderable sequence order.
  const events = await waitForEventText(ama, sessionId, `work item for ${runId}`)
  expect(events.data.length).toBeGreaterThan(0)
  for (const event of events.data) {
    expect(isAmaSessionEventType(String(event.type)), `non-canonical event type "${event.type}"`).toBe(true)
  }
  const sequences = events.data.map((e) => Number(e.sequence))
  expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
})

// [spec: projects/external-control] External product controls a running session only through AMA endpoints.
test('external product controls a running session only through AMA endpoints [spec: projects/external-control]', async ({
  ama,
  runId,
}) => {
  const refs = externalRefs(runId)
  const agent = await createAgentThroughSdk(ama, runId, refs)
  const environment = await createEnvironmentThroughSdk(ama, runId, refs)
  const { session } = await createSessionThroughSdk(ama, runId, refs, agent, environment, {})
  const sessionId = String(obj(session).id)

  const command = await ama.request<Json>('createSessionMessage', {
    path: { sessionId },
    body: { type: 'prompt', content: `external product follow-up ${runId}` },
  })
  await waitForEventText(ama, sessionId, `external product follow-up ${runId}`)
  const stopped = await ama.request<Json>('updateSession', { path: { sessionId }, body: { state: 'stopped' } })

  // The follow-up is an addressable message routed on AMA-relative channels.
  expect(typeof command.id === 'string' && (command.id as string).length > 0).toBe(true)
  expect(command.sessionId).toBe(obj(stopped).id)
  expect(command.type).toBe('prompt')
  expect(['live', 'queued'].includes(String(command.delivery))).toBe(true)
  expect(['accepted', 'delivered'].includes(String(command.state))).toBe(true)
  expect(JSON.stringify(command).includes('://')).toBe(false)

  // The command result is persisted as canonical session events, including session_stop.
  const events = await listEvents(ama, sessionId)
  expect(JSON.stringify(events.data).includes(`external product follow-up ${runId}`)).toBe(true)
  for (const event of events.data) {
    expect(isAmaSessionEventType(String(event.type)), `non-canonical event type "${event.type}"`).toBe(true)
  }
  expect(events.data.some((e) => e.type === 'session_stop')).toBe(true)
  expect((await readSession(ama, sessionId)).state).toBe('stopped')

  // The SDK inventory only targets AMA control-plane endpoints; nothing leaks a local endpoint.
  for (const op of operations) {
    expect(op.path.startsWith('/api/v1/'), `${op.operationId} must target /api/v1/`).toBe(true)
    expect(op.path.startsWith('/runtime/')).toBe(false)
  }
  const finalSession = await readSession(ama, sessionId)
  const finalEvents = await listEvents(ama, sessionId)
  for (const surface of [JSON.stringify(finalSession), JSON.stringify(finalEvents.data)]) {
    expect(/wss?:\/\//.test(surface), 'no absolute socket endpoints leak').toBe(false)
    expect(surface.includes('preview-url')).toBe(false)
    expect(/:\d{4,5}\/(exec|process|shell)/.test(surface)).toBe(false)
  }
})
