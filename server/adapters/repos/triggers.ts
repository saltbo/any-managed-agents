import type { RuntimeName } from '@server/contracts/environment-contracts'
import type {
  CreateTriggerInput,
  ListPageResult,
  SecretEnvEntry,
  TriggerListQuery,
  TriggerRecord,
  TriggerRepo,
  TriggerRunListQuery,
  TriggerRunRecord,
  UpdateTriggerFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, environments, triggerRuns, triggers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type TriggerRow = typeof triggers.$inferSelect
type RunRow = typeof triggerRuns.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function recordFrom(row: TriggerRow): TriggerRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    environmentId: row.environmentId,
    runtime: row.runtime as RuntimeName,
    name: row.name,
    promptTemplate: row.promptTemplate,
    resourceRefs: parseJson<Record<string, unknown>[]>(row.resourceRefs, []),
    env: parseJson<Record<string, string>>(row.env, {}),
    secretEnv: parseJson<SecretEnvEntry[]>(row.secretEnv, []),
    schedule: { intervalSeconds: row.intervalSeconds, windowSeconds: row.windowSeconds },
    enabled: row.enabled,
    nextDueAt: row.nextDueAt,
    lastDispatchedAt: row.lastDispatchedAt,
    lastRunId: row.lastRunId,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdByUserId: row.createdByUserId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function runRecordFrom(row: RunRow): TriggerRunRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    triggerId: row.triggerId,
    scheduledFor: row.scheduledFor,
    heartbeatAt: row.heartbeatAt,
    state: row.state as TriggerRunRecord['state'],
    idempotencyKey: row.idempotencyKey,
    sessionId: row.sessionId,
    correlationId: row.correlationId,
    errorMessage: row.errorMessage,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function configColumns(config: CreateTriggerInput['config']) {
  return {
    agentId: config.agentId,
    environmentId: config.environmentId,
    runtime: config.runtime,
    name: config.name,
    promptTemplate: config.promptTemplate,
    resourceRefs: stringify(config.resourceRefs),
    env: stringify(config.env),
    secretEnv: stringify(config.secretEnv),
    intervalSeconds: config.schedule.intervalSeconds,
    windowSeconds: config.schedule.windowSeconds,
    enabled: config.enabled,
    nextDueAt: config.nextDueAt,
    metadata: stringify(config.metadata),
  }
}

export function createTriggerRepo(db: Db): TriggerRepo {
  return {
    async list(query: TriggerListQuery): Promise<ListPageResult<TriggerRecord>> {
      const filters = [
        eq(triggers.projectId, query.projectId),
        query.archived ? isNotNull(triggers.archivedAt) : isNull(triggers.archivedAt),
        query.enabled !== undefined ? eq(triggers.enabled, query.enabled) : undefined,
        query.search ? like(triggers.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(triggers.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(triggers.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(triggers.createdAt, query.cursor.createdAt),
              and(eq(triggers.createdAt, query.cursor.createdAt), lt(triggers.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(triggers)
        .where(and(...filters))
        .orderBy(desc(triggers.createdAt), desc(triggers.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async find(projectId, triggerId) {
      const row = await db
        .select()
        .from(triggers)
        .where(and(eq(triggers.id, triggerId), eq(triggers.projectId, projectId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async insert(input: CreateTriggerInput, timestamp) {
      const row = {
        id: newId('trigger'),
        organizationId: input.organizationId,
        projectId: input.projectId,
        lastDispatchedAt: null,
        lastRunId: null,
        createdByUserId: input.createdByUserId,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...configColumns(input.config),
      }
      await db.insert(triggers).values(row)
      return recordFrom(row)
    },

    async update(projectId, triggerId, fields: UpdateTriggerFields, updatedAt) {
      const row = await db
        .update(triggers)
        .set({ archivedAt: fields.archivedAt, updatedAt, ...configColumns(fields.config) })
        .where(and(eq(triggers.id, triggerId), eq(triggers.projectId, projectId)))
        .returning()
        .get()
      return recordFrom(row)
    },

    async listRuns(query: TriggerRunListQuery): Promise<ListPageResult<TriggerRunRecord>> {
      const filters = [
        eq(triggerRuns.triggerId, query.triggerId),
        eq(triggerRuns.projectId, query.projectId),
        query.state ? eq(triggerRuns.state, query.state) : undefined,
        query.search ? like(triggerRuns.correlationId, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(triggerRuns.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(triggerRuns.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(triggerRuns.createdAt, query.cursor.createdAt),
              and(eq(triggerRuns.createdAt, query.cursor.createdAt), lt(triggerRuns.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(triggerRuns)
        .where(and(...filters))
        .orderBy(desc(triggerRuns.createdAt), desc(triggerRuns.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(runRecordFrom), hasMore }
    },

    async findRun(projectId, triggerId, runId) {
      const row = await db
        .select()
        .from(triggerRuns)
        .where(
          and(eq(triggerRuns.id, runId), eq(triggerRuns.triggerId, triggerId), eq(triggerRuns.projectId, projectId)),
        )
        .get()
      return row ? runRecordFrom(row) : null
    },

    async agentUsable(projectId, agentId) {
      const agent = await db
        .select({ archivedAt: agents.archivedAt })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
        .get()
      if (!agent) {
        return { status: 404, message: 'Agent not found' }
      }
      if (agent.archivedAt !== null) {
        return { status: 409, message: 'Archived agents cannot be scheduled' }
      }
      return null
    },

    async environmentUsable(projectId, environmentId) {
      const environment = await db
        .select({ archivedAt: environments.archivedAt, currentVersionId: environments.currentVersionId })
        .from(environments)
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
        .get()
      if (!environment || environment.archivedAt !== null || !environment.currentVersionId) {
        return { status: 409, message: 'Selected environment is archived or unavailable' }
      }
      return null
    },
  }
}
