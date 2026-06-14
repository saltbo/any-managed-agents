import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import { type PendingSessionApproval, sessionApprovalState } from '../domain/runtime/approval-state'
import { toolPolicyRequiresApproval } from '../policy'
import { redactSensitiveValue } from '../redaction'
import type { AuthScope } from '../usecases/ports'
import type { Db } from './session-base'
import type { RuntimeToolPolicyDecision, RuntimeToolPolicyInput } from './session-runtime'

// ── Session tool approvals ───────────────────────────────────────────────────
// A sensitive tool call pauses the run: the pending approval lives on the
// session metadata, the session sits idle with a requires-action reason, and
// recorded decision grants drive the continuation turn. Both cloud turn
// drivers (the sessions command path and the runtime endpoint path) share
// this gate so approval semantics cannot drift between surfaces.

export {
  type PendingSessionApproval,
  type SessionApprovalGrants,
  sessionApprovalState,
} from '../domain/runtime/approval-state'

export async function writeSessionApprovalState(
  db: Db,
  auth: AuthScope,
  sessionId: string,
  update: (metadata: Record<string, unknown>) => Record<string, unknown>,
) {
  const repo = createRuntimeOrchestrationRepo(db)
  const row = await repo.sessionMetadata(auth.project.id, sessionId)
  const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
  const next = update(metadata)
  await repo.updateSession(auth.project.id, sessionId, {
    metadata: JSON.stringify(next),
    updatedAt: new Date().toISOString(),
  })
  return next
}

export interface ToolApprovalGate {
  // Approval-aware policy decision; null means "no approval opinion, proceed".
  gate: (input: RuntimeToolPolicyInput) => Promise<RuntimeToolPolicyDecision | null>
  // Caller-provided custom tool result recorded by an approval decision.
  resolveToolResult: (input: RuntimeToolPolicyInput) => Promise<Record<string, unknown> | null>
  // Drops the synthetic failure events of a freshly-paused tool call so the
  // continuation re-drives it from clean history.
  shouldSuppressEvent: (event: Record<string, unknown>) => boolean
  // True once this turn paused for an approval.
  requiresAction: () => boolean
}

export function createToolApprovalGate(values: {
  db: Db
  auth: AuthScope
  sessionId: string
  sessionMetadata: Record<string, unknown>
  appendEvent: (event: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<string>
}): ToolApprovalGate {
  const { db, auth, sessionId } = values
  const { grants } = sessionApprovalState(values.sessionMetadata)
  let pendingToolCallId: string | null = null

  return {
    requiresAction: () => pendingToolCallId !== null,

    async resolveToolResult({ toolCallId }) {
      return grants.results?.[toolCallId] ?? null
    },

    shouldSuppressEvent(event) {
      if (!pendingToolCallId) {
        return false
      }
      const toolCall = event.toolCall as Record<string, unknown> | undefined
      const message = event.message as Record<string, unknown> | undefined
      const eventToolCallId =
        typeof event.toolCallId === 'string'
          ? event.toolCallId
          : typeof toolCall?.id === 'string'
            ? toolCall.id
            : typeof message?.toolCallId === 'string'
              ? message.toolCallId
              : null
      return eventToolCallId === pendingToolCallId
    },

    async gate({ toolCallId, toolName, input }) {
      const denialReason = grants.denied?.[toolCallId]
      if (denialReason !== undefined) {
        return { allowed: false, reason: denialReason || 'Tool call denied by the user' }
      }
      if (grants.approved?.[toolCallId] || grants.results?.[toolCallId]) {
        return { allowed: true }
      }
      if (!(await toolPolicyRequiresApproval(db, auth, toolName))) {
        return null
      }
      const approvalId = `approval_${crypto.randomUUID().replaceAll('-', '')}`
      const requestEventId = await values.appendEvent(
        {
          type: 'policy.decision',
          allowed: false,
          category: 'approval',
          ruleId: 'toolPolicy.requireApprovalTools',
          resourceType: 'tool',
          resourceId: toolName,
          operation: 'tool_approval_request',
          decision: { approvalId, toolCallId, status: 'pending' },
        },
        { source: 'policy' },
      )
      await recordAudit(db, {
        auth,
        action: 'session.tool_approval_requested',
        resourceType: 'tool',
        resourceId: toolName,
        outcome: 'denied',
        sessionId,
        policyCategory: 'approval',
        metadata: { approvalId, toolCallId },
      })
      await writeSessionApprovalState(db, auth, sessionId, (metadata) => ({
        ...metadata,
        pendingApproval: {
          id: approvalId,
          toolCallId,
          toolName,
          input: redactSensitiveValue(input) as Record<string, unknown>,
          requestedAt: new Date().toISOString(),
          relatedEventIds: [requestEventId],
        } satisfies PendingSessionApproval,
      }))
      pendingToolCallId = toolCallId
      // Park the session: idle with a requires-action reason ends the turn
      // cooperatively on the next liveness check.
      await createRuntimeOrchestrationRepo(db).updateSession(auth.project.id, sessionId, {
        state: 'idle',
        stateReason: 'requires-action',
        updatedAt: new Date().toISOString(),
      })
      return { allowed: false, reason: 'Tool call requires user approval' }
    },
  }
}
