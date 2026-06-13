import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit } from '../audit'
import type { AuthContext } from '../auth/session'
import { projects, triggerRuns, triggers } from '../db/schema'
import type { Env } from '../env'
import { RuntimeSchema } from '../routes/environment-contracts'
import { safeRuntimeError } from '../runtime/runtime-error'
import { createSessionForAgent } from '../runtime/session-orchestration'

type Db = ReturnType<typeof drizzle>
type TriggerRow = typeof triggers.$inferSelect

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

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function nextDueAt(trigger: TriggerRow) {
  return new Date(new Date(trigger.nextDueAt).getTime() + trigger.intervalSeconds * 1000).toISOString()
}

function fallbackSystemAuth(trigger: TriggerRow): AuthContext {
  return systemAuth({ id: trigger.projectId, name: trigger.projectId }, trigger.organizationId)
}

function systemAuth(project: { id: string; name: string }, organizationId: string): AuthContext {
  return {
    user: {
      id: 'system:scheduler',
      email: '',
      name: 'AMA scheduler',
      avatarUrl: null,
    },
    organization: {
      id: organizationId,
      name: organizationId,
    },
    project,
    roles: ['system'],
    permissions: ['*'],
    oidc: {
      subject: 'system:scheduler',
      clientId: null,
      scope: null,
      issuer: null,
      externalTenantId: null,
      runnerId: null,
      runnerProjectId: null,
      runnerEnvironmentId: null,
    },
  }
}

async function projectForTrigger(db: Db, trigger: TriggerRow) {
  const project = await db.select().from(projects).where(eq(projects.id, trigger.projectId)).get()
  if (!project) {
    throw new Error('Scheduled trigger project is unavailable')
  }
  return { id: project.id, name: project.name }
}

async function claimRun(db: Db, trigger: TriggerRow, heartbeatAt: string) {
  const runId = newId('schedrun')
  const scheduledFor = trigger.nextDueAt
  const idempotencyKey = `${trigger.id}:${scheduledFor}`
  const timestamp = new Date().toISOString()
  try {
    await db.insert(triggerRuns).values({
      id: runId,
      organizationId: trigger.organizationId,
      projectId: trigger.projectId,
      triggerId: trigger.id,
      scheduledFor,
      heartbeatAt,
      state: 'claimed',
      idempotencyKey,
      sessionId: null,
      correlationId: `schedule:${idempotencyKey}`,
      errorMessage: null,
      metadata: '{}',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      return null
    }
    throw error
  }
  return {
    id: runId,
    scheduledFor,
    idempotencyKey,
    correlationId: `schedule:${idempotencyKey}`,
  }
}

async function markRunFailed(
  db: Db,
  auth: AuthContext,
  trigger: TriggerRow,
  run: { id: string; scheduledFor: string; correlationId: string },
  message: string,
) {
  const timestamp = new Date().toISOString()
  await db
    .update(triggerRuns)
    .set({
      state: 'failed',
      errorMessage: message,
      updatedAt: timestamp,
    })
    .where(eq(triggerRuns.id, run.id))
  await db
    .update(triggers)
    .set({
      nextDueAt: nextDueAt(trigger),
      lastDispatchedAt: timestamp,
      lastRunId: run.id,
      updatedAt: timestamp,
    })
    .where(eq(triggers.id, trigger.id))
  await recordAudit(db, {
    auth,
    action: 'scheduled_trigger.dispatch',
    resourceType: 'scheduled_trigger',
    resourceId: trigger.id,
    outcome: 'failure',
    correlationId: run.correlationId,
    metadata: { runId: run.id, scheduledFor: run.scheduledFor, message },
  })
}

async function dispatchTrigger(env: Env, db: Db, trigger: TriggerRow, heartbeatAt: string) {
  const run = await claimRun(db, trigger, heartbeatAt)
  if (!run) {
    return { skipped: true as const }
  }

  let auth = fallbackSystemAuth(trigger)
  try {
    const project = await projectForTrigger(db, trigger)
    auth = systemAuth(project, trigger.organizationId)
    const triggerMetadata = parseJson<Record<string, unknown>>(trigger.metadata, {})
    const sessionMetadata = {
      ...triggerMetadata,
      source: 'scheduled-agent-trigger',
      scheduledTriggerId: trigger.id,
      scheduledRunId: run.id,
      scheduledFor: run.scheduledFor,
      correlationId: run.correlationId,
    }
    // The trigger's execution spec uses the v1 secret env shape; the scheduler
    // path historically dispatched the session with empty runtime env (the
    // route options read `env`/`secretEnv`, not the legacy `runtimeEnv`/
    // `runtimeSecretEnv` keys), so resource/prompt/runtime carry through while
    // the env is left to the agent/provider defaults.
    const sessionOptions = {
      title: trigger.name,
      metadata: sessionMetadata,
      resourceRefs: parseJson<Record<string, unknown>[]>(trigger.resourceRefs, []),
      runtime: RuntimeSchema.parse(trigger.runtime),
      initialPrompt: trigger.promptTemplate,
    }
    const result = await createSessionForAgent(
      env,
      db,
      auth,
      trigger.agentId,
      trigger.environmentId,
      sessionOptions,
      run.correlationId,
    )

    if (!result.ok) {
      const message = result.error.message
      await markRunFailed(db, auth, trigger, run, message)
      return {
        runId: run.id,
        triggerId: trigger.id,
        scheduledFor: run.scheduledFor,
        status: 'failed',
        sessionId: null,
        errorMessage: message,
      }
    }

    const session = result.session
    const timestamp = new Date().toISOString()
    await db
      .update(triggerRuns)
      .set({
        state: 'session_created',
        sessionId: session.id,
        metadata: stringify({ sessionMetadata }),
        updatedAt: timestamp,
      })
      .where(eq(triggerRuns.id, run.id))
    await db
      .update(triggers)
      .set({
        nextDueAt: nextDueAt(trigger),
        lastDispatchedAt: timestamp,
        lastRunId: run.id,
        updatedAt: timestamp,
      })
      .where(eq(triggers.id, trigger.id))
    await recordAudit(db, {
      auth,
      action: 'scheduled_trigger.dispatch',
      resourceType: 'scheduled_trigger',
      resourceId: trigger.id,
      outcome: 'success',
      correlationId: run.correlationId,
      sessionId: session.id,
      metadata: { runId: run.id, scheduledFor: run.scheduledFor, sessionId: session.id },
    })
    return {
      runId: run.id,
      triggerId: trigger.id,
      scheduledFor: run.scheduledFor,
      status: 'session_created',
      sessionId: session.id,
      errorMessage: null,
    }
  } catch (error) {
    const message = safeRuntimeError(error).message
    await markRunFailed(db, auth, trigger, run, message)
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

export async function dispatchDueScheduledTriggers(
  env: Env,
  _ctx: ExecutionContext,
  options: { heartbeatAt?: string; projectId?: string; limit?: number } = {},
): Promise<ScheduleDispatchResult> {
  const db = drizzle(env.DB)
  const heartbeatAt = options.heartbeatAt ?? new Date().toISOString()
  const filters = [
    // active = enabled and not archived (status enum replaced per api-v1)
    eq(triggers.enabled, true),
    isNull(triggers.archivedAt),
    lte(triggers.nextDueAt, heartbeatAt),
    options.projectId ? eq(triggers.projectId, options.projectId) : undefined,
  ].filter((filter) => filter !== undefined)
  const dueTriggers = await db
    .select()
    .from(triggers)
    .where(and(...filters))
    .orderBy(asc(triggers.nextDueAt), asc(triggers.id))
    .limit(options.limit ?? 50)

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
      const run = await dispatchTrigger(env, db, trigger, heartbeatAt)
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
      const safeError = safeRuntimeError(error)
      result.runs.push({
        runId: '',
        triggerId: trigger.id,
        scheduledFor: trigger.nextDueAt,
        status: 'failed',
        sessionId: null,
        errorMessage: safeError.message,
      })
    }
  }

  return result
}
