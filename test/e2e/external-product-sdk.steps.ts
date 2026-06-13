import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { AmaClient, operations } from '../../sdk/typescript/src/index'
import { isAmaSessionEventType } from '../../shared/session-events'
import { delay, ensureLocalApp } from './local-app'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

interface SdkListResponse {
  data: Json[]
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
}

// The external product owns these identifiers; AMA must never learn them
// outside of opaque resource metadata.
interface ExternalProductRefs {
  product: string
  boardId: string
  taskId: string
}

interface ExternalProductState {
  client: AmaClient
  runId: string
  externalRefs: ExternalProductRefs
  // Product-side storage: product record key -> AMA resource id.
  productRecords: Map<string, string>
  agent?: Json
  environment?: Json
  resourceRefs?: Json[]
  session?: Json
  sessionAtCreation?: Json
  commandResponse?: Json
}

type ExternalProductWorld = AmaWorld & { externalProduct?: ExternalProductState }

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

async function ensureExternalProduct(world: ExternalProductWorld): Promise<ExternalProductState> {
  if (world.externalProduct) return world.externalProduct
  const origin = await ensureLocalApp()
  const runId = `extprod-${Date.now()}-${Math.random().toString(16).slice(2)}`
  // The only raw HTTP call in this file: minting the local e2e bearer token.
  // Every product interaction afterwards goes through the generated SDK client.
  const tokenResponse = await fetch(`${origin}/api/v1/e2e/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId }),
  })
  assert.equal(tokenResponse.status, 201, `POST /api/v1/e2e/auth/token returned ${tokenResponse.status}`)
  const token = (await tokenResponse.json()) as { accessToken: string; projectId: string }
  const state: ExternalProductState = {
    client: new AmaClient({ origin, accessToken: token.accessToken, projectId: token.projectId }),
    runId,
    externalRefs: {
      product: 'agent-kanban',
      boardId: `board_${runId}`,
      taskId: `task_${runId}`,
    },
    productRecords: new Map(),
  }
  world.externalProduct = state
  return state
}

function state(world: ExternalProductWorld): ExternalProductState {
  assert.ok(world.externalProduct, 'external product state must be initialized by a Given step')
  return world.externalProduct
}

function objectValue(value: unknown): Json {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'expected a JSON object')
  return value as Json
}

function externalMetadata(refs: ExternalProductRefs): Json {
  return {
    externalProduct: refs.product,
    externalBoardId: refs.boardId,
    externalTaskId: refs.taskId,
  }
}

async function createAgentThroughSdk(product: ExternalProductState) {
  return await product.client.request<Json>('createAgent', {
    body: {
      name: `${product.runId} external agent`,
      instructions: 'Work items arrive from an external product over the AMA SDK.',
      // Omit providerId to resolve the project's default provider (platform Workers AI).
      model: '@cf/moonshotai/kimi-k2.6',
      metadata: externalMetadata(product.externalRefs),
    },
  })
}

async function createEnvironmentThroughSdk(product: ExternalProductState) {
  return await product.client.request<Json>('createEnvironment', {
    body: {
      name: `${product.runId} external env`,
      runtimeConfig: { image: 'ama-pi-runtime' },
      metadata: externalMetadata(product.externalRefs),
    },
  })
}

async function readSessionThroughSdk(product: ExternalProductState, sessionId: string) {
  return await product.client.request<Json>('readSession', { path: { sessionId } })
}

async function listSessionEventsThroughSdk(product: ExternalProductState, sessionId: string) {
  return await product.client.request<SdkListResponse>('listSessionEvents', {
    path: { sessionId },
    query: { limit: 200 },
  })
}

async function waitForIdleSession(product: ExternalProductState, sessionId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await readSessionThroughSdk(product, sessionId)
    if (session.state === 'idle') return session
    if (session.state === 'error') {
      throw new Error(`Session startup failed: ${session.stateReason ?? 'unknown error'}`)
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not become idle before timeout`)
}

async function waitForSessionEventText(product: ExternalProductState, sessionId: string, text: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const events = await listSessionEventsThroughSdk(product, sessionId)
    if (JSON.stringify(events.data).includes(text)) return events
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} events never contained "${text}"`)
}

async function createSessionThroughSdk(product: ExternalProductState, body: Json) {
  const created = await product.client.request<Json>('createSession', {
    body: {
      agentId: objectValue(product.agent).id,
      environmentId: objectValue(product.environment).id,
      runtime: 'ama',
      title: `${product.runId} external session`,
      metadata: externalMetadata(product.externalRefs),
      ...body,
    },
  })
  product.sessionAtCreation = created
  product.session = await waitForIdleSession(product, String(created.id))
  return product.session
}

// ─── Scenario: External product manages standard AMA resources through the SDK ───
// [spec: projects/external-resources]

Given(
  'an external product owns its workflow identifiers and product state',
  async function (this: ExternalProductWorld) {
    const product = await ensureExternalProduct(this)
    assert.ok(product.externalRefs.boardId.startsWith('board_'), 'the product owns its board identifier')
    assert.ok(product.externalRefs.taskId.startsWith('task_'), 'the product owns its task identifier')
    assert.equal(product.productRecords.size, 0, 'the product starts with its own empty mapping storage')
  },
)

When(
  'the product creates or updates AMA agent definitions, environments, and resources through the OpenAPI SDK',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const agent = await createAgentThroughSdk(product)
    product.agent = await product.client.request<Json>('updateAgent', {
      path: { agentId: String(agent.id) },
      body: { description: 'Updated by the external product through the SDK.' },
    })
    product.environment = await createEnvironmentThroughSdk(product)
    product.productRecords.set(product.externalRefs.taskId, String(product.agent.id))
    product.productRecords.set(product.externalRefs.boardId, String(product.environment.id))
  },
)

Then('AMA stores only standard AMA resource fields', async function (this: ExternalProductWorld) {
  const product = state(this)
  const agent = await product.client.request<Json>('readAgent', {
    path: { agentId: String(objectValue(product.agent).id) },
  })
  for (const key of Object.keys(agent)) {
    assert.ok(STANDARD_AGENT_FIELDS.has(key), `agent field "${key}" is not a standard AMA agent field`)
  }
  const environment = await product.client.request<Json>('readEnvironment', {
    path: { environmentId: String(objectValue(product.environment).id) },
  })
  for (const key of Object.keys(environment)) {
    assert.ok(
      STANDARD_ENVIRONMENT_FIELDS.has(key),
      `environment field "${key}" is not a standard AMA environment field`,
    )
  }
  // The external mapping survives only inside the opaque metadata field.
  assert.equal(objectValue(agent.metadata).externalTaskId, product.externalRefs.taskId)
  assert.equal(objectValue(environment.metadata).externalBoardId, product.externalRefs.boardId)
  product.agent = agent
  product.environment = environment
})

Then(
  'AMA does not store product-specific external references as first-class fields',
  function (this: ExternalProductWorld) {
    const product = state(this)
    for (const resource of [objectValue(product.agent), objectValue(product.environment)]) {
      for (const key of Object.keys(resource)) {
        assert.ok(!/external|board|task|review|pull/i.test(key), `"${key}" looks like a product-workflow field`)
      }
      const { metadata: _metadata, ...standardFields } = resource
      const serialized = JSON.stringify(standardFields)
      assert.ok(!serialized.includes(product.externalRefs.taskId), 'external task id leaked outside metadata')
      assert.ok(!serialized.includes(product.externalRefs.boardId), 'external board id leaked outside metadata')
    }
  },
)

Then(
  'the product keeps any mapping between product records and AMA ids in its own storage',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const agentId = product.productRecords.get(product.externalRefs.taskId)
    const environmentId = product.productRecords.get(product.externalRefs.boardId)
    assert.ok(agentId, 'the product stored the AMA agent id for its task')
    assert.ok(environmentId, 'the product stored the AMA environment id for its board')
    // The product-side mapping is sufficient to resolve the AMA resources again.
    const agent = await product.client.request<Json>('readAgent', { path: { agentId } })
    assert.equal(agent.id, agentId)
    const environment = await product.client.request<Json>('readEnvironment', { path: { environmentId } })
    assert.equal(environment.id, environmentId)
  },
)

Then(
  'AMA does not require the product to expose board, task, review, or PR concepts',
  function (this: ExternalProductWorld) {
    // Match whole words (split on camelCase and non-letter boundaries) so
    // e.g. previewGovernanceConfig does not trip the "review" guard.
    const workflowWords = new Set(['board', 'boards', 'task', 'tasks', 'review', 'reviews'])
    // The async-task REST pattern (POST /…-tasks → 201 + GET status, design §1.2.7)
    // is a standard platform resource, not a product-workflow concept; the word
    // "task" there names a job resource (e.g. model-discovery-tasks).
    const asyncTaskResource = /[a-z]+-tasks(\/|\b)/i
    const workflowOperations = operations.filter((operation) => {
      const surface = `${operation.path} ${operation.operationId}`
      if (asyncTaskResource.test(operation.path)) return false
      const words = surface
        .split(/[^A-Za-z]+/)
        .flatMap((segment) => segment.split(/(?=[A-Z])/))
        .map((word) => word.toLowerCase())
      return words.some((word) => workflowWords.has(word)) || /pull[-_]?request/i.test(surface)
    })
    assert.deepEqual(
      workflowOperations.map((operation) => operation.operationId),
      [],
      'the SDK operation inventory must not expose product-workflow concepts',
    )
  },
)

// ─── Scenario: External product starts work by creating an AMA session ───────
// [spec: projects/external-session]

Given('an external product has selected a standard AMA agent definition', async function (this: ExternalProductWorld) {
  const product = await ensureExternalProduct(this)
  product.agent = await createAgentThroughSdk(product)
  product.productRecords.set(product.externalRefs.taskId, String(product.agent.id))
})

Given('the external product has selected a standard AMA environment', async function (this: ExternalProductWorld) {
  const product = state(this)
  product.environment = await createEnvironmentThroughSdk(product)
  product.productRecords.set(product.externalRefs.boardId, String(product.environment.id))
})

Given('the external product has selected standard AMA resource references', function (this: ExternalProductWorld) {
  const product = state(this)
  product.resourceRefs = [{ type: 'github_repository', owner: 'saltbo', repo: 'any-managed-agents', ref: 'main' }]
})

When(
  'the external product creates an AMA session through the OpenAPI SDK',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    await createSessionThroughSdk(product, {
      resourceRefs: product.resourceRefs,
      initialPrompt: `Start the external product work item for ${product.runId}.`,
    })
  },
)

Then('AMA snapshots the selected agent and environment', async function (this: ExternalProductWorld) {
  const product = state(this)
  const sessionId = String(objectValue(product.session).id)
  const before = await readSessionThroughSdk(product, sessionId)
  const agentSnapshot = objectValue(before.agentSnapshot)
  assert.equal(agentSnapshot.agentId, objectValue(product.agent).id, 'snapshot pins the selected agent')
  assert.ok(typeof agentSnapshot.version === 'number', 'snapshot pins a concrete agent version')
  const environmentSnapshot = objectValue(before.environmentSnapshot)
  assert.equal(
    environmentSnapshot.environmentId,
    objectValue(product.environment).id,
    'snapshot pins the selected environment',
  )
  // Mutating the agent through the SDK after creation must not move the snapshot.
  await product.client.request<Json>('updateAgent', {
    path: { agentId: String(objectValue(product.agent).id) },
    body: { instructions: 'Changed after session creation — the session snapshot must not follow.' },
  })
  const after = await readSessionThroughSdk(product, sessionId)
  assert.deepEqual(after.agentSnapshot, before.agentSnapshot, 'agent snapshot is immutable after creation')
  assert.deepEqual(
    after.environmentSnapshot,
    before.environmentSnapshot,
    'environment snapshot is immutable after creation',
  )
})

Then(
  'AMA validates the session runtime, provider, and model before runtime work starts',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const session = await readSessionThroughSdk(product, String(objectValue(product.session).id))
    const runtimeMetadata = objectValue(session.runtimeMetadata)
    assert.equal(runtimeMetadata.runtime, 'ama', 'the validated runtime is recorded')
    assert.equal(runtimeMetadata.hostingMode, 'cloud', 'the validated hosting mode is recorded')
    assert.ok(runtimeMetadata.provider, 'the validated provider is recorded')
    assert.ok(runtimeMetadata.model, 'the validated model is recorded')
    assert.notEqual(session.state, 'error', 'validation succeeded before runtime work started')
  },
)

Then(
  'AMA returns a stable session id, status, status reason, runtime, and event endpoint',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const created = objectValue(product.sessionAtCreation)
    assert.ok(typeof created.id === 'string' && created.id.length > 0, 'session creation returned an id')
    const fetched = await readSessionThroughSdk(product, String(created.id))
    assert.equal(fetched.id, created.id, 'the session id is stable across reads')
    assert.ok(typeof fetched.state === 'string' && fetched.state.length > 0, 'a state is returned')
    assert.ok('stateReason' in fetched, 'a state reason field is returned')
    assert.equal(objectValue(fetched.runtimeMetadata).runtime, 'ama', 'the runtime is returned')
    // The runtime endpoint is advertised on the session connection resource now,
    // not as a session field.
    const connection = await product.client.request<Json>('readSessionConnection', {
      path: { sessionId: String(created.id) },
    })
    assert.equal(
      connection.path,
      `/api/v1/runtime/sessions/${created.id}/rpc`,
      'the session connection advertises the AMA runtime endpoint',
    )
    // The canonical event endpoint is part of the SDK contract and serves this session.
    const eventsOperation = operations.find((operation) => operation.operationId === 'listSessionEvents')
    assert.ok(eventsOperation, 'the SDK exposes the canonical session event endpoint')
    assert.equal(eventsOperation.path, '/api/v1/sessions/{sessionId}/events')
    const events = await listSessionEventsThroughSdk(product, String(created.id))
    assert.ok(Array.isArray(events.data), 'the event endpoint serves events for the returned session id')
  },
)

Then(
  'the external product can store the returned AMA ids in its own product records',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const sessionId = String(objectValue(product.session).id)
    product.productRecords.set(`${product.externalRefs.taskId}:session`, sessionId)
    const storedSessionId = product.productRecords.get(`${product.externalRefs.taskId}:session`)
    assert.ok(storedSessionId, 'the product stored the AMA session id against its own task record')
    const resolved = await readSessionThroughSdk(product, storedSessionId)
    assert.equal(resolved.id, sessionId)
    assert.equal(resolved.agentId, product.productRecords.get(product.externalRefs.taskId))
  },
)

Then(
  'the external product can render progress from AMA session status and canonical events',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const sessionId = String(objectValue(product.session).id)
    const session = await readSessionThroughSdk(product, sessionId)
    assert.ok(typeof session.state === 'string' && session.state.length > 0, 'state is renderable')
    // The initial prompt ran through the runtime, so canonical progress events exist.
    const events = await waitForSessionEventText(product, sessionId, `work item for ${product.runId}`)
    assert.ok(events.data.length > 0, 'canonical events exist for progress rendering')
    for (const event of events.data) {
      assert.ok(
        isAmaSessionEventType(String(event.type)),
        `event type "${event.type}" must be a canonical AMA session event type`,
      )
    }
    const sequences = events.data.map((event) => Number(event.sequence))
    assert.deepEqual(
      sequences,
      [...sequences].sort((a, b) => a - b),
      'events arrive in renderable sequence order',
    )
  },
)

// ─── Scenario: External product controls a running session only through AMA endpoints ───
// [spec: projects/external-control]

Given('an external product created an AMA session', async function (this: ExternalProductWorld) {
  const product = await ensureExternalProduct(this)
  product.agent = await createAgentThroughSdk(product)
  product.environment = await createEnvironmentThroughSdk(product)
  await createSessionThroughSdk(product, {})
})

When(
  'the external product sends a follow-up message, stop request, or resume request',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    const sessionId = String(objectValue(product.session).id)
    product.commandResponse = await product.client.request<Json>('createSessionMessage', {
      path: { sessionId },
      body: { type: 'prompt', content: `external product follow-up ${product.runId}` },
    })
    // The follow-up is observable end-to-end before the stop request is sent.
    await waitForSessionEventText(product, sessionId, `external product follow-up ${product.runId}`)
    product.session = await product.client.request<Json>('updateSession', {
      path: { sessionId },
      body: { state: 'stopped' },
    })
  },
)

Then(
  'AMA routes the command to the selected runtime or owning self-hosted runner',
  function (this: ExternalProductWorld) {
    const product = state(this)
    // The follow-up is now an addressable SessionMessage resource: AMA accepts it
    // and routes delivery to the selected runtime through its own channel.
    const message = objectValue(product.commandResponse)
    assert.ok(typeof message.id === 'string' && message.id.length > 0, 'AMA returns an addressable message id')
    assert.equal(message.sessionId, objectValue(product.session).id, 'the message is bound to the session')
    assert.equal(message.type, 'prompt', 'the follow-up is recorded as a prompt message')
    assert.ok(['live', 'queued'].includes(String(message.delivery)), 'AMA records an internal delivery channel')
    assert.ok(
      ['accepted', 'delivered'].includes(String(message.state)),
      'AMA accepts the follow-up command for delivery',
    )
    // Nothing in the routing record exposes a foreign or absolute endpoint.
    assert.ok(!JSON.stringify(message).includes('://'), 'routing stays on AMA-relative channels')
  },
)

Then('AMA records the command result as canonical session events', async function (this: ExternalProductWorld) {
  const product = state(this)
  const sessionId = String(objectValue(product.session).id)
  const events = await listSessionEventsThroughSdk(product, sessionId)
  const serialized = JSON.stringify(events.data)
  assert.ok(serialized.includes(`external product follow-up ${product.runId}`), 'the follow-up turn is persisted')
  for (const event of events.data) {
    assert.ok(
      isAmaSessionEventType(String(event.type)),
      `event type "${event.type}" must be a canonical AMA session event type`,
    )
  }
  assert.ok(
    events.data.some((event) => event.type === 'session_stop'),
    'the stop request is recorded as a canonical session_stop event',
  )
  const session = await readSessionThroughSdk(product, sessionId)
  assert.equal(session.state, 'stopped', 'the stop command reached the runtime')
})

Then(
  'the external product never connects to a sandbox-local, runner-local, or official-runtime-local endpoint',
  async function (this: ExternalProductWorld) {
    const product = state(this)
    // The SDK operation inventory only describes AMA control-plane endpoints.
    for (const operation of operations) {
      assert.ok(operation.path.startsWith('/api/v1/'), `SDK operation ${operation.operationId} must target /api/`)
      assert.ok(!operation.path.startsWith('/runtime/'), 'SDK must not expose /runtime/ protocol paths')
    }
    // And nothing AMA returned to the product leaks a sandbox-local or
    // runner-local endpoint it could connect to directly.
    const sessionId = String(objectValue(product.session).id)
    const session = await readSessionThroughSdk(product, sessionId)
    const events = await listSessionEventsThroughSdk(product, sessionId)
    for (const surface of [JSON.stringify(session), JSON.stringify(events.data)]) {
      assert.ok(!/wss?:\/\//.test(surface), 'no absolute socket endpoints leak to the product')
      assert.ok(!surface.includes('preview-url'), 'no sandbox preview URLs leak to the product')
      assert.ok(!/:\d{4,5}\/(exec|process|shell)/.test(surface), 'no raw process endpoints leak to the product')
    }
  },
)
