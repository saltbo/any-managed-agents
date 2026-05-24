import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

interface OpenApiOperation {
  operationId?: string
  summary?: string
  tags?: string[]
  security?: unknown
  parameters?: Array<{ name?: string }>
  requestBody?: { content?: Record<string, unknown> }
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
}

interface OpenApiDocument {
  openapi: string
  servers?: Array<{ url?: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, unknown>
  }
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/callback'])
const EXPECTED_RESTISH_OPERATIONS = {
  System: ['getHealth'],
  Agents: ['listAgents', 'createAgent'],
  Environments: ['listEnvironments', 'createEnvironment'],
  Sessions: ['listSessions', 'createSession'],
  Providers: ['listProviders', 'createProvider'],
  Vaults: ['listVaults', 'createVault'],
  Governance: ['readEffectiveGovernancePolicy', 'readGovernancePolicy'],
  Usage: ['listUsageRecords', 'readUsageSummary'],
  Audit: ['listAuditRecords', 'exportAuditRecords'],
}

async function fetchOpenApi() {
  const res = await SELF.fetch('https://example.com/api/openapi.json')

  expect(res.status).toBe(200)
  return (await res.json()) as OpenApiDocument
}

function operations(doc: OpenApiDocument) {
  return Object.entries(doc.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => METHODS.has(method))
      .map(([method, operation]) => ({ path, method, operation })),
  )
}

function expectJsonErrorResponse(operation: OpenApiOperation, status: string) {
  expect(
    operation.responses?.[status]?.content?.['application/json']?.schema,
    `${operation.operationId} ${status} response must use the standard JSON error envelope`,
  ).toEqual({ $ref: '#/components/schemas/ErrorResponse' })
}

describe('[CF] OpenAPI documentation', () => {
  it('publishes the generated control-plane OpenAPI document', async () => {
    const doc = await fetchOpenApi()

    expect(doc.openapi).toBe('3.0.0')
    expect(doc.servers).toEqual([{ url: '/' }])
    expect(doc.paths).toHaveProperty('/api/health')
    expect(doc.paths).toHaveProperty('/api/auth/login')
    expect(doc.paths).toHaveProperty('/api/auth/callback')
    expect(doc.paths).toHaveProperty('/api/auth/logout')
    expect(doc.paths).toHaveProperty('/api/auth/me')
    expect(doc.paths).toHaveProperty('/api/agents')
    expect(doc.paths).toHaveProperty('/api/agents/{agentId}')
    expect(doc.paths).toHaveProperty('/api/agents/{agentId}/versions')
    expect(doc.paths).toHaveProperty('/api/agents/{agentId}/sessions')
    expect(doc.paths).toHaveProperty('/api/environments')
    expect(doc.paths).toHaveProperty('/api/environments/{environmentId}')
    expect(doc.paths).toHaveProperty('/api/environments/{environmentId}/versions')
    expect(doc.paths).toHaveProperty('/api/providers')
    expect(doc.paths).toHaveProperty('/api/providers/{providerId}')
    expect(doc.paths).toHaveProperty('/api/providers/{providerId}/models')
    expect(doc.paths).toHaveProperty('/api/governance/policy')
    expect(doc.paths).toHaveProperty('/api/governance/effective-policy')
    expect(doc.paths).toHaveProperty('/api/governance/evaluations')
    expect(doc.paths).toHaveProperty('/api/governance/provider-access-rules')
    expect(doc.paths).toHaveProperty('/api/governance/budgets')
    expect(doc.paths).toHaveProperty('/api/mcp/connectors')
    expect(doc.paths).toHaveProperty('/api/mcp/connectors/{connectorId}')
    expect(doc.paths).toHaveProperty('/api/mcp/connections')
    expect(doc.paths).toHaveProperty('/api/mcp/connections/{connectionId}')
    expect(doc.paths).toHaveProperty('/api/mcp/connections/{connectionId}/tools')
    expect(doc.paths).toHaveProperty('/api/mcp/connections/{connectionId}/tools/{toolName}/calls')
    expect(doc.paths).toHaveProperty('/api/usage')
    expect(doc.paths).toHaveProperty('/api/usage/summary')
    expect(doc.paths).toHaveProperty('/api/audit-records')
    expect(doc.paths).toHaveProperty('/api/audit-records/export')
    expect(doc.paths).toHaveProperty('/api/sessions')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/stop')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/reconnect')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/events')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/events/export')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/events/stream')
    expect(doc.paths).toHaveProperty('/api/vaults')
    expect(doc.paths).toHaveProperty('/api/vaults/{vaultId}')
    expect(doc.paths).toHaveProperty('/api/vaults/{vaultId}/credentials')
    expect(doc.paths).toHaveProperty('/api/vaults/{vaultId}/credentials/{credentialId}')
    expect(doc.paths).toHaveProperty('/api/vaults/{vaultId}/credentials/{credentialId}/versions')
    expect(doc.paths).toHaveProperty('/api/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}')
    expect(doc.paths['/api/sessions']).toHaveProperty('get')
    expect(doc.paths['/api/sessions']).toHaveProperty('post')
    expect(doc.paths['/api/sessions/{sessionId}']).toHaveProperty('get')
    expect(doc.paths['/api/sessions/{sessionId}']).toHaveProperty('patch')
    expect(doc.paths['/api/sessions/{sessionId}']).toHaveProperty('delete')
    expect(doc.paths['/api/sessions/{sessionId}/stop']).toHaveProperty('post')
    expect(doc.paths['/api/sessions/{sessionId}/reconnect']).toHaveProperty('get')
    expect(doc.paths['/api/sessions/{sessionId}/events']).toHaveProperty('get')
    expect(doc.paths['/api/sessions/{sessionId}/events/export']).toHaveProperty('get')
    expect(doc.paths['/api/sessions/{sessionId}/events/stream']).toHaveProperty('get')
    expect(doc.paths['/api/sessions/{sessionId}/events/export'].get.responses?.[200]?.content).toHaveProperty(
      'application/x-ndjson',
    )
    expect(doc.paths['/api/sessions/{sessionId}/events/stream'].get.responses?.[200]?.content).toHaveProperty(
      'application/x-ndjson',
    )
    expect(doc.paths['/api/sessions/{sessionId}/stop'].post.parameters?.map((parameter) => parameter.name)).toContain(
      'reason',
    )
    expect(doc.paths['/api/vaults']).toHaveProperty('get')
    expect(doc.paths['/api/vaults']).toHaveProperty('post')
    expect(doc.paths['/api/vaults/{vaultId}']).toHaveProperty('get')
    expect(doc.paths['/api/vaults/{vaultId}']).toHaveProperty('patch')
    expect(doc.paths['/api/vaults/{vaultId}']).toHaveProperty('delete')
    expect(doc.paths['/api/vaults/{vaultId}/credentials']).toHaveProperty('get')
    expect(doc.paths['/api/vaults/{vaultId}/credentials']).toHaveProperty('post')
    expect(doc.paths['/api/vaults/{vaultId}/credentials/{credentialId}']).toHaveProperty('get')
    expect(doc.paths['/api/vaults/{vaultId}/credentials/{credentialId}']).toHaveProperty('patch')
    expect(doc.paths['/api/vaults/{vaultId}/credentials/{credentialId}/versions']).toHaveProperty('get')
    expect(doc.paths['/api/vaults/{vaultId}/credentials/{credentialId}/versions']).toHaveProperty('post')
    expect(doc.paths['/api/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}']).toHaveProperty('delete')
    expect(doc.paths['/api/providers']).toHaveProperty('get')
    expect(doc.paths['/api/providers']).toHaveProperty('post')
    expect(doc.paths['/api/mcp/connectors']).toHaveProperty('get')
    expect(doc.paths['/api/mcp/connections']).toHaveProperty('get')
    expect(doc.paths['/api/mcp/connections']).toHaveProperty('post')
    expect(doc.paths['/api/mcp/connections/{connectionId}']).toHaveProperty('get')
    expect(doc.paths['/api/mcp/connections/{connectionId}']).toHaveProperty('patch')
    expect(doc.paths['/api/mcp/connections/{connectionId}']).toHaveProperty('delete')
    expect(doc.paths['/api/mcp/connections/{connectionId}/tools']).toHaveProperty('get')
    expect(doc.paths['/api/mcp/connections/{connectionId}/tools/{toolName}/calls']).toHaveProperty('post')
    expect(doc.paths['/api/governance/policy']).toHaveProperty('get')
    expect(doc.paths['/api/governance/policy']).toHaveProperty('put')
    expect(doc.paths['/api/usage/summary']).toHaveProperty('get')
    expect(doc.paths['/api/audit-records/export']).toHaveProperty('get')
    expect(doc.paths['/api/health'].get.security).toBeUndefined()
    expect(doc.paths['/api/auth/login'].get.security).toBeUndefined()
    expect(doc.paths['/api/agents'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/environments'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/sessions'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/vaults'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/providers'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/mcp/connectors'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/governance/policy'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/usage'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/audit-records'].get.security).toEqual([{ cookieAuth: [] }])
    expect(doc.paths['/api/agents'].get.operationId).toBe('listAgents')
    expect(doc.paths['/api/environments'].get.operationId).toBe('listEnvironments')
    expect(doc.paths['/api/sessions'].get.operationId).toBe('listSessions')
    expect(doc.paths['/api/vaults'].get.operationId).toBe('listVaults')
    expect(doc.paths['/api/providers'].get.operationId).toBe('listProviders')
    expect(doc.paths['/api/mcp/connectors'].get.operationId).toBe('listMcpConnectors')
    expect(doc.paths['/api/mcp/connections'].post.operationId).toBe('connectMcpConnector')
    expect(doc.paths['/api/governance/effective-policy'].get.operationId).toBe('readEffectiveGovernancePolicy')
    expect(doc.paths['/api/usage/summary'].get.operationId).toBe('readUsageSummary')
    expect(doc.paths['/api/audit-records'].get.operationId).toBe('listAuditRecords')
    expect(doc.paths['/api/agents'].get.parameters?.map((parameter) => (parameter as { name?: string }).name)).toEqual(
      expect.arrayContaining(['includeArchived', 'status', 'search', 'createdFrom', 'createdTo', 'limit', 'cursor']),
    )
    expect(doc.components?.securitySchemes).toHaveProperty('cookieAuth')
    expect(doc.components?.schemas).toHaveProperty('AuthContext')
    expect(doc.components?.schemas).toHaveProperty('ErrorResponse')
    expect(doc.components?.schemas).toHaveProperty('ListPagination')
    expect(doc.components?.schemas).toHaveProperty('AgentListResponse')
    expect(doc.components?.schemas).toHaveProperty('EnvironmentListResponse')
    expect(doc.components?.schemas).toHaveProperty('SessionListResponse')
    expect(doc.components?.schemas).toHaveProperty('VaultListResponse')
    expect(doc.components?.schemas).toHaveProperty('VaultCredentialListResponse')
    expect(doc.components?.schemas).toHaveProperty('VaultCredentialVersionListResponse')
    expect(doc.components?.schemas).toHaveProperty('CreateAgentRequest')
    expect(doc.components?.schemas).toHaveProperty('UpdateAgentRequest')
    expect(doc.components?.schemas).toHaveProperty('Agent')
    expect(doc.components?.schemas).toHaveProperty('AgentVersion')
    expect(doc.components?.schemas).toHaveProperty('CreateEnvironmentRequest')
    expect(doc.components?.schemas).toHaveProperty('UpdateEnvironmentRequest')
    expect(doc.components?.schemas).toHaveProperty('Environment')
    expect(doc.components?.schemas).toHaveProperty('EnvironmentVersion')
    expect(doc.components?.schemas).toHaveProperty('Session')
    expect(doc.components?.schemas).toHaveProperty('Vault')
    expect(doc.components?.schemas).toHaveProperty('VaultCredential')
    expect(doc.components?.schemas).toHaveProperty('VaultCredentialVersion')
    expect(doc.components?.schemas).toHaveProperty('CreateVaultRequest')
    expect(doc.components?.schemas).toHaveProperty('CreateVaultCredentialRequest')
    expect(doc.components?.schemas).toHaveProperty('RotateVaultCredentialRequest')
    expect(doc.components?.schemas).toHaveProperty('Provider')
    expect(doc.components?.schemas).toHaveProperty('ProviderModel')
    expect(doc.components?.schemas).toHaveProperty('McpConnector')
    expect(doc.components?.schemas).toHaveProperty('McpConnection')
    expect(doc.components?.schemas).toHaveProperty('McpTool')
    expect(doc.components?.schemas).toHaveProperty('ConnectMcpRequest')
    expect(doc.components?.schemas).toHaveProperty('CallMcpToolRequest')
    expect(doc.components?.schemas).toHaveProperty('GovernancePolicy')
    expect(doc.components?.schemas).toHaveProperty('EffectivePolicy')
    expect(doc.components?.schemas).toHaveProperty('UsageRecord')
    expect(doc.components?.schemas).toHaveProperty('UsageSummary')
    expect(doc.components?.schemas).toHaveProperty('AuditRecord')
  })

  it('is discoverable as a restish control-plane contract', async () => {
    const doc = await fetchOpenApi()
    const discoveredOperations = operations(doc)
    const operationIds = discoveredOperations.map(({ operation }) => operation.operationId)

    expect(new Set(operationIds).size).toBe(operationIds.length)

    for (const [tag, expectedOperationIds] of Object.entries(EXPECTED_RESTISH_OPERATIONS)) {
      for (const operationId of expectedOperationIds) {
        const match = discoveredOperations.find(({ operation }) => operation.operationId === operationId)
        expect(match, `Expected restish to discover ${operationId}`).toBeTruthy()
        expect(match?.operation.tags).toContain(tag)
      }
    }

    for (const { path, method, operation } of discoveredOperations) {
      expect(path.startsWith('/api/'), `${method.toUpperCase()} ${path} must stay under /api`).toBe(true)
      expect(operation.operationId, `${method.toUpperCase()} ${path} must have operationId`).toEqual(expect.any(String))
      expect(operation.summary, `${operation.operationId} must have a summary`).toEqual(expect.any(String))
      expect(operation.tags?.length, `${operation.operationId} must have tags`).toBeGreaterThan(0)
      expect(
        Object.keys(operation.responses ?? {}).some((status) => /^[23]/.test(status)),
        `${operation.operationId} must document a success or redirect response`,
      ).toBe(true)
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (/^2/.test(status) && status !== '204') {
          expect(
            response.content,
            `${operation.operationId} ${status} response must describe output content`,
          ).toBeTruthy()
        }
      }

      if (!PUBLIC_PATHS.has(path)) {
        expect(operation.security, `${operation.operationId} must declare cookie auth`).toEqual([{ cookieAuth: [] }])
        expectJsonErrorResponse(operation, '401')
      }
      if (operation.requestBody) {
        expect(
          operation.requestBody?.content?.['application/json'],
          `${operation.operationId} must describe JSON request body`,
        ).toBeTruthy()
      }
      for (const status of ['400', '401', '403', '404', '409', '502'] as const) {
        if (operation.responses?.[status]) {
          expectJsonErrorResponse(operation, status)
        }
      }
    }
  })

  it('serves interactive API docs', async () => {
    const res = await SELF.fetch('https://example.com/api/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('/api/openapi.json')
  })
})
