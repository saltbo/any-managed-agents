import type {
  CreateMemoryStoreInput,
  CreateMemoryStoreMemoryInput,
  ListPageResult,
  MemoryStoreListQuery,
  MemoryStoreMemoryListQuery,
  MemoryStoreMemoryRecord,
  MemoryStoreRecord,
  MemoryStoreRepo,
  UpdateMemoryStoreFields,
  UpdateMemoryStoreMemoryFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { memoryStoreMemories, memoryStores } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type MemoryStoreRow = typeof memoryStores.$inferSelect
type MemoryRow = typeof memoryStoreMemories.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function storeRecordFrom(row: MemoryStoreRow): MemoryStoreRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function memoryRecordFrom(row: MemoryRow): MemoryStoreMemoryRecord {
  return {
    id: row.id,
    storeId: row.storeId,
    projectId: row.projectId,
    path: row.path,
    content: row.content,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createMemoryStoreRepo(db: Db): MemoryStoreRepo {
  return {
    async list(query: MemoryStoreListQuery): Promise<ListPageResult<MemoryStoreRecord>> {
      const filters = [
        eq(memoryStores.projectId, query.projectId),
        query.archived ? isNotNull(memoryStores.archivedAt) : isNull(memoryStores.archivedAt),
        query.search ? like(memoryStores.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(memoryStores.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(memoryStores.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(memoryStores.createdAt, query.cursor.createdAt),
              and(eq(memoryStores.createdAt, query.cursor.createdAt), lt(memoryStores.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(memoryStores)
        .where(and(...filters))
        .orderBy(desc(memoryStores.createdAt), desc(memoryStores.id))
        .limit(query.limit + 1)
      return { rows: rows.slice(0, query.limit).map(storeRecordFrom), hasMore: rows.length > query.limit }
    },

    async find(projectId, storeId) {
      const row = await db
        .select()
        .from(memoryStores)
        .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId)))
        .get()
      return row ? storeRecordFrom(row) : null
    },

    async insert(input: CreateMemoryStoreInput, createdAt): Promise<MemoryStoreRecord> {
      const row = {
        id: newId('memstore'),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        metadata: stringify(input.metadata),
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(memoryStores).values(row)
      return storeRecordFrom(row)
    },

    async update(projectId, storeId, fields: UpdateMemoryStoreFields, updatedAt) {
      await db
        .update(memoryStores)
        .set({
          name: fields.name,
          description: fields.description,
          metadata: stringify(fields.metadata),
          archivedAt: fields.archivedAt,
          updatedAt,
        })
        .where(and(eq(memoryStores.id, storeId), eq(memoryStores.projectId, projectId)))
    },

    async listMemories(query: MemoryStoreMemoryListQuery): Promise<ListPageResult<MemoryStoreMemoryRecord>> {
      const filters = [
        eq(memoryStoreMemories.projectId, query.projectId),
        eq(memoryStoreMemories.storeId, query.storeId),
        query.cursor
          ? or(
              lt(memoryStoreMemories.createdAt, query.cursor.createdAt),
              and(
                eq(memoryStoreMemories.createdAt, query.cursor.createdAt),
                lt(memoryStoreMemories.id, query.cursor.id),
              ),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(memoryStoreMemories)
        .where(and(...filters))
        .orderBy(desc(memoryStoreMemories.createdAt), desc(memoryStoreMemories.id))
        .limit(query.limit + 1)
      return { rows: rows.slice(0, query.limit).map(memoryRecordFrom), hasMore: rows.length > query.limit }
    },

    async findMemory(projectId, storeId, memoryId) {
      const row = await db
        .select()
        .from(memoryStoreMemories)
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
          ),
        )
        .get()
      return row ? memoryRecordFrom(row) : null
    },

    async insertMemory(input: CreateMemoryStoreMemoryInput, createdAt): Promise<MemoryStoreMemoryRecord> {
      const row = {
        id: newId('memory'),
        storeId: input.storeId,
        projectId: input.projectId,
        path: input.path,
        content: input.content,
        metadata: stringify(input.metadata),
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(memoryStoreMemories).values(row)
      return memoryRecordFrom(row)
    },

    async updateMemory(projectId, storeId, memoryId, fields: UpdateMemoryStoreMemoryFields, updatedAt) {
      await db
        .update(memoryStoreMemories)
        .set({
          path: fields.path,
          content: fields.content,
          metadata: stringify(fields.metadata),
          updatedAt,
        })
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
          ),
        )
    },

    async deleteMemory(projectId, storeId, memoryId) {
      await db
        .delete(memoryStoreMemories)
        .where(
          and(
            eq(memoryStoreMemories.id, memoryId),
            eq(memoryStoreMemories.storeId, storeId),
            eq(memoryStoreMemories.projectId, projectId),
          ),
        )
    },
  }
}
