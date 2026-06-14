// Pure shape of session tool-approval state read off persisted session metadata:
// the pending approval and the recorded decision grants. The metadata is parsed
// JSON whose shape is not guaranteed, so malformed values normalize to "no
// pending approval" / "no grants" rather than flowing wrong-typed data into the
// gate. Writing the state and the approval gate itself are effectful and stay in
// tool-approvals.

export interface PendingSessionApproval {
  id: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  requestedAt: string
  relatedEventIds: string[]
}

export interface SessionApprovalGrants {
  approved?: Record<string, boolean>
  denied?: Record<string, string>
  results?: Record<string, Record<string, unknown>>
}

// Persisted session metadata is parsed JSON, so its shape is not guaranteed.
// Treat a malformed pendingApproval / approvalGrants as "no pending approval"
// / "no grants" rather than letting wrong-typed data flow into the gate logic.
function isPendingSessionApproval(value: unknown): value is PendingSessionApproval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.toolCallId === 'string' && typeof record.toolName === 'string'
}

function asSessionApprovalGrants(value: unknown): SessionApprovalGrants {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SessionApprovalGrants) : {}
}

export function sessionApprovalState(metadata: Record<string, unknown>) {
  const pending = isPendingSessionApproval(metadata.pendingApproval) ? metadata.pendingApproval : null
  const grants = asSessionApprovalGrants(metadata.approvalGrants)
  return { pending, grants }
}
