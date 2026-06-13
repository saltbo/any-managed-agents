import type { UsageMeasurement } from '@server/domain/usage'
import type { UsageListQuery, UsageRecord, UsageRepo, UsageSummaryQuery } from '@server/usecases/ports'
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { usageRecords } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type UsageRow = typeof usageRecords.$inferSelect

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function recordFrom(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    agentVersionId: row.agentVersionId,
    sessionId: row.sessionId,
    sessionEventId: row.sessionEventId,
    correlationId: row.correlationId,
    providerId: row.providerId,
    providerType: row.providerType,
    modelId: row.modelId,
    status: row.status,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    durationMs: row.durationMs,
    costMicros: row.costMicros,
    currency: row.currency,
    usageType: row.usageType,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
  }
}

function measurementFrom(row: UsageRow): UsageMeasurement {
  return {
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    durationMs: row.durationMs,
    costMicros: row.costMicros,
    currency: row.currency,
    providerId: row.providerId,
    providerType: row.providerType,
    modelId: row.modelId,
    agentId: row.agentId,
  }
}

export function createUsageRepo(db: Db): UsageRepo {
  return {
    async list(query: UsageListQuery): Promise<UsageRecord[]> {
      const filters = [
        eq(usageRecords.projectId, query.projectId),
        // providerId matches the configured provider id or the provider type so
        // platform records (providerType only) stay addressable.
        query.providerId
          ? or(eq(usageRecords.providerId, query.providerId), eq(usageRecords.providerType, query.providerId))
          : undefined,
        query.modelId ? eq(usageRecords.modelId, query.modelId) : undefined,
        query.agentId ? eq(usageRecords.agentId, query.agentId) : undefined,
        query.sessionId ? eq(usageRecords.sessionId, query.sessionId) : undefined,
        query.from ? gte(usageRecords.createdAt, query.from) : undefined,
        query.to ? lte(usageRecords.createdAt, query.to) : undefined,
        query.cursor
          ? or(
              lt(usageRecords.createdAt, query.cursor.createdAt),
              and(eq(usageRecords.createdAt, query.cursor.createdAt), lt(usageRecords.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(usageRecords)
        .where(and(...filters))
        .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
      return rows.map(recordFrom)
    },

    async find(projectId, recordId) {
      const row = await db
        .select()
        .from(usageRecords)
        .where(and(eq(usageRecords.id, recordId), eq(usageRecords.projectId, projectId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async summaryRows(query: UsageSummaryQuery): Promise<UsageMeasurement[]> {
      const filters = [
        eq(usageRecords.projectId, query.projectId),
        query.from ? gte(usageRecords.createdAt, query.from) : undefined,
        query.to ? lte(usageRecords.createdAt, query.to) : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(usageRecords)
        .where(and(...filters))
      return rows.map(measurementFrom)
    },
  }
}
