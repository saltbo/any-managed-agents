// Session runtime usecases — deps-first.
//
// These thin wrappers run a mutating runtime orchestration op (create / stop /
// archive / unarchive / prompt / approval) and then re-read the affected row
// through the REST SessionRepo (deps.sessions) so the DTO crossing the boundary
// is the one canonical serialization the read endpoints produce. The callers
// (http/sessions, dispatch-triggers, usecases/sessions) invoke these directly;
// the result shapes (SessionRuntimeOutcome / PromptDispatchResult) are reused
// from ports. Logic is verbatim from the former SessionRuntimeGateway adapter;
// only how the runtime deps are acquired changed (the global Deps instead of an
// env/db-bound gateway).

import type { Deps } from '../deps'
import type {
  AuthScope,
  PromptDispatchResult,
  SessionApprovalRecord,
  SessionCreateOptions,
  SessionRecord,
  SessionRuntimeError,
  SessionRuntimeOutcome,
  SessionRuntimeRow,
} from '../ports'
import { decideSessionApproval } from './session-approval'
import { type CreateSessionOptions, createSessionForAgent } from './session-create'
import {
  archiveSession as archiveSessionRuntime,
  markExpiredPendingSessions,
  stopSession as stopSessionRuntime,
  unarchiveSession as unarchiveSessionRuntime,
} from './session-lifecycle'
import { dispatchSessionPrompt } from './session-prompt'

function mapError(error: SessionRuntimeError): SessionRuntimeError {
  return error
}

// Re-reads the session through the repo so the DTO crossing the boundary is the
// one canonical serialization (the repo strips internal columns).
async function reread(deps: Deps, projectId: string, sessionId: string): Promise<SessionRecord> {
  const record = await deps.sessions.find(projectId, sessionId)
  if (!record) {
    throw new Error('Session row is required after a runtime operation')
  }
  return record
}

export async function createSession(
  deps: Deps,
  auth: AuthScope,
  input: {
    agentId: string
    environmentId: string
    options: SessionCreateOptions
    requestId: string | null
  },
): Promise<SessionRuntimeOutcome<SessionRecord>> {
  const result = await createSessionForAgent(
    deps,
    auth,
    input.agentId,
    input.environmentId,
    input.options as CreateSessionOptions,
    input.requestId,
  )
  if (!result.ok) {
    return { ok: false, error: mapError(result.error) }
  }
  return { ok: true, value: await reread(deps, auth.project.id, result.session.id) }
}

export async function stopSession(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  requestId: string | null,
  reason?: string,
): Promise<SessionRuntimeOutcome<SessionRecord>> {
  const result = await stopSessionRuntime(deps, auth, session.id, requestId, reason)
  if (!result.ok) {
    return { ok: false, error: mapError(result.error) }
  }
  return { ok: true, value: await reread(deps, auth.project.id, session.id) }
}

export async function archiveSession(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  requestId: string | null,
): Promise<SessionRuntimeOutcome<SessionRecord>> {
  const result = await archiveSessionRuntime(deps, auth, session.id, requestId)
  if (!result.ok) {
    return { ok: false, error: mapError(result.error) }
  }
  return { ok: true, value: await reread(deps, auth.project.id, session.id) }
}

export async function unarchiveSession(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  requestId: string | null,
): Promise<SessionRecord> {
  await unarchiveSessionRuntime(deps, auth, session.id, requestId)
  return await reread(deps, auth.project.id, session.id)
}

export async function dispatchPrompt(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  content: string,
): Promise<PromptDispatchResult> {
  const outcome = await dispatchSessionPrompt(deps, auth, session.id, content)
  if (!outcome.ok) {
    return {
      ok: false,
      status: outcome.status,
      message: outcome.message,
      ...(outcome.runtimeError ? { runtimeError: { ...outcome.runtimeError } } : {}),
    }
  }
  return { ok: true, delivery: outcome.delivery, state: outcome.state }
}

export async function decideApproval(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  approvalId: string,
  body: { decision: 'approve' | 'deny'; reason?: string; result?: Record<string, unknown> },
): Promise<SessionRuntimeOutcome<SessionApprovalRecord>> {
  const result = await decideSessionApproval(deps, auth, session.id, approvalId, body)
  if (!result.ok) {
    return { ok: false, error: mapError(result.error) }
  }
  // The decided approval row carries JSON columns; surface the same record
  // shape the repo produces for read endpoints.
  const approval = await deps.sessions.findApproval(auth.project.id, session.id, approvalId)
  if (!approval) {
    throw new Error('Decided approval row is required')
  }
  return { ok: true, value: approval }
}

export async function markExpiredPending(deps: Deps, auth: AuthScope): Promise<void> {
  await markExpiredPendingSessions(deps, auth)
}
