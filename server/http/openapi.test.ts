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
const EXPECTED_RESTISH_OPERATIONS = {
  System: ['getHealth'],
  Auth: ['createAuthSession', 'readAuthConfig'],
  Projects: ['listProjects', 'createProject'],
  Agents: ['listAgents', 'createAgent'],
  Environments: ['listEnvironments', 'createEnvironment'],
  Sessions: ['listSessions', 'createSession'],
  Triggers: ['listTriggers', 'createTrigger'],
  Runners: ['listRunners', 'createRunner'],
  'Work items': ['listWorkItems', 'readWorkItem'],
  Leases: ['listLeases', 'createLease'],
  Providers: ['listProviders', 'createProvider'],
  Vaults: ['listVaults', 'createVault'],
  Governance: ['readEffectivePolicy', 'listPolicies'],
  Connectors: ['listConnectors', 'readConnector'],
  Connections: ['listConnections', 'createConnection'],
  Usage: ['listUsageRecords', 'readUsageSummary'],
  Audit: ['listAuditRecords', 'readAuditRecord'],
}

async function fetchOpenApi() {
  const res = await SELF.fetch('https://example.com/api/v1/openapi.json')

  expect(res.status).toBe(200)
  return (await res.json()) as OpenApiDocument
}

function schemaProperties(doc: OpenApiDocument, name: string) {
  return Object.keys((doc.components?.schemas?.[name] as { properties?: Record<string, unknown> })?.properties ?? [])
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
  it('publishes the generated control-plane OpenAPI document [spec: agents/api-openapi] [spec: environments/api-openapi] [spec: mcp/openapi] [spec: runners/openapi] [spec: triggers/openapi] [spec: api-contracts/openapi]', async () => {
    const doc = await fetchOpenApi()

    expect(doc.openapi).toBe('3.0.0')
    expect(doc.servers).toEqual([{ url: '/' }])
    expect(doc.paths).toHaveProperty('/api/v1/health')
    expect(doc.paths).toHaveProperty('/api/v1/projects')
    expect(doc.paths).toHaveProperty('/api/v1/auth/config')
    expect(doc.paths).toHaveProperty('/api/v1/auth/sessions')
    expect(doc.paths).toHaveProperty('/api/v1/auth/sessions/current')
    expect(doc.paths).not.toHaveProperty('/api/v1/auth/login-options')
    expect(doc.paths).not.toHaveProperty('/api/auth/session')
    expect(doc.paths).toHaveProperty('/api/v1/agents')
    expect(doc.paths).toHaveProperty('/api/v1/agents/{agentId}')
    expect(doc.paths).toHaveProperty('/api/v1/agents/{agentId}/versions')
    expect(doc.paths).toHaveProperty('/api/v1/agents/{agentId}/versions/{version}')
    expect(doc.paths).toHaveProperty('/api/v1/sessions')
    expect(doc.paths).toHaveProperty('/api/v1/environments')
    expect(doc.paths).toHaveProperty('/api/v1/environments/{environmentId}')
    expect(doc.paths).toHaveProperty('/api/v1/environments/{environmentId}/versions')
    expect(doc.paths).toHaveProperty('/api/v1/providers')
    expect(doc.paths).toHaveProperty('/api/v1/providers/{providerId}')
    expect(doc.paths).toHaveProperty('/api/v1/providers/{providerId}/models')
    expect(doc.paths).toHaveProperty('/api/v1/providers/{providerId}/models/{modelId}')
    expect(doc.paths).toHaveProperty('/api/v1/providers/{providerId}/model-discovery-tasks')
    expect(doc.paths).toHaveProperty('/api/v1/policies')
    expect(doc.paths).toHaveProperty('/api/v1/policies/{policyId}')
    expect(doc.paths).toHaveProperty('/api/v1/effective-policy')
    expect(doc.paths).toHaveProperty('/api/v1/access-rules')
    expect(doc.paths).toHaveProperty('/api/v1/budgets')
    expect(doc.paths).not.toHaveProperty('/api/governance/policy')
    expect(doc.paths).not.toHaveProperty('/api/v1/governance/policy')
    expect(doc.paths).toHaveProperty('/api/v1/connectors')
    expect(doc.paths).toHaveProperty('/api/v1/connectors/{connectorId}')
    expect(doc.paths).toHaveProperty('/api/v1/connections')
    expect(doc.paths).toHaveProperty('/api/v1/connections/{connectionId}')
    expect(doc.paths).toHaveProperty('/api/v1/connections/{connectionId}/tools')
    expect(doc.paths).toHaveProperty('/api/v1/connections/{connectionId}/tools/{toolName}/calls')
    expect(doc.paths).not.toHaveProperty('/api/mcp/connectors')
    expect(doc.paths).toHaveProperty('/api/v1/usage-records')
    expect(doc.paths).toHaveProperty('/api/v1/usage-summary')
    expect(doc.paths).toHaveProperty('/api/v1/audit-records')
    expect(doc.paths).toHaveProperty('/api/v1/audit-records/{recordId}')
    expect(doc.paths).not.toHaveProperty('/api/audit-records/export')
    expect(doc.paths).toHaveProperty('/api/v1/triggers')
    expect(doc.paths).toHaveProperty('/api/v1/triggers/{triggerId}')
    expect(doc.paths).toHaveProperty('/api/v1/triggers/{triggerId}/runs')
    expect(doc.paths).not.toHaveProperty('/api/scheduled-agent-triggers')
    expect(doc.paths).toHaveProperty('/api/v1/sessions')
    expect(doc.paths).toHaveProperty('/api/v1/sessions/{sessionId}')
    expect(doc.paths).toHaveProperty('/api/v1/sessions/{sessionId}/connection')
    expect(doc.paths).toHaveProperty('/api/v1/sessions/{sessionId}/messages')
    expect(doc.paths).toHaveProperty('/api/v1/sessions/{sessionId}/events')
    expect(doc.paths).toHaveProperty('/api/v1/sessions/{sessionId}/approvals')
    expect(doc.paths).toHaveProperty('/api/v1/sessions/{sessionId}/approvals/{approvalId}')
    expect(doc.paths).not.toHaveProperty('/api/v1/sessions/{sessionId}/stop')
    expect(doc.paths).not.toHaveProperty('/api/v1/sessions/{sessionId}/reconnect')
    expect(doc.paths).not.toHaveProperty('/api/v1/sessions/{sessionId}/events/export')
    expect(doc.paths).not.toHaveProperty('/api/v1/sessions/{sessionId}/events/stream')
    expect(doc.paths).toHaveProperty('/api/v1/runners')
    expect(doc.paths).toHaveProperty('/api/v1/runners/{runnerId}')
    expect(doc.paths).toHaveProperty('/api/v1/runners/{runnerId}/heartbeat')
    expect(doc.paths).toHaveProperty('/api/v1/leases')
    expect(doc.paths).toHaveProperty('/api/v1/leases/{leaseId}')
    expect(doc.paths).toHaveProperty('/api/v1/leases/{leaseId}/channel')
    expect(doc.paths).toHaveProperty('/api/v1/work-items')
    expect(doc.paths).toHaveProperty('/api/v1/work-items/{workItemId}')
    expect(doc.paths).not.toHaveProperty('/api/runners/work-items')
    expect(doc.paths).not.toHaveProperty('/api/runners/{runnerId}/heartbeats')
    expect(doc.paths).not.toHaveProperty('/api/runners/{runnerId}/leases')
    expect(doc.paths).toHaveProperty('/api/v1/vaults')
    expect(doc.paths).toHaveProperty('/api/v1/vaults/{vaultId}')
    expect(doc.paths).toHaveProperty('/api/v1/vaults/{vaultId}/credentials')
    expect(doc.paths).toHaveProperty('/api/v1/vaults/{vaultId}/credentials/{credentialId}')
    expect(doc.paths).toHaveProperty('/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions')
    expect(doc.paths).toHaveProperty('/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}')

    expect(doc.paths['/api/v1/sessions']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions']).toHaveProperty('post')
    expect(doc.paths['/api/v1/sessions/{sessionId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions/{sessionId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/sessions/{sessionId}/connection']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions/{sessionId}/messages']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions/{sessionId}/messages']).toHaveProperty('post')
    expect(doc.paths['/api/v1/sessions/{sessionId}/events']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions/{sessionId}/events']).toHaveProperty('post')
    expect(doc.paths['/api/v1/sessions/{sessionId}/approvals']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions/{sessionId}/approvals/{approvalId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/sessions/{sessionId}/approvals/{approvalId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/sessions/{sessionId}/approvals/{approvalId}'].patch.operationId).toBe(
      'decideSessionApproval',
    )

    expect(doc.paths['/api/v1/runners']).toHaveProperty('get')
    expect(doc.paths['/api/v1/runners']).toHaveProperty('post')
    expect(doc.paths['/api/v1/runners/{runnerId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/runners/{runnerId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/runners/{runnerId}/heartbeat']).toHaveProperty('put')
    expect(doc.paths['/api/v1/runners/{runnerId}/heartbeat'].put.operationId).toBe('putRunnerHeartbeat')
    expect(doc.paths['/api/v1/leases']).toHaveProperty('get')
    expect(doc.paths['/api/v1/leases']).toHaveProperty('post')
    expect(doc.paths['/api/v1/leases/{leaseId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/leases/{leaseId}/channel']).toHaveProperty('get')
    expect(doc.paths['/api/v1/work-items']).toHaveProperty('get')

    expect(doc.paths['/api/v1/vaults']).toHaveProperty('get')
    expect(doc.paths['/api/v1/vaults']).toHaveProperty('post')
    expect(doc.paths['/api/v1/vaults/{vaultId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/vaults/{vaultId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials']).toHaveProperty('get')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials']).toHaveProperty('post')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials/{credentialId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials/{credentialId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions']).toHaveProperty('get')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions']).toHaveProperty('post')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}']).toHaveProperty(
      'delete',
    )

    expect(doc.paths['/api/v1/providers']).toHaveProperty('get')
    expect(doc.paths['/api/v1/providers']).toHaveProperty('post')
    expect(doc.paths['/api/v1/providers/{providerId}/models/{modelId}']).toHaveProperty('put')
    expect(doc.paths['/api/v1/connectors']).toHaveProperty('get')
    expect(doc.paths['/api/v1/connections']).toHaveProperty('get')
    expect(doc.paths['/api/v1/connections']).toHaveProperty('post')
    expect(doc.paths['/api/v1/connections/{connectionId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/connections/{connectionId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/connections/{connectionId}/tools']).toHaveProperty('get')
    expect(doc.paths['/api/v1/connections/{connectionId}/tools/{toolName}/calls']).toHaveProperty('get')
    expect(doc.paths['/api/v1/connections/{connectionId}/tools/{toolName}/calls']).toHaveProperty('post')
    expect(doc.paths['/api/v1/policies']).toHaveProperty('get')
    expect(doc.paths['/api/v1/policies']).toHaveProperty('post')
    expect(doc.paths['/api/v1/policies/{policyId}']).toHaveProperty('put')
    expect(doc.paths['/api/v1/usage-summary']).toHaveProperty('get')
    expect(doc.paths['/api/v1/triggers']).toHaveProperty('get')
    expect(doc.paths['/api/v1/triggers']).toHaveProperty('post')
    expect(doc.paths['/api/v1/triggers/{triggerId}']).toHaveProperty('get')
    expect(doc.paths['/api/v1/triggers/{triggerId}']).toHaveProperty('patch')
    expect(doc.paths['/api/v1/triggers/{triggerId}/runs']).toHaveProperty('get')

    expect(doc.paths['/api/v1/health'].get.security).toBeUndefined()
    expect(doc.paths['/api/v1/auth/config'].get.security).toBeUndefined()
    expect(doc.paths['/api/v1/auth/sessions'].post.security).toBeUndefined()
    expect(doc.paths['/api/v1/agents'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/environments'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/sessions'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/vaults'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/runners'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/providers'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/connectors'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/policies'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/usage-records'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/audit-records'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/v1/triggers'].get.security).toEqual([{ bearerAuth: [] }])

    expect(doc.paths['/api/v1/agents'].get.operationId).toBe('listAgents')
    expect(doc.paths['/api/v1/environments'].get.operationId).toBe('listEnvironments')
    expect(doc.paths['/api/v1/sessions'].get.operationId).toBe('listSessions')
    expect(doc.paths['/api/v1/runners'].get.operationId).toBe('listRunners')
    expect(doc.paths['/api/v1/vaults'].get.operationId).toBe('listVaults')
    expect(doc.paths['/api/v1/providers'].get.operationId).toBe('listProviders')
    expect(doc.paths['/api/v1/connectors'].get.operationId).toBe('listConnectors')
    expect(doc.paths['/api/v1/connections'].post.operationId).toBe('createConnection')
    expect(doc.paths['/api/v1/effective-policy'].get.operationId).toBe('readEffectivePolicy')
    expect(doc.paths['/api/v1/usage-summary'].get.operationId).toBe('readUsageSummary')
    expect(doc.paths['/api/v1/audit-records'].get.operationId).toBe('listAuditRecords')
    expect(doc.paths['/api/v1/triggers'].get.operationId).toBe('listTriggers')
    expect(doc.paths['/api/v1/triggers'].post.operationId).toBe('createTrigger')
    expect(doc.paths['/api/v1/triggers/{triggerId}'].get.operationId).toBe('readTrigger')
    expect(doc.paths['/api/v1/triggers/{triggerId}'].patch.operationId).toBe('updateTrigger')
    expect(doc.paths['/api/v1/triggers/{triggerId}/runs'].get.operationId).toBe('listTriggerRuns')

    expect(
      doc.paths['/api/v1/triggers/{triggerId}'].get.parameters?.map(
        (parameter) => (parameter as { name?: string }).name,
      ),
    ).toContain('triggerId')
    expect(
      doc.paths['/api/v1/triggers/{triggerId}/runs'].get.parameters?.map(
        (parameter) => (parameter as { name?: string }).name,
      ),
    ).toEqual(expect.arrayContaining(['triggerId', 'state', 'search', 'createdFrom', 'createdTo', 'limit', 'cursor']))
    expect(
      doc.paths['/api/v1/agents'].get.parameters?.map((parameter) => (parameter as { name?: string }).name),
    ).toEqual(expect.arrayContaining(['archived', 'search', 'createdFrom', 'createdTo', 'limit', 'cursor']))

    expect(doc.components?.securitySchemes).toHaveProperty('bearerAuth')
    expect(doc.components?.schemas).toHaveProperty('Project')
    expect(doc.components?.schemas).toHaveProperty('ErrorResponse')
    expect(doc.components?.schemas).toHaveProperty('ListPagination')
    expect(doc.components?.schemas).toHaveProperty('AgentListResponse')
    expect(doc.components?.schemas).toHaveProperty('EnvironmentListResponse')
    expect(doc.components?.schemas).toHaveProperty('SessionListResponse')
    expect(doc.components?.schemas).toHaveProperty('Runner')
    expect(doc.components?.schemas).toHaveProperty('RunnerListResponse')
    expect(doc.components?.schemas).toHaveProperty('WorkItem')
    expect(doc.components?.schemas).toHaveProperty('WorkItemListResponse')
    expect(doc.components?.schemas).toHaveProperty('Lease')
    expect(doc.components?.schemas).toHaveProperty('LeaseListResponse')
    expect(doc.components?.schemas).toHaveProperty('CreateRunnerRequest')
    expect(doc.components?.schemas).toHaveProperty('CreateLeaseRequest')
    expect(doc.components?.schemas).toHaveProperty('PutRunnerHeartbeatRequest')
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
    expect(doc.components?.schemas).toHaveProperty('EnvironmentHostingMode')
    expect(doc.components?.schemas).toHaveProperty('EnvironmentNetworkPolicy')
    expect(doc.components?.schemas).toHaveProperty('Runtime')
    expect(doc.components?.schemas).toHaveProperty('Session')
    expect(doc.components?.schemas).toHaveProperty('SessionEnvironmentSnapshot')
    expect(doc.components?.schemas).toHaveProperty('SessionRuntimeMetadata')
    expect(doc.components?.schemas).toHaveProperty('CreateSessionRequest')
    expect(doc.components?.schemas).toHaveProperty('UpdateSessionRequest')
    expect(doc.components?.schemas).toHaveProperty('CreateSessionMessageRequest')
    expect(doc.components?.schemas).toHaveProperty('SessionApprovalDecisionRequest')
    expect(doc.components?.schemas).toHaveProperty('Vault')
    expect(doc.components?.schemas).toHaveProperty('VaultCredential')
    expect(doc.components?.schemas).toHaveProperty('VaultCredentialVersion')
    expect(doc.components?.schemas).toHaveProperty('CreateVaultRequest')
    expect(doc.components?.schemas).toHaveProperty('CreateVaultCredentialRequest')
    expect(doc.components?.schemas).toHaveProperty('CreateVaultCredentialVersionRequest')
    expect(doc.components?.schemas).toHaveProperty('Provider')
    expect(doc.components?.schemas).toHaveProperty('ProviderModel')
    expect(doc.components?.schemas).toHaveProperty('Connector')
    expect(doc.components?.schemas).toHaveProperty('Connection')
    expect(doc.components?.schemas).toHaveProperty('ConnectionTool')
    expect(doc.components?.schemas).toHaveProperty('CreateConnectionRequest')
    expect(doc.components?.schemas).toHaveProperty('CreateToolCallRequest')
    expect(doc.components?.schemas).toHaveProperty('Policy')
    expect(doc.components?.schemas).toHaveProperty('EffectivePolicy')
    expect(doc.components?.schemas).toHaveProperty('AccessRule')
    expect(doc.components?.schemas).toHaveProperty('Budget')
    expect(doc.components?.schemas).toHaveProperty('UsageRecord')
    expect(doc.components?.schemas).toHaveProperty('UsageSummary')
    expect(doc.components?.schemas).toHaveProperty('AuditRecord')
    expect(doc.components?.schemas).toHaveProperty('Trigger')
    expect(doc.components?.schemas).toHaveProperty('TriggerRun')
    expect(doc.components?.schemas).toHaveProperty('TriggerListResponse')
    expect(doc.components?.schemas).toHaveProperty('TriggerRunListResponse')
    expect(doc.components?.schemas).toHaveProperty('CreateTriggerRequest')
    expect(doc.components?.schemas).toHaveProperty('UpdateTriggerRequest')

    expect(doc.components?.schemas).not.toHaveProperty('GovernancePolicy')
    expect(doc.components?.schemas).not.toHaveProperty('McpConnector')
    expect(doc.components?.schemas).not.toHaveProperty('McpConnection')
    expect(doc.components?.schemas).not.toHaveProperty('ScheduledAgentTrigger')
    expect(doc.components?.schemas).not.toHaveProperty('ScheduledTriggerRun')

    for (const schemaName of [
      'Environment',
      'EnvironmentVersion',
      'CreateEnvironmentRequest',
      'UpdateEnvironmentRequest',
      'SessionEnvironmentSnapshot',
    ]) {
      const properties = schemaProperties(doc, schemaName)
      expect(properties).toEqual(expect.arrayContaining(['hostingMode', 'runtimeConfig']))
      expect(properties).not.toContain('runtime')
      expect(properties).not.toContain('runtimeType')
      expect(properties).not.toContain('runtimeImage')
    }

    const createSessionProperties = (
      doc.components?.schemas?.CreateSessionRequest as {
        properties?: Record<string, { maxLength?: number; minLength?: number; type?: string }>
      }
    )?.properties
    expect(createSessionProperties).toHaveProperty('initialPrompt')
    expect(createSessionProperties?.initialPrompt).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 16000,
    })

    const createTriggerSchema = doc.components?.schemas?.CreateTriggerRequest as {
      properties?: Record<string, { type?: string; minLength?: number; maxLength?: number; properties?: unknown }>
      required?: string[]
    }
    const createTriggerProperties = createTriggerSchema?.properties
    expect(createTriggerProperties).toMatchObject({
      agentId: { type: 'string', minLength: 1 },
      environmentId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      promptTemplate: { type: 'string', minLength: 1, maxLength: 16000 },
      resourceRefs: { type: 'array' },
      env: { type: 'object' },
      secretEnv: { type: 'array' },
      schedule: { type: 'object' },
      enabled: { type: 'boolean' },
      metadata: { type: 'object' },
    })
    expect(createTriggerProperties?.runtime).toEqual({ $ref: '#/components/schemas/Runtime' })
    expect(createTriggerSchema?.required).toEqual(
      expect.arrayContaining(['agentId', 'environmentId', 'runtime', 'name', 'promptTemplate', 'schedule']),
    )

    const triggerRunProperties = (
      doc.components?.schemas?.TriggerRun as {
        properties?: Record<string, { type?: string; nullable?: boolean }>
      }
    )?.properties
    expect(triggerRunProperties).toMatchObject({
      scheduledFor: { type: 'string' },
      heartbeatAt: { type: 'string' },
      state: { type: 'string' },
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string', nullable: true },
      correlationId: { type: 'string' },
    })
  })

  it('is discoverable as a restish control-plane contract [spec: api-contracts/error-envelope]', async () => {
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
      expect(path.startsWith('/api/v1/'), `${method.toUpperCase()} ${path} must stay under /api/v1`).toBe(true)
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

      const isPublic = operation.security === undefined
      if (!isPublic) {
        expect(operation.security, `${operation.operationId} must declare bearer auth`).toEqual([{ bearerAuth: [] }])
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

    // Anchor the public/protected split to known endpoints so the security model stays meaningful.
    expect(doc.paths['/api/v1/health'].get.security).toBeUndefined()
    expect(doc.paths['/api/v1/agents'].get.security).toEqual([{ bearerAuth: [] }])
  })

  it('serves interactive API docs', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('/api/v1/openapi.json')
  })

  it('keeps session environment snapshots on the strict environment network policy contract', async () => {
    const doc = await fetchOpenApi()
    const schemas = doc.components?.schemas as Record<
      string,
      {
        properties?: Record<string, unknown>
      }
    >
    const environmentNetworkPolicy = schemas.EnvironmentNetworkPolicy as {
      properties?: {
        allowedHosts?: {
          maxItems?: number
          items?: { minLength?: number; maxLength?: number; pattern?: string }
        }
      }
      required?: string[]
      additionalProperties?: boolean
    }

    expect(schemas.SessionEnvironmentSnapshot.properties?.networkPolicy).toEqual({
      $ref: '#/components/schemas/EnvironmentNetworkPolicy',
    })
    expect(environmentNetworkPolicy.required).toContain('mode')
    expect(environmentNetworkPolicy.additionalProperties).toBe(false)
    expect(environmentNetworkPolicy.properties?.allowedHosts).toMatchObject({
      maxItems: 100,
      items: {
        minLength: 1,
        maxLength: 253,
        pattern: '^[a-z0-9.-]+$',
      },
    })
  })

  it('publishes canonical session runtime metadata without legacy owner fields', async () => {
    const doc = await fetchOpenApi()
    const schemas = doc.components?.schemas as Record<
      string,
      {
        required?: string[]
        properties?: Record<string, unknown>
      }
    >

    expect(schemas.Session.required).toContain('runtimeMetadata')
    expect(schemas.Session.properties).toHaveProperty('runtimeMetadata')
    expect(schemas.Session.properties).not.toHaveProperty('piRuntimeId')
    expect(schemas.Session.properties).not.toHaveProperty('piProcessId')
    expect(schemas.Session.properties).not.toHaveProperty('modelProvider')
    expect(schemas.Session.properties).not.toHaveProperty('modelConfig')
    expect(schemas.Session.properties).not.toHaveProperty('runtimeOwner')
    expect(schemas.Session.properties).not.toHaveProperty('organizationId')
    expect(schemas.Session.properties).not.toHaveProperty('durableObjectName')
    expect(schemas.Session.properties).not.toHaveProperty('sandboxId')
    expect(schemas.Session.properties).not.toHaveProperty('runtimeEndpointPath')
    expect(schemas.SessionRuntimeMetadata.required).toEqual(
      expect.arrayContaining(['hostingMode', 'runtime', 'runtimeConfig', 'provider', 'model', 'driver']),
    )
    expect(schemas.SessionRuntimeMetadata.properties).toEqual(
      expect.objectContaining({
        hostingMode: { $ref: '#/components/schemas/EnvironmentHostingMode' },
        runtime: { $ref: '#/components/schemas/Runtime' },
      }),
    )
    expect(schemas.SessionRuntimeMetadata.properties).not.toHaveProperty('runtimeOwner')
  })
})
