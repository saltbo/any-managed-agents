import { hasSecretMaterial, mergeMetadataUpdate } from '@server/domain/session'
import type { Deps } from './deps'
import {
  type AuthScope,
  type PromptDispatchResult,
  type SessionMessageRecord,
  type SessionRecord,
  type SessionRuntimeError,
  type SessionRuntimeRow,
  SessionValidationError,
} from './ports'
import { archiveSession, dispatchPrompt, stopSession, unarchiveSession } from './runtime/sessions'

export type SessionWriteOutcome<T> = { ok: true; value: T } | { ok: false; error: SessionRuntimeError }

export interface UpdateSessionPatch {
  title?: string | null
  metadata?: Record<string, unknown>
  state?: 'stopped'
  archived?: boolean
}

// Orchestrates the session PATCH decision tree: archived sessions only accept
// an unarchive; otherwise apply title/metadata edits, then the stop transition,
// then archiving — in that order, since a stop+archive request must stop the
// live runtime before lifecycle archiving.
export async function updateSession(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  patch: UpdateSessionPatch,
  requestId: string | null,
): Promise<SessionWriteOutcome<SessionRecord>> {
  if (session.archivedAt) {
    if (
      patch.archived === false &&
      patch.title === undefined &&
      patch.metadata === undefined &&
      patch.state === undefined
    ) {
      const restored = await unarchiveSession(deps, auth, session, requestId)
      return { ok: true, value: restored }
    }
    return { ok: false, error: { status: 409, code: 'conflict', message: 'Archived sessions cannot be updated' } }
  }

  let current = session
  if (patch.title !== undefined || patch.metadata !== undefined) {
    if (hasSecretMaterial(patch.metadata)) {
      throw new SessionValidationError('Invalid session metadata', {
        metadata: 'Secret material must be stored in vault references.',
      })
    }
    const timestamp = new Date().toISOString()
    const metadata = patch.metadata !== undefined ? mergeMetadataUpdate(current.metadata, patch.metadata) : undefined
    const updated = await deps.sessions.updateFields(
      auth.project.id,
      session.id,
      {
        ...(patch.title !== undefined && patch.title !== null ? { title: patch.title } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
      timestamp,
    )
    if (!updated) {
      throw new Error('Updated session row is required')
    }
    const reread = await deps.sessions.findRuntimeRow(auth.project.id, session.id)
    if (!reread) {
      throw new Error('Updated session row is required')
    }
    current = reread
  }

  if (patch.state === 'stopped') {
    const stopped = await stopSession(deps, auth, current, requestId)
    if (!stopped.ok || patch.archived !== true) {
      return stopped
    }
    const reread = await deps.sessions.findRuntimeRow(auth.project.id, session.id)
    if (!reread) {
      throw new Error('Stopped session row is required')
    }
    current = reread
  }

  if (patch.archived === true) {
    return await archiveSession(deps, auth, current, requestId)
  }

  const record = await deps.sessions.find(auth.project.id, session.id)
  if (!record) {
    throw new Error('Updated session row is required')
  }
  return { ok: true, value: record }
}

export type SendMessageOutcome =
  | { ok: true; message: SessionMessageRecord }
  | { ok: false; status: 409 | 500; message: string; runtimeError?: Record<string, unknown> }

// Sends a prompt to a live session: the runtime prompt usecase dispatches it
// (live to a runner channel, an inline cloud turn, or the cloud/self-hosted
// queue) and a message record is persisted with the resulting delivery/state.
// An archived session cannot accept messages.
export async function sendSessionMessage(
  deps: Deps,
  auth: AuthScope,
  session: SessionRuntimeRow,
  content: string,
): Promise<SendMessageOutcome | { ok: false; status: 409; message: string; archived: true }> {
  if (session.archivedAt) {
    return { ok: false, status: 409, message: 'Archived sessions cannot accept messages', archived: true }
  }
  const dispatch: PromptDispatchResult = await dispatchPrompt(deps, auth, session, content)
  if (!dispatch.ok) {
    return {
      ok: false,
      status: dispatch.status,
      message: dispatch.message,
      ...(dispatch.runtimeError ? { runtimeError: dispatch.runtimeError } : {}),
    }
  }
  const message = await deps.sessions.insertMessage({
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    sessionId: session.id,
    content,
    delivery: dispatch.delivery,
    state: dispatch.state,
    createdAt: new Date().toISOString(),
  })
  return { ok: true, message }
}
