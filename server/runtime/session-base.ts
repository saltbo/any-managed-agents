// Shared leaf helpers for the session runtime clusters.
//
// Everything here is leaf: it uses the orchestration repo, audit, and the
// snapshot/event shaping helpers, but never calls a cluster function. The
// cluster modules (cloud-turn, lifecycle, create, prompt, approval) all import
// from here, so this module sits at the bottom of the runtime DAG.

import { canonicalAmaSessionEventFromRuntimeEvent } from '../../shared/session-events'
import { createRuntimeOrchestrationRepo, type SessionRow } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import type { AuthScope } from '../usecases/ports'
import type { CloudTurnMessage } from './turn-queue'

export type Db = Parameters<typeof createRuntimeOrchestrationRepo>[0]

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function now() {
  return new Date().toISOString()
}

export function stringify(value: unknown) {
  return JSON.stringify(value)
}

export function requestIdFrom(requestId: string | null | undefined) {
  return requestId ?? null
}

// ── Session reads ───────────────────────────────────────────────────────────

export async function findSession(db: Db, auth: AuthScope, sessionId: string) {
  return createRuntimeOrchestrationRepo(db).findSession(auth.project.id, sessionId)
}

export async function appendRuntimeEvent(
  db: Db,
  values: { auth: AuthScope; sessionId: string; event: Record<string, unknown>; metadata?: Record<string, unknown> },
) {
  const canonicalEvent = canonicalAmaSessionEventFromRuntimeEvent(
    values.event,
    values.metadata ?? { source: 'runtime' },
  )
  return await createRuntimeOrchestrationRepo(db).appendCanonicalEvent(
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
  await createRuntimeOrchestrationRepo(db).updateSessionWhenState(auth.project.id, session.id, 'running', {
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

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export function cloudTurnSystemAuth(message: CloudTurnMessage): AuthScope {
  return {
    user: { id: 'system:cloud-turn' },
    organization: { id: message.organizationId, name: message.organizationId },
    project: { id: message.projectId, name: message.projectId },
    roles: ['system'],
    permissions: ['*'],
  }
}
