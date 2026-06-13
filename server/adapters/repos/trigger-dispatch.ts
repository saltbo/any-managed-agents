import { RuntimeSchema } from '@server/routes/environment-contracts'
import type { ClaimedRun, DueTrigger, TriggerDispatchRepo } from '@server/usecases/ports'
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { projects, triggerRuns, triggers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type TriggerRow = typeof triggers.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function dueTriggerFrom(row: TriggerRow): DueTrigger {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    agentId: row.agentId,
    environmentId: row.environmentId,
    runtime: RuntimeSchema.parse(row.runtime),
    promptTemplate: row.promptTemplate,
    resourceRefs: parseJson<Record<string, unknown>[]>(row.resourceRefs, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    nextDueAt: row.nextDueAt,
    intervalSeconds: row.intervalSeconds,
  }
}

function nextDueAt(trigger: DueTrigger) {
  return new Date(new Date(trigger.nextDueAt).getTime() + trigger.intervalSeconds * 1000).toISOString()
}

async function advanceTrigger(db: Db, trigger: DueTrigger, run: ClaimedRun, timestamp: string) {
  await db
    .update(triggers)
    .set({
      nextDueAt: nextDueAt(trigger),
      lastDispatchedAt: timestamp,
      lastRunId: run.id,
      updatedAt: timestamp,
    })
    .where(eq(triggers.id, trigger.id))
}

export function createTriggerDispatchRepo(db: Db): TriggerDispatchRepo {
  return {
    async dueTriggers(options): Promise<DueTrigger[]> {
      const filters = [
        // active = enabled and not archived (status enum replaced per api-v1)
        eq(triggers.enabled, true),
        isNull(triggers.archivedAt),
        lte(triggers.nextDueAt, options.heartbeatAt),
        options.projectId ? eq(triggers.projectId, options.projectId) : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(triggers)
        .where(and(...filters))
        .orderBy(asc(triggers.nextDueAt), asc(triggers.id))
        .limit(options.limit)
      return rows.map(dueTriggerFrom)
    },

    async claimRun(trigger, heartbeatAt): Promise<ClaimedRun | null> {
      const runId = newId('schedrun')
      const scheduledFor = trigger.nextDueAt
      const idempotencyKey = `${trigger.id}:${scheduledFor}`
      const correlationId = `schedule:${idempotencyKey}`
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
          correlationId,
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
      return { id: runId, scheduledFor, correlationId }
    },

    async projectName(projectId): Promise<string | null> {
      const project = await db.select().from(projects).where(eq(projects.id, projectId)).get()
      return project ? project.name : null
    },

    async markRunFailed(trigger, run, message): Promise<void> {
      const timestamp = new Date().toISOString()
      await db
        .update(triggerRuns)
        .set({ state: 'failed', errorMessage: message, updatedAt: timestamp })
        .where(eq(triggerRuns.id, run.id))
      await advanceTrigger(db, trigger, run, timestamp)
    },

    async markRunSessionCreated(trigger, run, sessionId, sessionMetadata): Promise<void> {
      const timestamp = new Date().toISOString()
      await db
        .update(triggerRuns)
        .set({
          state: 'session_created',
          sessionId,
          metadata: JSON.stringify({ sessionMetadata }),
          updatedAt: timestamp,
        })
        .where(eq(triggerRuns.id, run.id))
      await advanceTrigger(db, trigger, run, timestamp)
    },
  }
}
