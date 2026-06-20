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

type AmaResult<TData> =
  | { data: TData; error: undefined; request?: Request; response?: Response }
  | { data: undefined; error: unknown; request?: Request; response?: Response }

async function unwrap<TData>(call: Promise<AmaResult<TData>>): Promise<TData> {
  const { data, error, response } = await call
  if (response?.ok && error === undefined) {
    return data as TData
  }
  const body = error ?? data
  throw new AmaApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body)
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
