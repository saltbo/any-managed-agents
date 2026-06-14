// Session stop / archive / expiry lifecycle.
//
// This cluster owns runtime teardown: stopping cloud sessions (tearing down the
// sandbox runtime) and self-hosted sessions (cancelling work items, leases, and
// runner load), archiving / unarchiving, and expiring pending cloud sessions
// whose startup window elapsed. It imports session-base + the runtime leaf
// modules; it does NOT depend on the cloud turn loop.

import { createRuntimeOrchestrationRepo, type SessionRow } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import { dispatchRunnerSessionCommand } from './runner-session-command'
import { safeRuntimeError } from './runtime-error'
import {
  appendRuntimeEvent,
  type Db,
  findSession,
  now,
  RUNTIME_START_TIMEOUT_MS,
  requestIdFrom,
  type SessionRuntimeError,
  stringify,
} from './session-base'
import { stopSessionRuntime as stopCloudSessionRuntime } from './session-runtime'

export type StopSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

export async function stopSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  return await stopSessionRow(env, db, auth, session, requestId, reason)
}

async function stopSessionRow(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  if (session.state === 'stopped') {
    return { ok: true, session }
  }
  if (!session.sandboxId) {
    return await stopSelfHostedSession(env, db, auth, session, requestId, reason)
  }

  const repo = createRuntimeOrchestrationRepo(db)
  const stoppingAt = now()
  await repo.updateSession(auth.project.id, session.id, { state: 'stopped', updatedAt: stoppingAt })

  try {
    await stopCloudSessionRuntime(env, session.sandboxId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await repo.updateSession(auth.project.id, session.id, {
      state: 'error',
      stateReason: safeError.message,
      updatedAt: failedAt,
    })
    await recordAudit(db, {
      auth,
      action: 'session.stop',
      resourceType: 'session',
      resourceId: session.id,
      outcome: 'failure',
      requestId: requestIdFrom(requestId),
      sessionId: session.id,
      metadata: { runtime: safeError },
    })
    return {
      ok: false,
      error: {
        status: 409,
        code: 'conflict',
        message: 'Session runtime could not be stopped',
        detail: { runtime: safeError },
      },
    }
  }

  const stoppedAt = now()
  await repo.updateSession(auth.project.id, session.id, { state: 'stopped', stoppedAt, updatedAt: stoppedAt })
  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, sandboxId: session.sandboxId, piRuntimeId: session.piRuntimeId },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: { type: 'session_stop', reason },
    metadata: { source: 'control-plane', sandboxId: session.sandboxId },
  })
  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped session row is required')
  }
  return { ok: true, session: stopped }
}

async function stopSelfHostedSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason: string,
): Promise<StopSessionResult> {
  const repo = createRuntimeOrchestrationRepo(db)
  const stoppedAt = now()
  await dispatchRunnerSessionCommand(env, session.id, { type: 'stop', reason })
  const activeWorkItems = await repo.activeSessionWorkItems(auth.project.id, session.id)

  if (activeWorkItems.length) {
    const workItemIds = activeWorkItems.map((item) => item.id)
    const leaseIds = activeWorkItems.map((item) => item.leaseId).filter((id): id is string => Boolean(id))
    const runnerIds = [
      ...new Set(activeWorkItems.map((item) => item.runnerId).filter((id): id is string => Boolean(id))),
    ]

    await repo.cancelWorkItems(
      auth.project.id,
      workItemIds,
      stringify({ message: `Session stopped: ${reason}` }),
      stoppedAt,
    )

    if (leaseIds.length) {
      await repo.cancelLeases(auth.project.id, leaseIds, stoppedAt)
    }

    for (const runnerId of runnerIds) {
      await repo.decrementRunnerLoad(auth.project.id, runnerId, stoppedAt)
    }
  }

  await repo.updateSession(auth.project.id, session.id, {
    state: 'stopped',
    stateReason: 'runner-cancelled',
    stoppedAt,
    updatedAt: stoppedAt,
  })

  await recordAudit(db, {
    auth,
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, hostingMode: 'self_hosted', cancelledWorkItems: activeWorkItems.length },
  })
  await appendRuntimeEvent(db, {
    auth,
    sessionId: session.id,
    event: { type: 'session_stop', reason },
    metadata: { source: 'control-plane', hostingMode: 'self_hosted' },
  })

  const stopped = await findSession(db, auth, session.id)
  if (!stopped) {
    throw new Error('Stopped self-hosted session row is required')
  }
  return { ok: true, session: stopped }
}

export async function archiveSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<StopSessionResult> {
  const session = await findSession(db, auth, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  if (session.sandboxId && session.state !== 'stopped') {
    const stopped = await stopSessionRow(env, db, auth, session, requestId)
    if (!stopped.ok) {
      return stopped
    }
  }

  const archivedAt = now()
  await createRuntimeOrchestrationRepo(db).updateSession(auth.project.id, session.id, {
    archivedAt,
    updatedAt: archivedAt,
  })
  await recordAudit(db, {
    auth,
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { archivedAt },
  })
  const archived = await findSession(db, auth, session.id)
  if (!archived) {
    throw new Error('Archived session row is required')
  }
  return { ok: true, session: archived }
}

export async function unarchiveSession(
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<SessionRow> {
  const timestamp = now()
  await createRuntimeOrchestrationRepo(db).updateSession(auth.project.id, sessionId, {
    archivedAt: null,
    updatedAt: timestamp,
  })
  await recordAudit(db, {
    auth,
    action: 'session.unarchive',
    resourceType: 'session',
    resourceId: sessionId,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId,
    metadata: {},
  })
  const restored = await findSession(db, auth, sessionId)
  if (!restored) {
    throw new Error('Unarchived session row is required')
  }
  return restored
}

// Mark pending sessions whose cloud runtime startup window elapsed as errored.
export async function markExpiredPendingSessions(db: Db, auth: AuthScope) {
  const expiredBefore = new Date(Date.now() - RUNTIME_START_TIMEOUT_MS).toISOString()
  await createRuntimeOrchestrationRepo(db).markExpiredPendingSessions(auth.project.id, expiredBefore, now())
}
