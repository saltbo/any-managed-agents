// Prompt dispatch.
//
// This cluster owns delivering a user prompt to a live session: the cloud path
// (live inline turn or queued cloud turn) and the self-hosted path (live runner
// channel command or queued runner work item). It imports session-base +
// cloud-turn (for the inline turn) + session-create (for the self-hosted work
// enqueue / resume token) + the runtime leaf modules.

import { runtimeSupportsLivePrompts } from '@server/domain/runtime-catalog'
import { createRuntimeOrchestrationRepo, type SessionRow } from '../adapters/repos/runtime-orchestration'
import { recordAudit } from '../audit'
import { sessionRuntimeConfig, sessionRuntimeFromMetadata } from '../domain/runtime-session'
import type { Env } from '../env'
import type { AuthScope } from '../usecases/ports'
import { executeCloudSessionTurn } from './cloud-turn'
import { dispatchRunnerSessionCommand, hasAcceptedRunnerSessionChannel } from './runner-session-command'
import type { safeRuntimeError } from './runtime-error'
import type { RuntimeSecretEnvEntry } from './secret-env'
import { type Db, findSession, now } from './session-base'
import { enqueueSelfHostedSessionWork, latestRunnerResumeToken } from './session-create'
import {
  normalizeEnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
  type ResourceRef,
  type serializeEnvironmentVersion,
} from './session-snapshot'
import { cloudTurnsRunInline, enqueueCloudTurn } from './turn-queue'

type MessageDelivery = 'live' | 'queued'
type MessageState = 'accepted' | 'delivered' | 'failed'

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
