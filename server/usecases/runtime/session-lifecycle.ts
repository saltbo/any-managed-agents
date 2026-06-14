// Session stop / archive / expiry lifecycle — deps-first.
//
// This cluster owns runtime teardown: stopping cloud sessions (tearing down the
// sandbox runtime) and self-hosted sessions (cancelling work items, leases, and
// runner load), archiving / unarchiving, and expiring pending cloud sessions
// whose startup window elapsed.
//
// Deps-first: the store, audit, sandbox runtime host, and runner channel arrive
// as ports on `deps`; canonical events go through the events usecase. The module
// is infra-free. Logic is verbatim from the former server/runtime/session-lifecycle
// module; only dependency acquisition changed.

import { now, RUNTIME_START_TIMEOUT_MS, requestIdFrom, stringify } from '@server/domain/runtime/util'
import { safeRuntimeError } from '@server/runtime-error'
import type {
  AuditPort,
  AuthScope,
  RunnerChannel,
  SandboxRuntimeHost,
  SessionOrchestrationStore,
  SessionRow,
} from '../ports'
import { appendRuntimeEvent } from './events'

type LifecycleDeps = {
  sessionOrchestration: SessionOrchestrationStore
  audit: AuditPort
  sandboxRuntime: SandboxRuntimeHost
  runnerChannel: RunnerChannel
}

type SessionRuntimeError = {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

export type StopSessionResult = { ok: true; session: SessionRow } | { ok: false; error: SessionRuntimeError }

export async function stopSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  const session = await deps.sessionOrchestration.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  return await stopSessionRow(deps, auth, session, requestId, reason)
}

async function stopSessionRow(
  deps: LifecycleDeps,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  if (session.state === 'stopped') {
    return { ok: true, session }
  }
  if (!session.sandboxId) {
    return await stopSelfHostedSession(deps, auth, session, requestId, reason)
  }

  const store = deps.sessionOrchestration
  const stoppingAt = now()
  await store.updateSession(auth.project.id, session.id, { state: 'stopped', updatedAt: stoppingAt })

  try {
    await deps.sandboxRuntime.stopCloudSession(session.sandboxId)
  } catch (error) {
    const safeError = safeRuntimeError(error)
    const failedAt = now()
    await store.updateSession(auth.project.id, session.id, {
      state: 'error',
      stateReason: safeError.message,
      updatedAt: failedAt,
    })
    await deps.audit.record(auth, {
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
  await store.updateSession(auth.project.id, session.id, { state: 'stopped', stoppedAt, updatedAt: stoppedAt })
  await deps.audit.record(auth, {
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, sandboxId: session.sandboxId, piRuntimeId: session.piRuntimeId },
  })
  await appendRuntimeEvent(deps, {
    auth,
    sessionId: session.id,
    event: { type: 'session_stop', reason },
    metadata: { source: 'control-plane', sandboxId: session.sandboxId },
  })
  const stopped = await store.findSession(auth.project.id, session.id)
  if (!stopped) {
    throw new Error('Stopped session row is required')
  }
  return { ok: true, session: stopped }
}

async function stopSelfHostedSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  session: SessionRow,
  requestId: string | null,
  reason: string,
): Promise<StopSessionResult> {
  const store = deps.sessionOrchestration
  const stoppedAt = now()
  await deps.runnerChannel.dispatch(session.id, { type: 'stop', reason })
  const activeWorkItems = await store.activeSessionWorkItems(auth.project.id, session.id)

  if (activeWorkItems.length) {
    const workItemIds = activeWorkItems.map((item) => item.id)
    const leaseIds = activeWorkItems.map((item) => item.leaseId).filter((id): id is string => Boolean(id))
    const runnerIds = [
      ...new Set(activeWorkItems.map((item) => item.runnerId).filter((id): id is string => Boolean(id))),
    ]

    await store.cancelWorkItems(
      auth.project.id,
      workItemIds,
      stringify({ message: `Session stopped: ${reason}` }),
      stoppedAt,
    )

    if (leaseIds.length) {
      await store.cancelLeases(auth.project.id, leaseIds, stoppedAt)
    }

    for (const runnerId of runnerIds) {
      await store.decrementRunnerLoad(auth.project.id, runnerId, stoppedAt)
    }
  }

  await store.updateSession(auth.project.id, session.id, {
    state: 'stopped',
    stateReason: 'runner-cancelled',
    stoppedAt,
    updatedAt: stoppedAt,
  })

  await deps.audit.record(auth, {
    action: 'session.stop',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { reason, hostingMode: 'self_hosted', cancelledWorkItems: activeWorkItems.length },
  })
  await appendRuntimeEvent(deps, {
    auth,
    sessionId: session.id,
    event: { type: 'session_stop', reason },
    metadata: { source: 'control-plane', hostingMode: 'self_hosted' },
  })

  const stopped = await store.findSession(auth.project.id, session.id)
  if (!stopped) {
    throw new Error('Stopped self-hosted session row is required')
  }
  return { ok: true, session: stopped }
}

export async function archiveSession(
  deps: LifecycleDeps,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<StopSessionResult> {
  const store = deps.sessionOrchestration
  const session = await store.findSession(auth.project.id, sessionId)
  if (!session) {
    return { ok: false, error: { status: 404, code: 'not_found', message: 'Session not found' } }
  }
  if (session.sandboxId && session.state !== 'stopped') {
    const stopped = await stopSessionRow(deps, auth, session, requestId)
    if (!stopped.ok) {
      return stopped
    }
  }

  const archivedAt = now()
  await store.updateSession(auth.project.id, session.id, {
    archivedAt,
    updatedAt: archivedAt,
  })
  await deps.audit.record(auth, {
    action: 'session.archive',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId: session.id,
    metadata: { archivedAt },
  })
  const archived = await store.findSession(auth.project.id, session.id)
  if (!archived) {
    throw new Error('Archived session row is required')
  }
  return { ok: true, session: archived }
}

export async function unarchiveSession(
  deps: Pick<LifecycleDeps, 'sessionOrchestration' | 'audit'>,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<SessionRow> {
  const store = deps.sessionOrchestration
  const timestamp = now()
  await store.updateSession(auth.project.id, sessionId, {
    archivedAt: null,
    updatedAt: timestamp,
  })
  await deps.audit.record(auth, {
    action: 'session.unarchive',
    resourceType: 'session',
    resourceId: sessionId,
    outcome: 'success',
    requestId: requestIdFrom(requestId),
    sessionId,
    metadata: {},
  })
  const restored = await store.findSession(auth.project.id, sessionId)
  if (!restored) {
    throw new Error('Unarchived session row is required')
  }
  return restored
}

// Mark pending sessions whose cloud runtime startup window elapsed as errored.
export async function markExpiredPendingSessions(deps: Pick<LifecycleDeps, 'sessionOrchestration'>, auth: AuthScope) {
  const expiredBefore = new Date(Date.now() - RUNTIME_START_TIMEOUT_MS).toISOString()
  await deps.sessionOrchestration.markExpiredPendingSessions(auth.project.id, expiredBefore, now())
}
