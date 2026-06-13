import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupOidcProvider, signIn } from '../test/auth'

interface OpenApiOperation {
  operationId?: string
  tags?: string[]
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

async function openApiOperationIds() {
  const res = await SELF.fetch('https://example.com/api/v1/openapi.json')
  expect(res.status).toBe(200)
  const doc = (await res.json()) as OpenApiDocument

  return new Set(
    Object.values(doc.paths).flatMap((pathItem) =>
      Object.entries(pathItem)
        .filter(([method]) => METHODS.has(method))
        .map(([, operation]) => operation.operationId),
    ),
  )
}

describe('[CF] restish/OpenAPI control-plane path [spec: api-contracts/restish]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers the documented resource groups from /api/v1/openapi.json', async () => {
    const operationIds = await openApiOperationIds()

    expect(Array.from(operationIds)).toEqual(
      expect.arrayContaining([
        'getHealth',
        'listAgents',
        'listEnvironments',
        'listSessions',
        'listProviders',
        'listVaults',
        'listPolicies',
        'readEffectivePolicy',
        'listUsageRecords',
        'readUsageSummary',
        'listAuditRecords',
        'listWorkItems',
        'listConnectors',
      ]),
    )
  })

  it('exercises the core restish resource workflow over documented /api/v1 paths', async () => {
    const authorization = await signIn()

    const environmentRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Restish e2e environment',
        packages: [{ name: 'tsx', version: 'latest' }],
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string; currentVersionId: string }

    const agentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Restish e2e agent',
        instructions: 'Run e2e checks through documented control-plane operations.',
      }),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { id: string; currentVersionId: string }

    const sessionRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as {
      id: string
      agentId: string
      agentVersionId: string
      environmentId: string
      environmentVersionId: string
      state: string
    }

    expect(session).toMatchObject({
      agentId: agent.id,
      agentVersionId: agent.currentVersionId,
      environmentId: environment.id,
      environmentVersionId: environment.currentVersionId,
      state: 'idle',
    })

    const connectionRes = await jsonFetch(`/api/v1/sessions/${session.id}/connection`, authorization)
    expect(connectionRes.status).toBe(200)
    expect(await connectionRes.json()).toMatchObject({
      sessionId: session.id,
      path: `/api/v1/runtime/sessions/${session.id}/rpc`,
      state: 'idle',
    })
  })
})
