import type {
  AuthScope,
  PromptDispatchResult,
  SessionApprovalRecord,
  SessionRecord,
  SessionRepo,
  SessionRuntimeError,
  SessionRuntimeGateway,
  SessionRuntimeOutcome,
} from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import type { AuthContext } from '../../auth/session'
import type { Env } from '../../env'
import {
  archiveSession as archiveSessionRuntime,
  type CreateSessionOptions,
  createSessionForAgent,
  decideSessionApproval,
  dispatchSessionPrompt,
  markExpiredPendingSessions,
  type SessionRuntimeError as RuntimeError,
  stopSession as stopSessionRuntime,
  unarchiveSession as unarchiveSessionRuntime,
} from '../../runtime/session-orchestration'

type Db = ReturnType<typeof drizzle>

function asAuthContext(auth: AuthScope): AuthContext {
  return auth as unknown as AuthContext
}

function mapError(error: RuntimeError): SessionRuntimeError {
  return error
}

// Wraps the env-bound session runtime execution layer. After a mutating runtime
// op it re-reads the session through the repo so the DTO crossing the boundary
// is the one canonical serialization (the repo strips internal columns).
export function createSessionRuntimeGateway(env: Env, db: Db, repo: SessionRepo): SessionRuntimeGateway {
  async function reread(projectId: string, sessionId: string): Promise<SessionRecord> {
    const record = await repo.find(projectId, sessionId)
    if (!record) {
      throw new Error('Session row is required after a runtime operation')
    }
    return record
  }

  return {
    async createSession(auth, input): Promise<SessionRuntimeOutcome<SessionRecord>> {
      const result = await createSessionForAgent(
        env,
        db,
        asAuthContext(auth),
        input.agentId,
        input.environmentId,
        input.options as CreateSessionOptions,
        input.requestId,
      )
      if (!result.ok) {
        return { ok: false, error: mapError(result.error) }
      }
      return { ok: true, value: await reread(auth.project.id, result.session.id) }
    },

    async stopSession(auth, session, requestId, reason) {
      const result = await stopSessionRuntime(env, db, asAuthContext(auth), session.id, requestId, reason)
      if (!result.ok) {
        return { ok: false, error: mapError(result.error) }
      }
      return { ok: true, value: await reread(auth.project.id, session.id) }
    },

    async archiveSession(auth, session, requestId) {
      const result = await archiveSessionRuntime(env, db, asAuthContext(auth), session.id, requestId)
      if (!result.ok) {
        return { ok: false, error: mapError(result.error) }
      }
      return { ok: true, value: await reread(auth.project.id, session.id) }
    },

    async unarchiveSession(auth, session, requestId): Promise<SessionRecord> {
      await unarchiveSessionRuntime(db, asAuthContext(auth), session.id, requestId)
      return await reread(auth.project.id, session.id)
    },

    async dispatchPrompt(auth, session, content): Promise<PromptDispatchResult> {
      const outcome = await dispatchSessionPrompt(env, db, asAuthContext(auth), session.id, content)
      if (!outcome.ok) {
        return {
          ok: false,
          status: outcome.status,
          message: outcome.message,
          ...(outcome.runtimeError ? { runtimeError: outcome.runtimeError as unknown as Record<string, unknown> } : {}),
        }
      }
      return { ok: true, delivery: outcome.delivery, state: outcome.state }
    },

    async decideApproval(auth, session, approvalId, body): Promise<SessionRuntimeOutcome<SessionApprovalRecord>> {
      const result = await decideSessionApproval(env, db, asAuthContext(auth), session.id, approvalId, body)
      if (!result.ok) {
        return { ok: false, error: mapError(result.error) }
      }
      // The decided approval row carries JSON columns; surface the same record
      // shape the repo produces for read endpoints.
      const approval = await repo.findApproval(auth.project.id, session.id, approvalId)
      if (!approval) {
        throw new Error('Decided approval row is required')
      }
      return { ok: true, value: approval }
    },

    async markExpiredPending(auth): Promise<void> {
      await markExpiredPendingSessions(db, asAuthContext(auth))
    },
  }
}
