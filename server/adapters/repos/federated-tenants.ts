import type {
  CreateFederatedTenantInput,
  FederatedTenantListQuery,
  FederatedTenantRecord,
  FederatedTenantRepo,
  ListPageResult,
  UpdateFederatedTenantFields,
} from '@server/usecases/ports'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { federatedTenants } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type FederatedTenantRow = typeof federatedTenants.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function recordFrom(row: FederatedTenantRow): FederatedTenantRecord {
  return {
    id: row.id,
    issuer: row.issuer,
    externalTenantId: row.externalTenantId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    capabilities: JSON.parse(row.capabilities) as string[],
    enabled: row.enabled,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createFederatedTenantRepo(db: Db): FederatedTenantRepo {
  return {
    async list(query: FederatedTenantListQuery): Promise<ListPageResult<FederatedTenantRecord>> {
      const filters = [
        eq(federatedTenants.projectId, query.projectId),
        query.cursor
          ? or(
              lt(federatedTenants.createdAt, query.cursor.createdAt),
              and(eq(federatedTenants.createdAt, query.cursor.createdAt), lt(federatedTenants.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(federatedTenants)
        .where(and(...filters))
        .orderBy(desc(federatedTenants.createdAt), desc(federatedTenants.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async find(projectId, tenantId) {
      const row = await db
        .select()
        .from(federatedTenants)
        .where(and(eq(federatedTenants.id, tenantId), eq(federatedTenants.projectId, projectId)))
        .get()
      return row ? recordFrom(row) : null
    },

    async findByIssuerTenant(issuer, externalTenantId) {
      const row = await db
        .select({ id: federatedTenants.id })
        .from(federatedTenants)
        .where(and(eq(federatedTenants.issuer, issuer), eq(federatedTenants.externalTenantId, externalTenantId)))
        .get()
      return row ?? null
    },

    async insert(input: CreateFederatedTenantInput, timestamp) {
      const row: FederatedTenantRow = {
        id: newId('ftn'),
        issuer: input.issuer,
        externalTenantId: input.externalTenantId,
        projectId: input.projectId,
        environmentId: input.environmentId,
        capabilities: JSON.stringify(input.capabilities),
        enabled: true,
        metadata: JSON.stringify(input.metadata),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(federatedTenants).values(row)
      return recordFrom(row)
    },

    async update(projectId, tenantId, fields: UpdateFederatedTenantFields, updatedAt) {
      const row = await db
        .update(federatedTenants)
        .set({
          enabled: fields.enabled,
          capabilities: JSON.stringify(fields.capabilities),
          environmentId: fields.environmentId,
          metadata: JSON.stringify(fields.metadata),
          updatedAt,
        })
        .where(and(eq(federatedTenants.id, tenantId), eq(federatedTenants.projectId, projectId)))
        .returning()
        .get()
      return recordFrom(row)
    },

    async delete(projectId, tenantId) {
      await db
        .delete(federatedTenants)
        .where(and(eq(federatedTenants.id, tenantId), eq(federatedTenants.projectId, projectId)))
    },
  }
}
