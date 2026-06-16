import { SELF } from 'cloudflare:test'
import { isAmaSessionEventType } from '@shared/session-events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AmaClient, operations } from '../../sdk/typescript/src/index'
import { seedPlatformProvider, signIn } from './auth'

// Integration port of the generated-SDK journey from e2e/projects.spec.ts. The
// SDK calls global fetch(origin + path); in the integration pool there is no HTTP
// origin, so we route fetch to the assembled worker via cloudflare:test SELF. This
// keeps the external-product contract traced server-side after the e2e spec is
// deleted, without depending on the Playwright harness.

type Json = Record<string, unknown>
type SdkList = { data: Json[]; pagination: { limit: number; hasMore: boolean; nextCursor: string | null } }

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

// The integration auth helper hands back a full `Bearer e2e:<runId>` header; the
// SDK prepends its own `Bearer `, so it wants the bare token.
async function newSdk() {
  const authorization = await signIn()
  const accessToken = authorization.replace(/^Bearer\s+/i, '')
  const runId = accessToken.replace(/^e2e:/, '')
  return { ama: new AmaClient({ origin: 'https://example.com', accessToken }), runId }
}

async function createAgentThroughSdk(ama: AmaClient, runId: string, refs: ReturnType<typeof externalRefs>) {
  return await ama.request<Json>('createAgent', {
    body: {
      name: `${runId} external agent`,
      instructions: 'Work items arrive from an external product over the AMA SDK.',
      providerId: 'workers-ai',
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
  // Cloud sessions reach `idle` synchronously in the integration pool, so we just
  // read the session back rather than polling a runtime drive-to-idle loop.
  const session = await readSession(ama, String(created.id))
  return { created, session }
}

describe('[CF] generated SDK contract', () => {
  beforeEach(async () => {
    await seedPlatformProvider()
    // Route the SDK's global fetch to the assembled worker via SELF.
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) =>
      SELF.fetch(typeof input === 'string' ? input : ((input as { url?: string })?.url ?? String(input)), init),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('external product manages standard AMA resources through the SDK [spec: projects/external-resources]', async () => {
    const { ama, runId } = await newSdk()
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
    expect(agent.description).toBe('Updated by the external product through the SDK.')

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

  it('external product starts work by creating an AMA session [spec: projects/external-session]', async () => {
    const { ama, runId } = await newSdk()
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

    // Stable id/status/runtime + the canonical event endpoint advertised on the connection resource.
    expect(typeof created.id === 'string' && (created.id as string).length > 0).toBe(true)
    const fetched = await readSession(ama, String(created.id))
    expect(fetched.id).toBe(created.id)
    expect('stateReason' in fetched).toBe(true)
    const connection = await ama.request<Json>('readSessionConnection', { path: { sessionId: String(created.id) } })
    expect(connection.path).toBe(`/api/v1/runtime/sessions/${created.id}/rpc`)
    const eventsOperation = operations.find((op) => op.operationId === 'listSessionEvents')
    expect(eventsOperation?.path).toBe('/api/v1/sessions/{sessionId}/events')

    // Canonical progress events exist in renderable sequence order; the initial prompt drove a turn.
    const events = await listEvents(ama, sessionId)
    expect(events.data.length).toBeGreaterThan(0)
    expect(JSON.stringify(events.data)).toContain(`work item for ${runId}`)
    for (const event of events.data) {
      expect(isAmaSessionEventType(String(event.type)), `non-canonical event type "${event.type}"`).toBe(true)
    }
    const sequences = events.data.map((e) => Number(e.sequence))
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
  })

  it('external product controls a running session only through AMA endpoints [spec: projects/external-control]', async () => {
    const { ama, runId } = await newSdk()
    const refs = externalRefs(runId)
    const agent = await createAgentThroughSdk(ama, runId, refs)
    const environment = await createEnvironmentThroughSdk(ama, runId, refs)
    const { session } = await createSessionThroughSdk(ama, runId, refs, agent, environment, {})
    const sessionId = String(obj(session).id)

    const command = await ama.request<Json>('createSessionMessage', {
      path: { sessionId },
      body: { type: 'prompt', content: `external product follow-up ${runId}` },
    })
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
})
