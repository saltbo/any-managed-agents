// Runtime execution layer for sessions.
//
// This module owns the env-bound session machinery: the create-session
// orchestration (snapshot, provider/policy/runtime validation, session-row
// build, runtime launch), the cloud turn loop and its queue consumer, prompt
// dispatch (live channel vs queued), stop/archive runtime teardown, and the
// approval-decision continuation. It sits in server/runtime/ alongside the
// other runtime execution infrastructure (drivers, sandbox/DO bindings, the
// turn queue) and is consumed by the SessionRuntimeGateway adapter, the queue
// consumer (server/worker), and the scheduled-dispatch wrapper.
//
// Every public entry here is Response-free: HTTP concerns (Response, status
// codes, SSE) stay in server/http/sessions.ts. Outcomes cross the boundary as
// discriminated result objects.

import { runtimeSupportsLivePrompts } from '@server/domain/runtime-catalog'
import { createRuntimeOrchestrationRepo, type SessionRow } from '../adapters/repos/runtime-orchestration'
import { toolExecutor } from '../adapters/runtime/sandbox-tool-executor'
import { recordAudit } from '../audit'
import { sessionRuntimeConfig, sessionRuntimeFromMetadata } from '../domain/runtime-session'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import { consumeCloudTurnMessage, executeCloudSessionTurn } from './cloud-turn'
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runner-session-command'
import type { safeRuntimeError } from './runtime-error'
import type { RuntimeSecretEnvEntry } from './secret-env'
import { appendRuntimeEvent, type Db, findSession, now, type SessionRuntimeError, stringify } from './session-base'
import {
  type CreateSessionOptions,
  type CreateSessionResult,
  createSessionForAgent,
  enqueueSelfHostedSessionWork,
  latestRunnerResumeToken,
} from './session-create'
import {
  archiveSession,
  markExpiredPendingSessions,
  type StopSessionResult,
  stopSession,
  unarchiveSession,
} from './session-lifecycle'
import {
  type GitHubRepositoryResourceRef,
  normalizeEnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
  type ResourceRef,
  type SerializedAgentVersion,
  type serializeEnvironmentVersion,
} from './session-snapshot'
import {
  type PendingSessionApproval,
  type SessionApprovalGrants,
  sessionApprovalState,
  writeSessionApprovalState,
} from './tool-approvals'
import { cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

// Snapshot/resource shaping moved to ./session-snapshot; CreateSessionResult and
// CreateSessionOptions to ./session-create; SessionRuntimeError to ./session-base;
// StopSessionResult to ./session-lifecycle. Re-exported for the public surface
// that historically lived here (consumed by the SessionRuntimeGateway adapter).
export type {
  CreateSessionOptions,
  CreateSessionResult,
  GitHubRepositoryResourceRef,
  ResourceRef,
  SerializedAgentVersion,
  SessionRow,
  SessionRuntimeError,
  StopSessionResult,
}
// appendRuntimeEvent moved to ./session-base; consumeCloudTurnMessage to
// ./cloud-turn; createSessionForAgent to ./session-create; the stop/archive
// lifecycle to ./session-lifecycle. Re-exported for the public surface that
// historically lived here (consumed by the gateway adapter, runtime-proxy, the
// http layer, and server/worker).
export {
  appendRuntimeEvent,
  archiveSession,
  consumeCloudTurnMessage,
  createSessionForAgent,
  markExpiredPendingSessions,
  stopSession,
  unarchiveSession,
}

type MessageDelivery = 'live' | 'queued'
type MessageState = 'accepted' | 'delivered' | 'failed'

// ── Prompt dispatch ─────────────────────────────────────────────────────────

export type PromptDispatchOutcome =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: ReturnType<typeof safeRuntimeError> }
  | { ok: true; delivery: MessageDelivery; state: MessageState }

export async function dispatchSessionPrompt(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  content: string,
): Promise<PromptDispatchOutcome> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (session.state !== 'idle' && session.state !== 'running') {
    return { ok: false, status: 409, message: 'Session runtime is not active' }
  }
  if (!session.sandboxId) {
    const metadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
    if (
      runtimeSupportsLivePrompts(sessionRuntimeFromMetadata(metadata)) &&
      (await hasAcceptedRunnerSessionChannel(env, session.id))
    ) {
      const delivered = await dispatchRunnerSessionCommand(env, session.id, { type: 'prompt', message: content })
      if (delivered) {
        await recordAudit(db, {
          auth,
          action: 'session.command',
          resourceType: 'session',
          resourceId: session.id,
          outcome: 'success',
          sessionId: session.id,
          metadata: { type: 'prompt', delivery: 'live' },
        })
        return { ok: true, delivery: 'live', state: 'delivered' }
      }
    }
    return await queueSelfHostedSessionPrompt(db, auth, session, content)
  }

  const submittedAt = now()
  const started = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
    auth.project.id,
    session.id,
    ['idle', 'running'],
    { state: 'running', stateReason: null, updatedAt: submittedAt },
  )
  if (!started) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }

  if (!cloudTurnsRunInline(env)) {
    await enqueueCloudTurn(env, {
      type: 'session.turn',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      prompt: content,
      auditAction: 'session.command',
    })
    return { ok: true, delivery: 'queued', state: 'accepted' }
  }

  const outcome = await executeCloudSessionTurn(env, db, auth, session, { prompt: content }, 'session.command')
  if (!outcome.ok && outcome.cancelled) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (!outcome.ok) {
    return { ok: false, status: 500, message: outcome.error.message, runtimeError: outcome.error }
  }
  return { ok: true, delivery: 'live', state: 'delivered' }
}

async function queueSelfHostedSessionPrompt(
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  content: string,
): Promise<PromptDispatchOutcome> {
  const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
  if (!agentSnapshot) {
    return { ok: false, status: 409, message: 'Session agent snapshot is required' }
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(session.environmentSnapshot),
  )
  const submittedAt = now()
  const queued = await createRuntimeOrchestrationRepo(db).updateSessionWhenState(
    auth.project.id,
    session.id,
    ['idle', 'running'],
    { state: 'pending', stateReason: 'waiting-for-runner', updatedAt: submittedAt },
  )
  if (!queued) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  await enqueueSelfHostedSessionWork(db, auth, {
    session,
    agentSnapshot,
    environmentSnapshot,
    runtime: sessionRuntimeFromMetadata(sessionMetadata),
    runtimeConfig: sessionRuntimeConfig(sessionMetadata),
    resourceRefs: parseJson<ResourceRef[]>(session.resourceRefs) ?? [],
    env: parseJson<Record<string, string>>(session.env) ?? {},
    secretEnv: parseJson<RuntimeSecretEnvEntry[]>(session.secretEnv) ?? [],
    initialPrompt: content,
    resume: true,
    resumeToken: await latestRunnerResumeToken(db, auth, session.id),
  })
  return { ok: true, delivery: 'queued', state: 'accepted' }
}

// ── Approval decision continuation ──────────────────────────────────────────

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

export type { PendingSessionApproval }
