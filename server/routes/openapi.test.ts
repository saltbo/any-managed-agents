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
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/session', '/api/auth/login-options'])
const EXPECTED_RESTISH_OPERATIONS = {
  System: ['getHealth'],
  Auth: ['createAuthSession', 'getLoginOptions'],
  Agents: ['listAgents', 'createAgent'],
  Environments: ['listEnvironments', 'createEnvironment'],
  Sessions: ['listSessions', 'createSession'],
  'Scheduled agent triggers': ['listScheduledAgentTriggers', 'createScheduledAgentTrigger'],
  Runners: ['listRunners', 'createRunner'],
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
  it('publishes the generated control-plane OpenAPI document', async () => {
    const doc = await fetchOpenApi()

    expect(doc.openapi).toBe('3.0.0')
    expect(doc.servers).toEqual([{ url: '/' }])
    expect(doc.paths).toHaveProperty('/api/health')
    expect(doc.paths).toHaveProperty('/api/projects')
    expect(doc.paths).toHaveProperty('/api/auth/session')
    expect(doc.paths).toHaveProperty('/api/auth/login-options')
    expect(doc.paths).not.toHaveProperty('/api/auth/config')
    expect(doc.paths).toHaveProperty('/api/agents')
    expect(doc.paths).toHaveProperty('/api/agents/{agentId}')
    expect(doc.paths).toHaveProperty('/api/agents/{agentId}/versions')
    expect(doc.paths).toHaveProperty('/api/sessions')
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
    expect(doc.paths).toHaveProperty('/api/scheduled-agent-triggers')
    expect(doc.paths).toHaveProperty('/api/scheduled-agent-triggers/{triggerId}')
    expect(doc.paths).toHaveProperty('/api/scheduled-agent-triggers/{triggerId}/runs')
    expect(doc.paths).toHaveProperty('/api/sessions')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/stop')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/reconnect')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/events')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/events/export')
    expect(doc.paths).toHaveProperty('/api/sessions/{sessionId}/events/stream')
    expect(doc.paths).toHaveProperty('/api/runners')
    expect(doc.paths).toHaveProperty('/api/runners/{runnerId}')
    expect(doc.paths).toHaveProperty('/api/runners/{runnerId}/heartbeats')
    expect(doc.paths).toHaveProperty('/api/runners/{runnerId}/leases')
    expect(doc.paths).toHaveProperty('/api/runners/{runnerId}/leases/{leaseId}')
    expect(doc.paths).toHaveProperty('/api/runners/{runnerId}/leases/{leaseId}/events')
    expect(doc.paths).toHaveProperty('/api/runners/work-items')
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
    expect(doc.paths['/api/runners']).toHaveProperty('get')
    expect(doc.paths['/api/runners']).toHaveProperty('post')
    expect(doc.paths['/api/runners/{runnerId}']).toHaveProperty('get')
    expect(doc.paths['/api/runners/{runnerId}']).toHaveProperty('patch')
    expect(doc.paths['/api/runners/{runnerId}/heartbeats']).toHaveProperty('post')
    expect(doc.paths['/api/runners/{runnerId}/leases']).toHaveProperty('post')
    expect(doc.paths['/api/runners/{runnerId}/leases/{leaseId}']).toHaveProperty('patch')
    expect(doc.paths['/api/runners/{runnerId}/leases/{leaseId}/events']).toHaveProperty('post')
    expect(doc.paths['/api/runners/work-items']).toHaveProperty('get')
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
    expect(doc.paths['/api/scheduled-agent-triggers']).toHaveProperty('get')
    expect(doc.paths['/api/scheduled-agent-triggers']).toHaveProperty('post')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}']).toHaveProperty('get')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}']).toHaveProperty('patch')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}']).toHaveProperty('delete')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}/runs']).toHaveProperty('get')
    expect(doc.paths['/api/health'].get.security).toBeUndefined()
    expect(doc.paths['/api/health'].get.security).toBeUndefined()
    expect(doc.paths['/api/agents'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/environments'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/sessions'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/vaults'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/runners'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/providers'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/mcp/connectors'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/governance/policy'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/usage'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/audit-records'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/scheduled-agent-triggers'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/agents'].get.operationId).toBe('listAgents')
    expect(doc.paths['/api/environments'].get.operationId).toBe('listEnvironments')
    expect(doc.paths['/api/sessions'].get.operationId).toBe('listSessions')
    expect(doc.paths['/api/runners'].get.operationId).toBe('listRunners')
    expect(doc.paths['/api/vaults'].get.operationId).toBe('listVaults')
    expect(doc.paths['/api/providers'].get.operationId).toBe('listProviders')
    expect(doc.paths['/api/mcp/connectors'].get.operationId).toBe('listMcpConnectors')
    expect(doc.paths['/api/mcp/connections'].post.operationId).toBe('connectMcpConnector')
    expect(doc.paths['/api/governance/effective-policy'].get.operationId).toBe('readEffectiveGovernancePolicy')
    expect(doc.paths['/api/usage/summary'].get.operationId).toBe('readUsageSummary')
    expect(doc.paths['/api/audit-records'].get.operationId).toBe('listAuditRecords')
    expect(doc.paths['/api/scheduled-agent-triggers'].get.operationId).toBe('listScheduledAgentTriggers')
    expect(doc.paths['/api/scheduled-agent-triggers'].post.operationId).toBe('createScheduledAgentTrigger')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}'].get.operationId).toBe('readScheduledAgentTrigger')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}'].patch.operationId).toBe('updateScheduledAgentTrigger')
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}'].delete.operationId).toBe(
      'archiveScheduledAgentTrigger',
    )
    expect(doc.paths['/api/scheduled-agent-triggers/{triggerId}/runs'].get.operationId).toBe('listScheduledTriggerRuns')
    expect(
      doc.paths['/api/scheduled-agent-triggers/{triggerId}'].get.parameters?.map(
        (parameter) => (parameter as { name?: string }).name,
      ),
    ).toContain('triggerId')
    expect(
      doc.paths['/api/scheduled-agent-triggers/{triggerId}/runs'].get.parameters?.map(
        (parameter) => (parameter as { name?: string }).name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'triggerId',
        'includeArchived',
        'status',
        'search',
        'createdFrom',
        'createdTo',
        'limit',
        'cursor',
      ]),
    )
    expect(doc.paths['/api/agents'].get.parameters?.map((parameter) => (parameter as { name?: string }).name)).toEqual(
      expect.arrayContaining(['includeArchived', 'status', 'search', 'createdFrom', 'createdTo', 'limit', 'cursor']),
    )
    expect(doc.components?.securitySchemes).toHaveProperty('bearerAuth')
    expect(doc.components?.schemas).toHaveProperty('Project')
    expect(doc.components?.schemas).toHaveProperty('ErrorResponse')
    expect(doc.components?.schemas).toHaveProperty('ListPagination')
    expect(doc.components?.schemas).toHaveProperty('AgentListResponse')
    expect(doc.components?.schemas).toHaveProperty('EnvironmentListResponse')
    expect(doc.components?.schemas).toHaveProperty('SessionListResponse')
    expect(doc.components?.schemas).toHaveProperty('Runner')
    expect(doc.components?.schemas).toHaveProperty('RunnerListResponse')
    expect(doc.components?.schemas).toHaveProperty('RunnerWorkItem')
    expect(doc.components?.schemas).toHaveProperty('RunnerWorkLease')
    expect(doc.components?.schemas).toHaveProperty('CreateRunnerRequest')
    expect(doc.components?.schemas).toHaveProperty('RunnerWorkItemListResponse')
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
    expect(doc.components?.schemas).toHaveProperty('ScheduledAgentTrigger')
    expect(doc.components?.schemas).toHaveProperty('ScheduledTriggerRun')
    expect(doc.components?.schemas).toHaveProperty('ScheduledAgentTriggerListResponse')
    expect(doc.components?.schemas).toHaveProperty('ScheduledTriggerRunListResponse')
    expect(doc.components?.schemas).toHaveProperty('CreateScheduledAgentTriggerRequest')
    expect(doc.components?.schemas).toHaveProperty('UpdateScheduledAgentTriggerRequest')
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
    const createTriggerProperties = (
      doc.components?.schemas?.CreateScheduledAgentTriggerRequest as {
        properties?: Record<string, { type?: string; minLength?: number; maxLength?: number; properties?: unknown }>
        required?: string[]
      }
    )?.properties
    expect(createTriggerProperties).toMatchObject({
      agentId: { type: 'string', minLength: 1 },
      environmentId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 160 },
      promptTemplate: { type: 'string', minLength: 1, maxLength: 16000 },
      resourceRefs: { type: 'array' },
      runtimeEnv: { type: 'object' },
      runtimeSecretEnv: { type: 'array' },
      schedule: { type: 'object' },
      nextDueAt: { type: 'string' },
      metadata: { type: 'object' },
    })
    const triggerRunProperties = (
      doc.components?.schemas?.ScheduledTriggerRun as {
        properties?: Record<string, { type?: string; nullable?: boolean }>
      }
    )?.properties
    expect(triggerRunProperties).toMatchObject({
      scheduledFor: { type: 'string' },
      heartbeatAt: { type: 'string' },
      status: { type: 'string' },
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string', nullable: true },
      correlationId: { type: 'string' },
    })
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
  })

  it('serves interactive API docs', async () => {
    const res = await SELF.fetch('https://example.com/api/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('/api/openapi.json')
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
