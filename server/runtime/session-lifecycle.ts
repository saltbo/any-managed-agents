// Shim: session stop / archive / expiry now lives in
// usecases/runtime/session-lifecycle as deps-first functions over ports. These
// wrappers preserve the (env, db, ...) signatures the gateway adapter relies on,
// building the lifecycle deps subset inline and delegating. Deleted once the
// callers thread Deps directly.

import { createAuditPort } from '../adapters/gateways/audit'
import { createRunnerChannel } from '../adapters/gateways/runner-channel'
import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import { createSandboxRuntimeHost } from '../adapters/runtime/sandbox-runtime-host'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import {
  archiveSession as archiveSessionUsecase,
  markExpiredPendingSessions as markExpiredPendingSessionsUsecase,
  type StopSessionResult,
  stopSession as stopSessionUsecase,
  unarchiveSession as unarchiveSessionUsecase,
} from '../usecases/runtime'
import type { Db } from './session-base'

export type { StopSessionResult }

function lifecycleDeps(env: Env, db: Db) {
  return {
    sessionOrchestration: createRuntimeOrchestrationRepo(db),
    audit: createAuditPort(db),
    sandboxRuntime: createSandboxRuntimeHost(env),
    runnerChannel: createRunnerChannel(env),
  }
}

export async function stopSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
  reason = 'user_requested',
): Promise<StopSessionResult> {
  return stopSessionUsecase(lifecycleDeps(env, db), auth, sessionId, requestId, reason)
}

export async function archiveSession(
  env: Env,
  db: Db,
  auth: AuthScope,
  sessionId: string,
  requestId: string | null,
): Promise<StopSessionResult> {
  return archiveSessionUsecase(lifecycleDeps(env, db), auth, sessionId, requestId)
}

export async function unarchiveSession(db: Db, auth: AuthScope, sessionId: string, requestId: string | null) {
  return unarchiveSessionUsecase(
    { sessionOrchestration: createRuntimeOrchestrationRepo(db), audit: createAuditPort(db) },
    auth,
    sessionId,
    requestId,
  )
}

export async function markExpiredPendingSessions(db: Db, auth: AuthScope) {
  await markExpiredPendingSessionsUsecase({ sessionOrchestration: createRuntimeOrchestrationRepo(db) }, auth)
}
