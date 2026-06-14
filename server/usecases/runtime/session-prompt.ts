// Prompt dispatch — deps-first.
//
// This cluster owns delivering a user prompt to a live session: the cloud path
// (live inline turn or queued cloud turn) and the self-hosted path (live runner
// channel command or queued runner work item).
//
// Deps-first: the store, audit, runner channel, and cloud-turn queue arrive as
// ports on `deps`; the inline cloud turn and the self-hosted work enqueue /
// resume token run through sibling usecases. The module is infra-free. Logic is
// verbatim from the former server/runtime/session-prompt module; only dependency
// acquisition changed.

import {
  normalizeEnvironmentSnapshot,
  parseAgentSnapshot,
  parseJson,
  type ResourceRef,
  type serializeEnvironmentVersion,
} from '@server/domain/runtime/session-snapshot'
import { now } from '@server/domain/runtime/util'
import { runtimeSupportsLivePrompts } from '@server/domain/runtime-catalog'
import { sessionRuntimeConfig, sessionRuntimeFromMetadata } from '@server/domain/runtime-session'
import type { safeRuntimeError } from '@server/runtime-error'
import type { AuthScope, CloudTurnSecretEnvEntry, RunnerChannel, SessionRow } from '../ports'
import type { CloudTurnDeps } from './cloud-turn'
import { executeCloudSessionTurn } from './cloud-turn'
import { enqueueSelfHostedSessionWork, latestRunnerResumeToken } from './session-create'

type MessageDelivery = 'live' | 'queued'
type MessageState = 'accepted' | 'delivered' | 'failed'

// The cloud inline path delegates to the cloud-turn usecase, so prompt dispatch
// needs the full CloudTurnDeps plus the runner channel for the self-hosted path.
export type PromptDeps = CloudTurnDeps & { runnerChannel: RunnerChannel }

export type PromptDispatchOutcome =
  | { ok: false; status: 409 | 500; message: string; runtimeError?: ReturnType<typeof safeRuntimeError> }
  | { ok: true; delivery: MessageDelivery; state: MessageState }

export async function dispatchSessionPrompt(
  deps: PromptDeps,
  auth: AuthScope,
  sessionId: string,
  content: string,
): Promise<PromptDispatchOutcome> {
  const store = deps.sessionOrchestration
  const session = await store.findSession(auth.project.id, sessionId)
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
      (await deps.runnerChannel.isAccepted(session.id))
    ) {
      const delivered = await deps.runnerChannel.dispatch(session.id, { type: 'prompt', message: content })
      if (delivered) {
        await deps.audit.record(auth, {
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
    return await queueSelfHostedSessionPrompt(deps, auth, session, content)
  }

  const submittedAt = now()
  const started = await store.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'running',
    stateReason: null,
    updatedAt: submittedAt,
  })
  if (!started) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }

  if (!deps.cloudTurnQueue.runsInline()) {
    await deps.cloudTurnQueue.enqueue({
      type: 'session.turn',
      sessionId: session.id,
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      prompt: content,
      auditAction: 'session.command',
    })
    return { ok: true, delivery: 'queued', state: 'accepted' }
  }

  const outcome = await executeCloudSessionTurn(deps, auth, session, { prompt: content }, 'session.command')
  if (!outcome.ok && outcome.cancelled) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  if (!outcome.ok) {
    return { ok: false, status: 500, message: outcome.error.message, runtimeError: outcome.error }
  }
  return { ok: true, delivery: 'live', state: 'delivered' }
}

async function queueSelfHostedSessionPrompt(
  deps: Pick<PromptDeps, 'sessionOrchestration'>,
  auth: AuthScope,
  session: SessionRow,
  content: string,
): Promise<PromptDispatchOutcome> {
  const store = deps.sessionOrchestration
  const agentSnapshot = parseAgentSnapshot(session.agentSnapshot)
  if (!agentSnapshot) {
    return { ok: false, status: 409, message: 'Session agent snapshot is required' }
  }
  const environmentSnapshot = normalizeEnvironmentSnapshot(
    parseJson<ReturnType<typeof serializeEnvironmentVersion>>(session.environmentSnapshot),
  )
  const submittedAt = now()
  const queued = await store.updateSessionWhenState(auth.project.id, session.id, ['idle', 'running'], {
    state: 'pending',
    stateReason: 'waiting-for-runner',
    updatedAt: submittedAt,
  })
  if (!queued) {
    return { ok: false, status: 409, message: 'Session runtime is no longer active' }
  }
  const sessionMetadata = parseJson<Record<string, unknown>>(session.metadata) ?? {}
  await enqueueSelfHostedSessionWork(deps, auth, {
    session,
    agentSnapshot,
    environmentSnapshot,
    runtime: sessionRuntimeFromMetadata(sessionMetadata),
    runtimeConfig: sessionRuntimeConfig(sessionMetadata),
    resourceRefs: parseJson<ResourceRef[]>(session.resourceRefs) ?? [],
    env: parseJson<Record<string, string>>(session.env) ?? {},
    secretEnv: parseJson<CloudTurnSecretEnvEntry[]>(session.secretEnv) ?? [],
    initialPrompt: content,
    resume: true,
    resumeToken: await latestRunnerResumeToken(deps, auth, session.id),
  })
  return { ok: true, delivery: 'queued', state: 'accepted' }
}
