// Session stop / archive / expiry lifecycle — deps-first.
//
// This cluster owns runtime teardown: stopping cloud sessions (tearing down the
// sandbox runtime) and self-hosted sessions (cancelling work items, leases, and
// runner load), archiving / unarchiving, and expiring pending cloud sessions
// whose startup window elapsed.
//
// Deps-first: the store, audit, cloud runtime lifecycle, runtime workspace
// reader, and runner channel arrive as ports on `deps`; runtime events go
// through the events usecase. The module is infra-free.

import { memoryStoreIdFromRef } from '@server/domain/memory-store'
import {
  isMemoryVolume,
  type MemoryVolume,
  type Volume,
  type VolumeMount,
} from '@server/domain/runtime/execution-inputs'
import { now, RUNTIME_START_TIMEOUT_MS, requestIdFrom, stringify } from '@server/domain/runtime/util'
import { safeRuntimeError } from '@server/runtime-error'
import type {
  AuditPort,
  AuthScope,
  CloudRuntimeLifecycle,
  EventStore,
  RunnerChannel,
  RuntimeWorkspaceReader,
  SessionOrchestrationStore,
  SessionRow,
} from '../ports'

type LifecycleDeps = {
  sessionOrchestration: SessionOrchestrationStore
  sessionEventStore: EventStore
  audit: AuditPort
  cloudRuntime: CloudRuntimeLifecycle
  runtimeWorkspace: RuntimeWorkspaceReader
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
  if (sessionSandboxBackend(session) === 'runner-sandbox' || !session.sandboxId) {
    return await stopSelfHostedSession(deps, auth, session, requestId, reason)
  }

  const store = deps.sessionOrchestration
  const stoppingAt = now()
  await store.updateSession(auth.project.id, session.id, { state: 'stopped', updatedAt: stoppingAt })

  try {
    await syncWritableMemoryStores(deps, auth, session)
    await deps.cloudRuntime.stopCloudSession(session.sandboxId)
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
  await archiveTerminalSession(deps, auth, session.id)
  const stopped = await store.findSession(auth.project.id, session.id)
  if (!stopped) {
    throw new Error('Stopped session row is required')
  }
  return { ok: true, session: stopped }
}

async function syncWritableMemoryStores(deps: LifecycleDeps, auth: AuthScope, session: SessionRow) {
  if (!session.sandboxId) {
    return
  }
  const volumes = JSON.parse(session.volumes) as Volume[]
  const volumeMounts = JSON.parse(session.volumeMounts) as VolumeMount[]
  const writableVolumes = volumes.filter(
    (volume): volume is MemoryVolume => isMemoryVolume(volume) && volume.access === 'read_write',
  )
  if (writableVolumes.length === 0) {
    return
  }
  const snapshots = await deps.runtimeWorkspace.readMemoryStoreMemories({
    sessionId: session.id,
    sandboxId: session.sandboxId,
    volumes: writableVolumes,
    volumeMounts,
  })
  const updatedAt = now()
  for (const snapshot of snapshots) {
    const storeId = memoryStoreIdFromRef(snapshot.memoryRef)
    if (!storeId) {
      continue
    }
    await deps.sessionOrchestration.replaceMemoryStoreMemories(auth.project.id, storeId, snapshot.memories, updatedAt)
  }
}

function sessionSandboxBackend(session: SessionRow): string | null {
  const metadata = session.metadata ? (JSON.parse(session.metadata) as Record<string, unknown>) : {}
  return typeof metadata.sandboxBackend === 'string' ? metadata.sandboxBackend : null
}

// On terminal stop, snapshot a cloud (ama) session's Session DO event log to its
// R2 archive object. Best-effort: the DO keeps the hot rows, so a transient R2
// failure must not strand the stop. No-op for D1-backed sessions (the router
// only archives DO-stored ones).
async function archiveTerminalSession(deps: LifecycleDeps, auth: AuthScope, sessionId: string) {
  try {
    await deps.sessionEventStore.archive({
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      sessionId,
    })
  } catch (error) {
    console.error(`session ${sessionId} event archive failed:`, error)
  }
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
  if (sessionSandboxBackend(session) === 'runner-sandbox') {
    await deps.runnerChannel.stopSandbox(session.id).catch(() => undefined)
  } else {
    await deps.runnerChannel.dispatch(session.id, { type: 'abort', reason })
  }
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
  await archiveTerminalSession(deps, auth, session.id)

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
  if ((session.sandboxId || sessionSandboxBackend(session) === 'runner-sandbox') && session.state !== 'stopped') {
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
