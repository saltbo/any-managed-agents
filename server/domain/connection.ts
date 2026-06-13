// Pure connection rules: connection state machine constants, MCP governance
// connector effect, request-timeout clamping, and credential-ref shaping. Zero
// outward imports — directly unit-testable. The MCP client itself (fetch) is a
// boundary behind the McpGateway.

export const CONNECTION_STATES = ['connected', 'disabled', 'disconnected', 'error'] as const
export const TOOL_AVAILABILITIES = ['available', 'disabled', 'error'] as const
export const TOOL_CALL_STATES = ['success', 'error'] as const
export const CONNECTION_APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

export type ConnectionState = (typeof CONNECTION_STATES)[number]
export type ToolAvailability = (typeof TOOL_AVAILABILITIES)[number]
export type ToolCallState = (typeof TOOL_CALL_STATES)[number]
export type ConnectionApprovalMode = (typeof CONNECTION_APPROVAL_MODES)[number]

export type ConnectorPolicyEffect = 'allowed' | 'blocked' | 'approval_required'

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 20_000

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// Governance MCP policy effect for a connector. blocked > approval_required >
// allowed; an allow-list excludes everything not on it, and defaultEffect:deny
// blocks anything not explicitly allowed.
export function connectorPolicyEffect(mcpPolicy: Record<string, unknown>, connectorId: string): ConnectorPolicyEffect {
  const blocked = stringArray(mcpPolicy.blockedConnectors)
  if (blocked.includes('*') || blocked.includes(connectorId)) {
    return 'blocked'
  }
  const allowed = stringArray(mcpPolicy.allowedConnectors)
  if (allowed.length > 0 && !allowed.includes('*') && !allowed.includes(connectorId)) {
    return 'blocked'
  }
  const required = stringArray(mcpPolicy.requireApprovalConnectors)
  if (required.includes('*') || required.includes(connectorId)) {
    return 'approval_required'
  }
  if (mcpPolicy.defaultEffect === 'deny') {
    return 'blocked'
  }
  return 'allowed'
}

// Per-connection MCP request timeout, clamped to a safe range. metadata may
// override the default; out-of-range values are clamped, not rejected.
export function connectionRequestTimeoutMs(metadata: Record<string, unknown>) {
  const value = metadata.requestTimeoutMs
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(Math.trunc(value), 100), 60_000)
  }
  return DEFAULT_MCP_REQUEST_TIMEOUT_MS
}

export interface CredentialRefShape {
  credentialId: string
  versionId?: string
}

// The wire credentialRef from the stored credential id + optional pinned
// version. Null when no credential is configured.
export function credentialRef(row: {
  credentialId: string | null
  credentialVersionId: string | null
}): CredentialRefShape | null {
  if (!row.credentialId) {
    return null
  }
  return {
    credentialId: row.credentialId,
    ...(row.credentialVersionId ? { versionId: row.credentialVersionId } : {}),
  }
}

// The disconnectedAt transition for a PATCH state change. Disconnect is a state
// transition, not a delete: the connection stays addressable and reconnects
// with PATCH {state:'connected'}.
export function disconnectedAtFor(
  nextState: string | undefined,
  timestamp: string,
  currentDisconnectedAt: string | null,
): string | null {
  if (nextState === 'disconnected') {
    return timestamp
  }
  if (nextState === 'connected') {
    return null
  }
  return currentDisconnectedAt
}
