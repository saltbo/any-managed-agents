import { connectorPolicyEffect, disconnectedAtFor } from '@server/domain/connection'
import { requiresVaultCredential } from '@server/domain/connector'
import type { Deps } from './deps'
import {
  type AuthScope,
  ConnectionConflictError,
  ConnectionPolicyDeniedError,
  type ConnectionRecord,
  type ConnectionToolRecord,
  ConnectionValidationError,
  type ConnectorRecord,
  type ToolCallRecord,
} from './ports'

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 20_000

function requestTimeoutMs(metadata: Record<string, unknown>) {
  const value = metadata.requestTimeoutMs
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(Math.trunc(value), 100), 60_000)
  }
  return DEFAULT_MCP_REQUEST_TIMEOUT_MS
}

function mcpTarget(connection: ConnectionRecord, endpointUrl: string) {
  return {
    endpointUrl,
    organizationId: connection.organizationId,
    projectId: connection.projectId,
    credentialId: connection.credentialId,
    credentialVersionId: connection.credentialVersionId,
    timeoutMs: requestTimeoutMs(connection.metadata),
  }
}

export interface CreateConnectionInputDto {
  connectorId: string
  endpointUrl: string | null
  credentialRef: { credentialId: string; versionId?: string | undefined } | null
  approvalMode: ConnectionRecord['approvalMode'] | undefined
  metadata: Record<string, unknown>
}

// Creates a connection: catalog availability + governance policy + uniqueness +
// credential resolution, then persists the connection and seeds its tool rows
// from the catalog. Throws typed errors for each failure the http layer maps.
export async function createConnection(
  deps: Deps,
  auth: AuthScope,
  catalog: ConnectorRecord,
  input: CreateConnectionInputDto,
): Promise<ConnectionRecord> {
  if (catalog.availability !== 'available') {
    throw new ConnectionConflictError('Connector is unavailable')
  }
  const mcpPolicy = await deps.policy.resolveMcpPolicy(auth)
  if (connectorPolicyEffect(mcpPolicy, input.connectorId) === 'blocked') {
    throw new ConnectionPolicyDeniedError(input.connectorId)
  }
  const existing = await deps.connections.findByConnector(auth.project.id, input.connectorId)
  if (existing) {
    throw new ConnectionConflictError('A connection for this connector already exists in the project.', {
      connectorId: input.connectorId,
      connectionId: existing.id,
    })
  }
  let credential: { credentialId: string | null; credentialVersionId: string | null }
  try {
    credential = await deps.connections.resolveCredential(
      { organizationId: auth.organization.id, projectId: auth.project.id },
      input.credentialRef,
    )
  } catch (error) {
    throw new ConnectionConflictError(error instanceof Error ? error.message : 'Credential is unavailable.', {
      fields: { credentialRef: 'Credential is unavailable.' },
    })
  }
  if (requiresVaultCredential(catalog.supportedAuthModes) && !credential.credentialVersionId) {
    throw new ConnectionValidationError('Connector requires a vault credential reference.', {
      credentialRef: 'Credential is required for this connector.',
    })
  }
  const timestamp = new Date().toISOString()
  const connection = await deps.connections.insert(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      connectorId: input.connectorId,
      credentialId: credential.credentialId,
      credentialVersionId: credential.credentialVersionId,
      endpointUrl: input.endpointUrl,
      approvalMode: input.approvalMode ?? 'project_policy',
      metadata: input.metadata,
    },
    timestamp,
  )
  await deps.connections.replaceCatalogTools(connection, catalog.tools)
  return connection
}

export interface UpdateConnectionPatch {
  endpointUrl?: string | null
  credentialRef?: { credentialId: string; versionId?: string | undefined } | null
  approvalMode?: ConnectionRecord['approvalMode']
  state?: 'connected' | 'disabled' | 'disconnected'
  metadata?: Record<string, unknown>
}

export async function updateConnection(
  deps: Deps,
  auth: AuthScope,
  connection: ConnectionRecord,
  catalog: ConnectorRecord,
  patch: UpdateConnectionPatch,
): Promise<ConnectionRecord> {
  let credential = { credentialId: connection.credentialId, credentialVersionId: connection.credentialVersionId }
  if (patch.credentialRef !== undefined) {
    try {
      credential = await deps.connections.resolveCredential(
        { organizationId: auth.organization.id, projectId: auth.project.id },
        patch.credentialRef,
      )
    } catch (error) {
      throw new ConnectionConflictError(error instanceof Error ? error.message : 'Credential is unavailable.', {
        fields: { credentialRef: 'Credential is unavailable.' },
      })
    }
  }
  if (requiresVaultCredential(catalog.supportedAuthModes) && !credential.credentialVersionId) {
    throw new ConnectionValidationError('Connector requires a vault credential reference.', {
      credentialRef: 'Credential is required for this connector.',
    })
  }
  const timestamp = new Date().toISOString()
  const state = patch.state ?? connection.state
  return await deps.connections.update(
    connection.id,
    {
      credentialId: credential.credentialId,
      credentialVersionId: credential.credentialVersionId,
      endpointUrl: patch.endpointUrl === undefined ? connection.endpointUrl : patch.endpointUrl,
      approvalMode: patch.approvalMode ?? connection.approvalMode,
      state,
      disconnectedAt: disconnectedAtFor(patch.state, timestamp, connection.disconnectedAt),
      metadata: patch.metadata ?? connection.metadata,
    },
    timestamp,
  )
}

// Lists connection tools. Connections with a configured endpoint sync from the
// live MCP server first; endpoint-less connections serve the catalog tool rows
// captured at connect time. Throws ConnectionConflictError when not connected,
// and rethrows the MCP gateway failure for the http layer to map to 502.
export async function listConnectionTools(deps: Deps, connection: ConnectionRecord): Promise<ConnectionToolRecord[]> {
  if (connection.state !== 'connected') {
    throw new ConnectionConflictError('Connection is not connected')
  }
  if (connection.endpointUrl) {
    const tools = await deps.mcp.listTools(mcpTarget(connection, connection.endpointUrl))
    await deps.connections.replaceServerTools(connection, tools)
  }
  return await deps.connections.listTools(connection.id)
}

export interface ToolCallContext {
  requestId: string | null
}

export type ToolCallOutcome =
  | {
      kind: 'denied'
      decision: { allowed: boolean; category: string; rule: string | null; message: string }
      toolId: string
    }
  | { kind: 'endpoint_missing'; toolId: string }
  | { kind: 'completed'; record: ToolCallRecord }

// Executes a connection tool through the AMA policy boundary: evaluates MCP tool
// policy, records the decision as a session event, then (when allowed) validates
// input, calls the MCP server, persists the tool-call record, and emits start/end
// session events. Returns a tagged outcome so the http layer owns status + audit.
export async function executeToolCall(
  deps: Deps,
  auth: AuthScope,
  connection: ConnectionRecord,
  session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null },
  tool: ConnectionToolRecord,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  const toolCallId = newId('call')
  const decision = await deps.policy.evaluateMcpTool(auth, {
    connectorId: connection.connectorId,
    toolName,
    session,
  })
  await deps.sessionEvents.append({
    auth,
    sessionId: session.id,
    type: 'policy.decision',
    correlationId: toolCallId,
    payload: {
      allowed: decision.allowed,
      category: decision.category,
      ruleId: decision.rule,
      resourceType: decision.category === 'tool' ? 'tool' : 'mcp_connector',
      resourceId: decision.category === 'tool' ? toolName : connection.connectorId,
      operation: 'mcp_tool_call',
      connectorId: connection.connectorId,
      toolName,
    },
  })
  if (!decision.allowed) {
    return { kind: 'denied', decision, toolId: tool.id }
  }
  if (!connection.endpointUrl) {
    return { kind: 'endpoint_missing', toolId: tool.id }
  }

  const startEventId = await deps.sessionEvents.append({
    auth,
    sessionId: session.id,
    type: 'tool_execution_start',
    correlationId: toolCallId,
    payload: { toolCallId, toolName, connectorId: connection.connectorId, input },
  })

  const started = Date.now()
  let callResult: Awaited<ReturnType<Deps['mcp']['callTool']>> | null = null
  let failure: { type: string; message: string } | null = null
  try {
    deps.mcp.validateToolInput(tool.inputSchema, input)
    callResult = await deps.mcp.callTool(mcpTarget(connection, connection.endpointUrl), { toolName, input })
  } catch (error) {
    failure = deps.mcp.normalizeError(error)
  }
  const durationMs = Date.now() - started

  if (failure || !callResult) {
    const normalized = failure ?? deps.mcp.upstreamError
    const record = await persistToolCall(deps, auth, connection, session, {
      id: toolCallId,
      toolName,
      input,
      output: null,
      state: 'error',
      error: normalized,
      durationMs,
    })
    await deps.sessionEvents.append({
      auth,
      sessionId: session.id,
      type: 'tool_execution_end',
      parentEventId: startEventId,
      correlationId: toolCallId,
      payload: {
        toolCallId,
        toolName,
        connectorId: connection.connectorId,
        isError: true,
        durationMs,
        error: normalized,
      },
    })
    return { kind: 'completed', record }
  }

  const output: Record<string, unknown> = {
    content: callResult.content,
    ...(callResult.structuredContent ? { structuredContent: callResult.structuredContent } : {}),
  }
  const record = await persistToolCall(deps, auth, connection, session, {
    id: toolCallId,
    toolName,
    input,
    output,
    state: 'success',
    error: null,
    durationMs,
  })
  await deps.sessionEvents.append({
    auth,
    sessionId: session.id,
    type: 'tool_execution_end',
    parentEventId: startEventId,
    correlationId: toolCallId,
    payload: {
      toolCallId,
      toolName,
      connectorId: connection.connectorId,
      isError: false,
      durationMs,
      outputSummary: {
        contentItems: callResult.content.length,
        hasStructuredContent: !!callResult.structuredContent,
      },
    },
  })
  return { kind: 'completed', record }
}

async function persistToolCall(
  deps: Deps,
  auth: AuthScope,
  connection: ConnectionRecord,
  session: { id: string },
  values: {
    id: string
    toolName: string
    input: Record<string, unknown>
    output: Record<string, unknown> | null
    state: 'success' | 'error'
    error: { type: string; message: string } | null
    durationMs: number
  },
): Promise<ToolCallRecord> {
  const createdAt = new Date().toISOString()
  // The repo redacts input/output at the boundary and returns the persisted
  // record, so the API response mirrors what was stored.
  return await deps.connections.insertToolCall({
    id: values.id,
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    connectionId: connection.id,
    connectorId: connection.connectorId,
    toolName: values.toolName,
    sessionId: session.id,
    input: values.input,
    output: values.output,
    state: values.state,
    error: values.error,
    durationMs: values.durationMs,
    createdAt,
  })
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}
