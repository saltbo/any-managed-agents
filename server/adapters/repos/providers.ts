import { type ModelAvailability, type ProviderType, providerCredentialStatus } from '@server/domain/provider'
import type {
  CreateProviderInput,
  ModelDiscoveryTaskRecord,
  ProviderCatalogStatus,
  ProviderListPage,
  ProviderListQuery,
  ProviderModelRecord,
  ProviderRecord,
  ProviderRepo,
  UpdateProviderFields,
  UpsertProviderModelInput,
} from '@server/usecases/ports'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agents, modelDiscoveryTasks, providerModels, providers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type ProviderRow = typeof providers.$inferSelect
type ProviderModelRow = typeof providerModels.$inferSelect
type ModelDiscoveryTaskRow = typeof modelDiscoveryTasks.$inferSelect

const PLATFORM_DEFAULT_ID = 'workers-ai'

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function providerRecordFrom(row: ProviderRow): ProviderRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    type: row.type as ProviderType,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    isDefault: row.isDefault,
    enabled: row.enabled,
    credentialId: row.credentialId,
    credentialVersionId: row.credentialVersionId,
    credentialStatus: providerCredentialStatus(row),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    rateLimits: parseJson<Record<string, unknown>>(row.rateLimits, {}),
    budgetPolicy: parseJson<Record<string, unknown>>(row.budgetPolicy, {}),
    modelCatalogState: row.modelCatalogState,
    lastError: parseJson<Record<string, unknown> | null>(row.lastError, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function modelRecordFrom(row: ProviderModelRow): ProviderModelRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    displayName: row.displayName,
    capabilities: parseJson<string[]>(row.capabilities, []),
    contextWindow: row.contextWindow,
    pricing: parseJson<Record<string, unknown>>(row.pricing, {}),
    availability: row.availability as ModelAvailability,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function taskRecordFrom(row: ModelDiscoveryTaskRow): ModelDiscoveryTaskRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    state: row.state as ModelDiscoveryTaskRecord['state'],
    discoveredCount: row.discoveredCount,
    error: parseJson<Record<string, unknown> | null>(row.error, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// Platform-default Workers AI: a synthesized read-only record that exists until
// the project configures its own providers. Write operations require a real
// provider row (the http layer 404s for this id).
function platformDefaultRecord(projectId: string): ProviderRecord {
  const timestamp = new Date().toISOString()
  return {
    id: PLATFORM_DEFAULT_ID,
    organizationId: '',
    projectId,
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    enabled: true,
    credentialId: null,
    credentialVersionId: null,
    credentialStatus: 'not_required',
    metadata: { platformDefault: true },
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createProviderRepo(db: Db): ProviderRepo {
  return {
    async list(query: ProviderListQuery): Promise<ProviderListPage> {
      const filters = [
        eq(providers.projectId, query.projectId),
        query.search ? like(providers.displayName, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(providers.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(providers.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(providers.createdAt, query.cursor.createdAt),
              and(eq(providers.createdAt, query.cursor.createdAt), lt(providers.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(providers)
        .where(and(...filters))
        .orderBy(desc(providers.createdAt), desc(providers.id))
        .limit(query.limit + 1)
      // The synthesized platform default fills an otherwise-empty first page
      // (no filters narrowing the result).
      const unfiltered = !query.search && !query.createdFrom && !query.createdTo && !query.cursor
      const effective =
        rows.length === 0 && unfiltered ? [platformDefaultRecord(query.projectId)] : rows.map(providerRecordFrom)
      const hasMore = effective.length > query.limit
      return { rows: effective.slice(0, query.limit), hasMore }
    },

    async find(projectId, providerId) {
      const row = await db
        .select()
        .from(providers)
        .where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
        .get()
      return row ? providerRecordFrom(row) : null
    },

    platformDefault(projectId) {
      return platformDefaultRecord(projectId)
    },

    async insert(input: CreateProviderInput, createdAt): Promise<ProviderRecord> {
      const row = {
        id: newId('provider'),
        organizationId: input.organizationId,
        projectId: input.projectId,
        type: input.type,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        isDefault: input.isDefault,
        enabled: true,
        credentialId: input.credentialId,
        credentialVersionId: input.credentialVersionId,
        metadata: stringify(input.metadata),
        rateLimits: stringify(input.rateLimits),
        budgetPolicy: stringify(input.budgetPolicy),
        modelCatalogState: 'ready',
        lastError: null,
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(providers).values(row)
      return providerRecordFrom(row)
    },

    async update(projectId, providerId, fields: UpdateProviderFields, updatedAt): Promise<ProviderRecord> {
      const columns = {
        type: fields.type,
        displayName: fields.displayName,
        baseUrl: fields.baseUrl,
        isDefault: fields.isDefault,
        enabled: fields.enabled,
        credentialId: fields.credentialId,
        credentialVersionId: fields.credentialVersionId,
        metadata: stringify(fields.metadata),
        rateLimits: stringify(fields.rateLimits),
        budgetPolicy: stringify(fields.budgetPolicy),
        updatedAt,
      }
      const row = await db
        .update(providers)
        .set(columns)
        .where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
        .returning()
        .get()
      return providerRecordFrom(row)
    },

    async delete(projectId, providerId) {
      await db
        .delete(modelDiscoveryTasks)
        .where(and(eq(modelDiscoveryTasks.projectId, projectId), eq(modelDiscoveryTasks.providerId, providerId)))
      await db
        .delete(providerModels)
        .where(and(eq(providerModels.projectId, projectId), eq(providerModels.providerId, providerId)))
      await db.delete(providers).where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
    },

    async clearDefaults(projectId, updatedAt) {
      await db
        .update(providers)
        .set({ isDefault: false, updatedAt })
        .where(and(eq(providers.projectId, projectId), eq(providers.isDefault, true)))
    },

    async setCatalogStatus(projectId, providerId, status: ProviderCatalogStatus, updatedAt) {
      await db
        .update(providers)
        .set({
          modelCatalogState: status.modelCatalogState,
          lastError: status.lastError ? stringify(status.lastError) : null,
          updatedAt,
        })
        .where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
    },

    async agentReferences(projectId, providerId) {
      const row = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.projectId, projectId), eq(agents.providerId, providerId)))
        .get()
      return Boolean(row)
    },

    async listModels(projectId, providerId) {
      const rows = await db
        .select()
        .from(providerModels)
        .where(and(eq(providerModels.projectId, projectId), eq(providerModels.providerId, providerId)))
        .orderBy(providerModels.modelId)
      return rows.map(modelRecordFrom)
    },

    platformDefaultModels(_projectId, providerId, defaultModelId) {
      const timestamp = new Date().toISOString()
      return [
        {
          id: 'model_workers_ai_default',
          providerId,
          modelId: defaultModelId,
          displayName: 'Workers AI default model',
          capabilities: ['text'],
          contextWindow: null,
          pricing: {},
          availability: 'available',
          metadata: { platformDefault: true },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ]
    },

    async findModel(projectId, providerId, modelId) {
      const row = await db
        .select()
        .from(providerModels)
        .where(
          and(
            eq(providerModels.projectId, projectId),
            eq(providerModels.providerId, providerId),
            eq(providerModels.modelId, modelId),
          ),
        )
        .get()
      return row ? modelRecordFrom(row) : null
    },

    async upsertModel(input: UpsertProviderModelInput, timestamp) {
      const existing = await db
        .select()
        .from(providerModels)
        .where(
          and(
            eq(providerModels.projectId, input.projectId),
            eq(providerModels.providerId, input.providerId),
            eq(providerModels.modelId, input.modelId),
          ),
        )
        .get()
      const values = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: input.displayName,
        capabilities: stringify(input.capabilities),
        contextWindow: input.contextWindow,
        pricing: stringify(input.pricing),
        availability: input.availability,
        metadata: stringify(input.metadata),
        updatedAt: timestamp,
      }
      if (existing) {
        await db
          .update(providerModels)
          .set(values)
          .where(and(eq(providerModels.id, existing.id), eq(providerModels.projectId, input.projectId)))
        return { record: modelRecordFrom({ ...existing, ...values }), created: false }
      }
      const row = { id: newId('model'), ...values, createdAt: timestamp }
      await db.insert(providerModels).values(row)
      return { record: modelRecordFrom(row), created: true }
    },

    async deleteModel(projectId, modelRecordId) {
      await db
        .delete(providerModels)
        .where(and(eq(providerModels.id, modelRecordId), eq(providerModels.projectId, projectId)))
    },

    async insertDiscoveryTask(input, createdAt): Promise<ModelDiscoveryTaskRecord> {
      const row: ModelDiscoveryTaskRow = {
        id: newId('mdtask'),
        organizationId: input.organizationId,
        projectId: input.projectId,
        providerId: input.providerId,
        state: 'running',
        discoveredCount: null,
        error: null,
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(modelDiscoveryTasks).values(row)
      return taskRecordFrom(row)
    },

    async updateDiscoveryTask(projectId, taskId, fields, updatedAt): Promise<ModelDiscoveryTaskRecord> {
      const row = await db
        .update(modelDiscoveryTasks)
        .set({
          state: fields.state,
          discoveredCount: fields.discoveredCount,
          error: fields.error ? stringify(fields.error) : null,
          updatedAt,
        })
        .where(and(eq(modelDiscoveryTasks.id, taskId), eq(modelDiscoveryTasks.projectId, projectId)))
        .returning()
        .get()
      return taskRecordFrom(row)
    },

    async findDiscoveryTask(projectId, providerId, taskId) {
      const row = await db
        .select()
        .from(modelDiscoveryTasks)
        .where(
          and(
            eq(modelDiscoveryTasks.id, taskId),
            eq(modelDiscoveryTasks.projectId, projectId),
            eq(modelDiscoveryTasks.providerId, providerId),
          ),
        )
        .get()
      return row ? taskRecordFrom(row) : null
    },
  }
}
