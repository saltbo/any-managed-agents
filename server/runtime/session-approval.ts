// Approval decision continuation.
//
// This cluster owns deciding a pending tool approval: recording the policy
// decision event + audit, updating the approval grant state, executing (or
// denying) the tool, emitting the tool-result events, and resuming the cloud
// turn loop. It imports session-base + cloud-turn (for the resumed turn) +
// tool-approvals + the runtime leaf modules.

import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import { toolExecutor } from '../adapters/runtime/sandbox-tool-executor'
import { recordAudit } from '../audit'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import { executeCloudSessionTurn } from './cloud-turn'
import { appendRuntimeEvent, type Db, findSession, now, type SessionRuntimeError, stringify } from './session-base'
import { parseJson } from './session-snapshot'
import { type SessionApprovalGrants, sessionApprovalState, writeSessionApprovalState } from './tool-approvals'
import { cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

export type ApprovalDecisionResult =
  | { ok: true; approval: ApprovalRowOutput }
  | { ok: false; error: SessionRuntimeError }

export type ApprovalRowOutput = {
  id: string
  organizationId: string
  projectId: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: string
  relatedEventIds: string
  state: 'approved' | 'denied'
  reason: string | null
  result: string | null
  decidedByUserId: string
  decidedAt: string
  requestedAt: string
  createdAt: string
  updatedAt: string
}

export async function decideSessionApproval(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
): Promise<ApprovalDecisionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  const repo = createRuntimeOrchestrationRepo(db)
  const { pending } = sessionApprovalState(parseJson<Record<string, unknown>>(session.metadata) ?? {})
  if (!pending) {
    const alreadyDecided = await repo.findApproval(auth.project.id, session.id, approvalId)
    if (alreadyDecided) {
      return { ok: false, error: { status: 409, code: 'conflict', message: 'Approval is already decided' } }
    }
    return { ok: false, error: { status: 404, code: 'not_found', message: 'No pending approval for the session' } }
  }
  if (pending.id !== approvalId) {
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Approval is no longer pending' } }
  }

  const approved = body.decision === 'approve'
  const decisionEventId = await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'policy.decision',
      allowed: approved,
      category: 'approval',
      ruleId: 'toolPolicy.requireApprovalTools',
      resourceType: 'tool',
      resourceId: pending.toolName,
      operation: 'tool_approval_decision',
      decision: {
        approvalId: pending.id,
        toolCallId: pending.toolCallId,
        state: approved ? 'approved' : 'denied',
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.result ? { customResult: true } : {}),
      },
    },
    metadata: { source: 'policy', relatedEventIds: pending.relatedEventIds },
  })
  await recordAudit(db, {
    auth,
    action: approved ? 'session.tool_approval_approved' : 'session.tool_approval_denied',
    resourceType: 'tool',
    resourceId: pending.toolName,
    outcome: approved ? 'success' : 'denied',
    sessionId: session.id,
    policyCategory: 'approval',
    metadata: { approvalId: pending.id, toolCallId: pending.toolCallId, decisionEventId },
  })
  await writeSessionApprovalState(db, auth, session.id, (metadata) => {
    const grants = ((metadata.approvalGrants as SessionApprovalGrants | undefined) ?? {}) as SessionApprovalGrants
    const { pendingApproval: _pendingApproval, ...rest } = metadata
    return {
      ...rest,
      approvalGrants: {
        ...grants,
        ...(approved && !body.result ? { approved: { ...grants.approved, [pending.toolCallId]: true } } : {}),
        ...(approved && body.result ? { results: { ...grants.results, [pending.toolCallId]: body.result } } : {}),
        ...(!approved
          ? { denied: { ...grants.denied, [pending.toolCallId]: body.reason ?? 'Tool call denied by the user' } }
          : {}),
      },
    }
  })
  const decidedAt = now()
  const approvalRow: ApprovalRowOutput = {
    id: pending.id,
    organizationId: session.organizationId ?? auth.organization.id,
    projectId: auth.project.id,
    sessionId: session.id,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    input: stringify(pending.input),
    relatedEventIds: stringify(pending.relatedEventIds),
    state: approved ? 'approved' : 'denied',
    reason: body.reason ?? null,
    result: body.result ? stringify(body.result) : null,
    decidedByUserId: auth.user.id,
    decidedAt,
    requestedAt: pending.requestedAt,
    createdAt: decidedAt,
    updatedAt: decidedAt,
  }
  await repo.upsertApproval(approvalRow, decidedAt)
  let resultOutput: Record<string, unknown>
  let resultIsError = false
  if (approved && body.result) {
    resultOutput = body.result
  } else if (approved) {
    const executed = await toolExecutor(env).execute({
      sessionId: session.id,
      sandboxId: session.sandboxId ?? '',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      input: pending.input,
      cwd: '/workspace',
    })
    if (executed.error) {
      resultOutput = executed.error as Record<string, unknown>
      resultIsError = true
    } else {
      resultOutput = executed.output
    }
  } else {
    resultOutput = { denied: true, reason: body.reason ?? 'Tool call denied by the user' }
    resultIsError = true
  }
  const resultText =
    typeof resultOutput.stdout === 'string' || typeof resultOutput.stderr === 'string'
      ? [resultOutput.stdout, resultOutput.stderr]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n')
      : JSON.stringify(resultOutput)
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'tool_execution_end',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      result: { content: [{ type: 'text', text: resultText }], details: resultOutput },
      isError: resultIsError,
      approval: { id: pending.id, decision: body.decision, ...(body.result ? { custom: true } : {}) },
    },
    metadata: { source: 'approval' },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        content: [{ type: 'text', text: resultText }],
        details: resultOutput,
        isError: resultIsError,
        timestamp: Date.now(),
      },
    },
    metadata: { source: 'approval' },
  })
  await repo.updateSession(auth.project.id, session.id, { state: 'running', stateReason: null, updatedAt: now() })
  const resumed = await findSession(db, auth, session.id)
  if (!resumed) {
    throw new Error('Session row is required after approval decision')
  }
  if (cloudTurnsRunInline(env)) {
    await executeCloudSessionTurn(env, db, auth, resumed, { continuation: true }, 'session.command')
  } else {
    await enqueueCloudTurn(env, {
      type: 'session.step',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      auditAction: 'session.command',
    })
  }
  return { ok: true, approval: approvalRow }
}
