import { redactSensitiveValue } from '@server/redaction'
import type { Deps } from './deps'
import type { AuthScope, ClaimedRun, DueTrigger } from './ports'
import { createSession } from './runtime/sessions'

export interface ScheduleDispatchResult {
  heartbeatAt: string
  claimed: number
  sessionCreated: number
  failed: number
  skipped: number
  runs: Array<{
    runId: string
    triggerId: string
    scheduledFor: string
    status: string
    sessionId: string | null
    errorMessage: string | null
  }>
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactSensitiveValue(message) as string
}

// The scheduler dispatches as a synthetic system actor; the audit gateway maps
// `system:scheduler` to a system actor with no user id.
function systemAuth(trigger: DueTrigger, project: { id: string; name: string }): AuthScope {
  return {
    organization: { id: trigger.organizationId, name: trigger.organizationId },
    project,
    user: { id: 'system:scheduler' },
    roles: ['system'],
    permissions: ['*'],
  }
}

async function recordDispatch(
  deps: Deps,
  auth: AuthScope,
  trigger: DueTrigger,
  run: ClaimedRun,
  outcome: { ok: true; sessionId: string } | { ok: false; message: string },
) {
  await deps.audit.record(auth, {
    action: 'scheduled_trigger.dispatch',
    resourceType: 'scheduled_trigger',
    resourceId: trigger.id,
    outcome: outcome.ok ? 'success' : 'failure',
    correlationId: run.correlationId,
    ...(outcome.ok ? { sessionId: outcome.sessionId } : {}),
    metadata: outcome.ok
      ? { runId: run.id, scheduledFor: run.scheduledFor, sessionId: outcome.sessionId }
      : { runId: run.id, scheduledFor: run.scheduledFor, message: outcome.message },
  })
}

async function failRun(deps: Deps, auth: AuthScope, trigger: DueTrigger, run: ClaimedRun, message: string) {
  await deps.triggerDispatch.markRunFailed(trigger, run, message)
  await recordDispatch(deps, auth, trigger, run, { ok: false, message })
}

async function dispatchTrigger(deps: Deps, trigger: DueTrigger, heartbeatAt: string) {
  const run = await deps.triggerDispatch.claimRun(trigger, heartbeatAt)
  if (!run) {
    return { skipped: true as const }
  }

  // The fallback project (id used as name) covers a missing project row; the
  // resolved name overrides it when the project is still present.
  let auth = systemAuth(trigger, { id: trigger.projectId, name: trigger.projectId })
  try {
    const projectName = await deps.triggerDispatch.projectName(trigger.projectId)
    if (!projectName) {
      throw new Error('Scheduled trigger project is unavailable')
    }
    auth = systemAuth(trigger, { id: trigger.projectId, name: projectName })

    const sessionMetadata = {
      ...trigger.metadata,
      source: 'scheduled-agent-trigger',
      scheduledTriggerId: trigger.id,
      scheduledRunId: run.id,
      scheduledFor: run.scheduledFor,
      correlationId: run.correlationId,
    }
    // The trigger's execution spec uses the v1 secret env shape; the scheduler
    // path dispatches the session with empty runtime env (resource/prompt/
    // runtime carry through while env is left to the agent/provider defaults).
    const result = await createSession(deps, auth, {
      agentId: trigger.agentId,
      // Null when the trigger is unpinned; createSession resolves an environment
      // for the runtime at dispatch time.
      environmentId: trigger.environmentId,
      options: {
        title: trigger.name,
        metadata: sessionMetadata,
        resourceRefs: trigger.resourceRefs,
        runtime: trigger.runtime,
        initialPrompt: trigger.promptTemplate,
      },
      requestId: run.correlationId,
    })

    if (!result.ok) {
      const message = result.error.message
      await failRun(deps, auth, trigger, run, message)
      return {
        runId: run.id,
        triggerId: trigger.id,
        scheduledFor: run.scheduledFor,
        status: 'failed',
        sessionId: null,
        errorMessage: message,
      }
    }

    const session = result.value
    await deps.triggerDispatch.markRunSessionCreated(trigger, run, session.id, sessionMetadata)
    await recordDispatch(deps, auth, trigger, run, { ok: true, sessionId: session.id })
    return {
      runId: run.id,
      triggerId: trigger.id,
      scheduledFor: run.scheduledFor,
      status: 'session_created',
      sessionId: session.id,
      errorMessage: null,
    }
  } catch (error) {
    const message = safeMessage(error)
    await failRun(deps, auth, trigger, run, message)
    return {
      runId: run.id,
      triggerId: trigger.id,
      scheduledFor: run.scheduledFor,
      status: 'failed',
      sessionId: null,
      errorMessage: message,
    }
  }
}

// Background dispatch orchestration: claims due trigger runs idempotently,
// creates a session per claimed run via the runtime gateway, and records the
// dispatch outcome to the audit log. Called from the worker scheduled entry and
// the e2e dispatch fixture with deps built by createDeps(env).
export async function dispatchDueScheduledTriggers(
  deps: Deps,
  options: { heartbeatAt?: string; projectId?: string; limit?: number } = {},
): Promise<ScheduleDispatchResult> {
  const heartbeatAt = options.heartbeatAt ?? new Date().toISOString()
  const dueTriggers = await deps.triggerDispatch.dueTriggers({
    heartbeatAt,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    limit: options.limit ?? 50,
  })

  const result: ScheduleDispatchResult = {
    heartbeatAt,
    claimed: 0,
    sessionCreated: 0,
    failed: 0,
    skipped: 0,
    runs: [],
  }

  for (const trigger of dueTriggers) {
    try {
      const run = await dispatchTrigger(deps, trigger, heartbeatAt)
      if ('skipped' in run) {
        result.skipped += 1
        continue
      }
      result.claimed += 1
      if (run.status === 'session_created') {
        result.sessionCreated += 1
      } else {
        result.failed += 1
      }
      result.runs.push(run)
    } catch (error) {
      result.failed += 1
      result.runs.push({
        runId: '',
        triggerId: trigger.id,
        scheduledFor: trigger.nextDueAt,
        status: 'failed',
        sessionId: null,
        errorMessage: safeMessage(error),
      })
    }
  }

  return result
}
