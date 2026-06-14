// Shared leaf helpers for the session runtime clusters.
//
// Everything here is leaf: it uses the orchestration repo, audit, and the
// snapshot/event shaping helpers, but never calls a cluster function. The
// cluster modules (cloud-turn, lifecycle, create, prompt, approval) all import
// from here, so this module sits at the bottom of the runtime DAG.

import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import {
  createRuntimeOrchestrationRepo,
  type RuntimeOrchestrationRepo,
  type SessionRow,
} from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import { now } from '../domain/runtime/util'
import type { AuthScope } from '../usecases/ports'

export { newId, now, RUNTIME_START_TIMEOUT_MS, requestIdFrom, stringify, withTimeout } from '../domain/runtime/util'

export type Db = Parameters<typeof createRuntimeOrchestrationRepo>[0]

export type Repo = RuntimeOrchestrationRepo

// The orchestration repo is stateless, so one instance per db handle is safe to
// reuse across the request's cluster calls. Keyed by the db handle so it is
// garbage-collected with the request scope.
const repoCache = new WeakMap<object, Repo>()

export function withRepo(db: Db): Repo {
  const cached = repoCache.get(db)
  if (cached) {
    return cached
  }
  const repo = createRuntimeOrchestrationRepo(db)
  repoCache.set(db, repo)
  return repo
}

// Error code → http status mapping is the http layer's job; the gateway only
// reports the kind. `fields` carries field-keyed validation detail; `detail`
// carries the structured policy/conflict payload the http layer echoes. Shared
// across the create / lifecycle / approval clusters as their failure shape.
export interface SessionRuntimeError {
  status: 400 | 403 | 404 | 409 | 500
  code: string
  message: string
  fields?: Record<string, string>
  detail?: Record<string, unknown>
}

// ── Session reads ───────────────────────────────────────────────────────────

export async function findSession(db: Db, auth: AuthScope, sessionId: string) {
  return withRepo(db).findSession(auth.project.id, sessionId)
}

export async function appendRuntimeEvent(
  repo: Repo,
  values: { auth: AuthScope; sessionId: string; event: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    values.event,
    values.metadata ?? { source: 'runtime' },
  )
  return await repo.appendCanonicalEvent(
    { organizationId: values.auth.organization.id, projectId: values.auth.project.id, sessionId: values.sessionId },
    canonicalEvent,
  )
}

export async function markInitialPromptFailed(
  db: Db,
  auth: AuthScope,
  session: SessionRow,
  message: string,
  status?: number,
) {
  const failedAt = now()
  await withRepo(db).updateSessionWhenState(auth.project.id, session.id, 'running', {
    state: 'error',
    stateReason: message,
    updatedAt: failedAt,
  })
  await recordAudit(db, {
    auth,
    action: 'session.initial_prompt',
    resourceType: 'session',
    resourceId: session.id,
    outcome: 'failure',
    sessionId: session.id,
    metadata: { message, ...(status ? { status } : {}) },
  })
}

export function cloudTurnSystemAuth(message: { organizationId: string; projectId: string }): AuthScope {
  return {
    user: { id: 'system:cloud-turn' },
    organization: { id: message.organizationId, name: message.organizationId },
    project: { id: message.projectId, name: message.projectId },
    roles: ['system'],
    permissions: ['*'],
  }
}
