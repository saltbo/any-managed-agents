// Stable, hand-maintained facade over the generated client.
//
// External consumers code against `createAmaClient(...).<resource>.<verb>(...)`.
// Each method is a thin delegation to a function in ./generated (produced by
// @hey-api/openapi-ts). The generated layer may be re-shaped — or the generator
// swapped entirely — without changing this public surface: only the one-line
// bodies here move. This is the contract consumers depend on, not sdk.gen.ts.
//
// Adding an operation is a one-liner; see the patterns below.

import { createClient, createConfig } from './generated/client/index.js'
import * as ops from './generated/sdk.gen.js'
import type * as types from './generated/types.gen.js'

export interface AmaClientConfig {
  /** AMA control-plane origin, e.g. https://ama.example.com */
  baseUrl: string
  /** OIDC access token; sent as `Authorization: Bearer <token>`. */
  accessToken?: string
  /** Sent as `x-ama-project-id` to scope project-bound operations. */
  projectId?: string
  /** Extra headers merged last. */
  headers?: Record<string, string>
}

/** Thrown on any non-2xx response. `status` lets callers branch on 404/409/etc. */
export class AmaApiError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly responseText: string,
    readonly body: unknown,
  ) {
    super(`AMA API request failed${status === undefined ? '' : ` with HTTP ${status}`}`)
    this.name = 'AmaApiError'
  }
}

// The generated functions resolve to { data, error, response } where `data` is
// `T | undefined` across the success/error union. Typing the param as
// `T | undefined` makes inference recover the bare success type `T`.
async function unwrap<TData>(call: Promise<{ data: TData | undefined; error?: unknown; response?: Response }>): Promise<TData> {
  const { data, error, response } = await call
  if (response?.ok && error === undefined) {
    return data as TData
  }
  const body = error ?? data
  throw new AmaApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body)
}

/**
 * A live session WebSocket. `events` is the async-iterable of pushed
 * {@link types.SessionEvent}s; `backfill` requests a replay; `send` posts a typed
 * client frame; `close` tears the socket down. The frame payloads are all typed
 * against the generated schemas — OpenAPI can't describe the socket protocol, so
 * the transport is the one piece hand-wrapped here (mirrors the Go SDK).
 */
export interface SessionStream {
  events: AsyncIterable<types.SessionEvent>
  send(frame: types.SessionClientFrame): Promise<void>
  backfill(options?: { cursor?: number; limit?: number; eventType?: string; visibility?: string }): Promise<types.SessionBackfillResponse>
  close(): void
}

type SessionStreamFrame =
  | { type: 'event'; event: types.SessionEvent }
  | (types.SessionBackfillResponse & { type: 'backfill' })
  | { type: 'runner_unavailable'; message: string }

function createSessionStream(config: AmaClientConfig, sessionId: string): SessionStream {
  const url = new URL(`/api/v1/sessions/${sessionId}/socket`, config.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  // Browsers can't set an Authorization header on a WebSocket; AMA's auth wall
  // also accepts the token as an access_token query param, so use that.
  if (config.accessToken) {
    url.searchParams.set('access_token', config.accessToken)
  }
  const socket = new WebSocket(url.toString())

  const buffered: types.SessionEvent[] = []
  const waiters: Array<(result: IteratorResult<types.SessionEvent>) => void> = []
  const backfillWaiters = new Map<string, (response: types.SessionBackfillResponse) => void>()
  let done = false

  const drainDone = () => {
    done = true
    for (const resolve of waiters.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  socket.addEventListener('message', (event: MessageEvent) => {
    const frame = JSON.parse(typeof event.data === 'string' ? event.data : '') as SessionStreamFrame
    if (frame.type === 'event') {
      const waiter = waiters.shift()
      if (waiter) {
        waiter({ value: frame.event, done: false })
      } else {
        buffered.push(frame.event)
      }
    } else if (frame.type === 'backfill') {
      const resolve = frame.requestId ? backfillWaiters.get(frame.requestId) : undefined
      if (frame.requestId) {
        backfillWaiters.delete(frame.requestId)
      }
      resolve?.(frame)
    }
  })
  socket.addEventListener('close', drainDone)

  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Session socket failed to open')))
  })

  let backfillSeq = 0
  return {
    events: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<types.SessionEvent>> {
            const value = buffered.shift()
            if (value !== undefined) {
              return Promise.resolve({ value, done: false })
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise((resolve) => waiters.push(resolve))
          },
        }
      },
    },
    async send(frame) {
      await ready
      socket.send(JSON.stringify(frame))
    },
    async backfill(options = {}) {
      await ready
      const requestId = `bf_${(backfillSeq += 1)}`
      const response = new Promise<types.SessionBackfillResponse>((resolve) => backfillWaiters.set(requestId, resolve))
      socket.send(JSON.stringify({ type: 'backfill', requestId, ...options }))
      return response
    },
    close() {
      socket.close()
    },
  }
}

export type AmaClient = ReturnType<typeof createAmaClient>

export function createAmaClient(config: AmaClientConfig) {
  const client = createClient(
    createConfig({
      baseUrl: config.baseUrl,
      headers: {
        ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
        ...(config.projectId ? { 'x-ama-project-id': config.projectId } : {}),
        ...config.headers,
      },
    }),
  )

  return {
    /** Escape hatch: the raw generated client for operations not yet on the facade. */
    raw: client,

    agents: {
      create: (body: types.CreateAgentRequest) => unwrap(ops.createAgent({ client, body })),
      get: (agentId: string) => unwrap(ops.readAgent({ client, path: { agentId } })),
      update: (agentId: string, body: types.UpdateAgentRequest) => unwrap(ops.updateAgent({ client, path: { agentId }, body })),
      list: (query?: types.ListAgentsData['query']) => unwrap(ops.listAgents({ client, query })),
    },

    environments: {
      create: (body: types.CreateEnvironmentRequest) => unwrap(ops.createEnvironment({ client, body })),
      get: (environmentId: string) => unwrap(ops.readEnvironment({ client, path: { environmentId } })),
      update: (environmentId: string, body: types.UpdateEnvironmentRequest) => unwrap(ops.updateEnvironment({ client, path: { environmentId }, body })),
      list: (query?: types.ListEnvironmentsData['query']) => unwrap(ops.listEnvironments({ client, query })),
    },

    projects: {
      create: (body: types.CreateProjectRequest) => unwrap(ops.createProject({ client, body })),
      get: (projectId: string) => unwrap(ops.readProject({ client, path: { projectId } })),
    },

    sessions: {
      create: (body: types.CreateSessionRequest) => unwrap(ops.createSession({ client, body })),
      get: (sessionId: string) => unwrap(ops.readSession({ client, path: { sessionId } })),
      update: (sessionId: string, body: types.UpdateSessionRequest) => unwrap(ops.updateSession({ client, path: { sessionId }, body })),
      list: (query?: types.ListSessionsData['query']) => unwrap(ops.listSessions({ client, query })),
      connection: (sessionId: string) => unwrap(ops.readSessionConnection({ client, path: { sessionId } })),
      /** Open the live session WebSocket: pushed events + backfill replay + typed input frames. */
      stream: (sessionId: string): SessionStream => createSessionStream(config, sessionId),
      listEvents: (sessionId: string, query?: types.ListSessionEventsData['query']) => unwrap(ops.listSessionEvents({ client, path: { sessionId }, query })),
      createMessage: (sessionId: string, body: types.CreateSessionMessageRequest) => unwrap(ops.createSessionMessage({ client, path: { sessionId }, body })),
    },

    vaults: {
      create: (body: types.CreateVaultRequest) => unwrap(ops.createVault({ client, body })),
      createCredential: (vaultId: string, body: types.CreateVaultCredentialRequest) => unwrap(ops.createVaultCredential({ client, path: { vaultId }, body })),
      updateCredential: (vaultId: string, credentialId: string, body: types.UpdateVaultCredentialRequest) =>
        unwrap(ops.updateVaultCredential({ client, path: { vaultId, credentialId }, body })),
    },

    triggers: {
      create: (body: types.CreateTriggerRequest) => unwrap(ops.createTrigger({ client, body })),
      get: (triggerId: string) => unwrap(ops.readTrigger({ client, path: { triggerId } })),
      update: (triggerId: string, body: types.UpdateTriggerRequest) => unwrap(ops.updateTrigger({ client, path: { triggerId }, body })),
      delete: (triggerId: string) => unwrap(ops.deleteTrigger({ client, path: { triggerId } })),
      listRuns: (triggerId: string, query?: types.ListTriggerRunsData['query']) => unwrap(ops.listTriggerRuns({ client, path: { triggerId }, query })),
      createRun: (triggerId: string, body: types.CreateHttpTriggerRunRequest, options?: { headers?: Record<string, string> }) =>
        unwrap(ops.createTriggerRun({ client, path: { triggerId }, body, headers: options?.headers })),
    },

    memoryStores: {
      list: (query?: types.ListMemoryStoresData['query']) => unwrap(ops.listMemoryStores({ client, query })),
      create: (body: types.CreateMemoryStoreRequest) => unwrap(ops.createMemoryStore({ client, body })),
      get: (storeId: string) => unwrap(ops.readMemoryStore({ client, path: { storeId } })),
      update: (storeId: string, body: types.UpdateMemoryStoreRequest) => unwrap(ops.updateMemoryStore({ client, path: { storeId }, body })),
      listMemories: (storeId: string, query?: types.ListMemoryStoreMemoriesData['query']) =>
        unwrap(ops.listMemoryStoreMemories({ client, path: { storeId }, query })),
      createMemory: (storeId: string, body: types.CreateMemoryStoreMemoryRequest) =>
        unwrap(ops.createMemoryStoreMemory({ client, path: { storeId }, body })),
      updateMemory: (storeId: string, memoryId: string, body: types.UpdateMemoryStoreMemoryRequest) =>
        unwrap(ops.updateMemoryStoreMemory({ client, path: { storeId, memoryId }, body })),
      deleteMemory: (storeId: string, memoryId: string) => unwrap(ops.deleteMemoryStoreMemory({ client, path: { storeId, memoryId } })),
    },

    runners: {
      list: (query?: types.ListRunnersData['query']) => unwrap(ops.listRunners({ client, query })),
    },

    usage: {
      listRecords: (query?: types.ListUsageRecordsData['query']) => unwrap(ops.listUsageRecords({ client, query })),
      summary: (query?: types.ReadUsageSummaryData['query']) => unwrap(ops.readUsageSummary({ client, query })),
    },

    models: {
      list: (query?: types.ListModelsData['query']) => unwrap(ops.listModels({ client, query })),
    },

    federatedTenants: {
      create: (body: types.CreateFederatedTenantRequest) => unwrap(ops.createFederatedTenant({ client, body })),
    },
  }
}
