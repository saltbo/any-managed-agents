import type {
  AccessRuleRecord,
  AccessRuleRepo,
  CreateAccessRuleInput,
  UpdateAccessRuleFields,
} from '@server/usecases/ports'
import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { accessRules } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type AccessRuleRow = typeof accessRules.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

// The wildcard '*' is the unscoped value; the column stores it verbatim, so a
// null column (legacy) reads back as the wildcard.
function recordFrom(row: AccessRuleRow): AccessRuleRecord {
  return {
    id: row.id,
    providerId: row.providerId ?? '*',
    modelId: row.modelId ?? '*',
    teamId: row.teamId,
    effect: row.effect as 'allow' | 'deny',
    reason: row.reason,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createAccessRuleRepo(db: Db): AccessRuleRepo {
  return {
    async list(projectId) {
      const rows = await db.select().from(accessRules).where(eq(accessRules.projectId, projectId))
      return rows.map(recordFrom)
    },

    async find(projectId, ruleId) {
      const row = await db
        .select()
        .from(accessRules)
        .where(and(eq(accessRules.id, ruleId), eq(accessRules.projectId, projectId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async insert(input: CreateAccessRuleInput, timestamp) {
      const row: AccessRuleRow = {
        id: newId('access'),
        organizationId: input.organizationId,
        projectId: input.projectId,
        providerId: input.providerId,
        modelId: input.modelId,
        teamId: input.teamId,
        effect: input.effect,
        reason: input.reason,
        metadata: JSON.stringify(input.metadata),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(accessRules).values(row)
      return recordFrom(row)
    },

    async update(projectId, ruleId, fields: UpdateAccessRuleFields, updatedAt) {
      const row = await db
        .update(accessRules)
        .set({
          effect: fields.effect,
          reason: fields.reason,
          metadata: JSON.stringify(fields.metadata),
          updatedAt,
        })
        .where(and(eq(accessRules.id, ruleId), eq(accessRules.projectId, projectId)))
        .returning()
        .get()
      return recordFrom(row)
    },

    async delete(projectId, ruleId) {
      await db.delete(accessRules).where(and(eq(accessRules.id, ruleId), eq(accessRules.projectId, projectId)))
    },
  }
}
