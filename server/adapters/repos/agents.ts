import type { AgentConfig, AgentToolAttachment } from '@server/domain/agent'
import type {
  AgentListPage,
  AgentListQuery,
  AgentMemoryRecord,
  AgentRecord,
  AgentRepo,
  AgentVersionRecord,
  CreateAgentInput,
  UpdateAgentFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agentMemories, agents, agentVersions, connections, providerModels, providers } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type AgentRow = typeof agents.$inferSelect
type AgentVersionRow = typeof agentVersions.$inferSelect
type AgentMemoryRow = typeof agentMemories.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function configFromRow(row: AgentRow | AgentVersionRow): AgentConfig {
  return {
    instructions: row.instructions,
    providerId: row.providerId,
    model: row.model,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<Record<string, unknown>[]>(row.subagents),
    role: row.role,
    capabilityTags: parseJson<string[]>(row.capabilityTags),
    handoffPolicy: parseJson<Record<string, unknown>>(row.handoffPolicy),
    memoryPolicy: parseJson<Record<string, unknown>>(row.memoryPolicy),
    tools: parseJson<AgentToolAttachment[]>(row.tools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
  }
}

function configColumns(config: AgentConfig) {
  return {
    instructions: config.instructions,
    providerId: config.providerId,
    model: config.model,
    skills: stringify(config.skills),
    subagents: stringify(config.subagents),
    role: config.role,
    capabilityTags: stringify(config.capabilityTags),
    handoffPolicy: stringify(config.handoffPolicy),
    memoryPolicy: stringify(config.memoryPolicy),
    tools: stringify(config.tools),
    mcpConnectors: stringify(config.mcpConnectors),
    metadata: stringify(config.metadata),
  }
}

async function versionNumberOf(db: Db, agentId: string, versionId: string | null) {
  if (!versionId) {
    return 0
  }
  const row = await db
    .select({ version: agentVersions.version })
    .from(agentVersions)
    .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId)))
    .get()
  return row?.version ?? 0
}

function agentRecordFrom(row: AgentRow, version: number): AgentRecord {
  return {
    id: row.id,
    projectId: row.projectId ?? '',
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt,
    currentVersionId: row.currentVersionId,
    version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...configFromRow(row),
  }
}

function versionRecordFrom(row: AgentVersionRow): AgentVersionRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    version: row.version,
    createdAt: row.createdAt,
    ...configFromRow(row),
  }
}

function memoryRecordFrom(row: AgentMemoryRow): AgentMemoryRecord {
  return {
    agentId: row.agentId,
    projectId: row.projectId,
    content: row.content,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createAgentRepo(db: Db): AgentRepo {
  return {
    async list(query: AgentListQuery): Promise<AgentListPage> {
      const filters = [
        eq(agents.projectId, query.projectId),
        query.archived ? isNotNull(agents.archivedAt) : isNull(agents.archivedAt),
        query.search ? like(agents.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(agents.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(agents.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(agents.createdAt, query.cursor.createdAt),
              and(eq(agents.createdAt, query.cursor.createdAt), lt(agents.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(agents)
        .where(and(...filters))
        .orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      const page = rows.slice(0, query.limit)
      const records = await Promise.all(
        page.map(async (row) => agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
      return { rows: records, hasMore }
    },

    async find(projectId, agentId) {
      const row = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
        .get()
      if (!row) {
        return null
      }
      return agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))
    },

    async liveAgents(projectId) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(eq(agents.projectId, projectId), isNull(agents.archivedAt)))
        .orderBy(desc(agents.createdAt), desc(agents.id))
      return Promise.all(
        rows.map(async (row) => agentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
    },

    async latestVersionNumber(agentId) {
      const row = await db
        .select({ version: agentVersions.version })
        .from(agentVersions)
        .where(eq(agentVersions.agentId, agentId))
        .orderBy(desc(agentVersions.version))
        .limit(1)
        .get()
      return row?.version ?? null
    },

    async insertVersion(agent, config, createdAt): Promise<AgentVersionRecord> {
      const latest = await this.latestVersionNumber(agent.id)
      const row = {
        id: newId('agentver'),
        agentId: agent.id,
        projectId: agent.projectId,
        version: (latest ?? 0) + 1,
        createdAt,
        ...configColumns(config),
      }
      await db.insert(agentVersions).values(row)
      return versionRecordFrom(row)
    },

    async listVersions(projectId, agentId) {
      const rows = await db
        .select()
        .from(agentVersions)
        .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.projectId, projectId)))
        .orderBy(desc(agentVersions.version))
      return rows.map(versionRecordFrom)
    },

    async findVersion(projectId, agentId, version) {
      const row = await db
        .select()
        .from(agentVersions)
        .where(
          and(
            eq(agentVersions.agentId, agentId),
            eq(agentVersions.projectId, projectId),
            eq(agentVersions.version, version),
          ),
        )
        .get()
      return row ? versionRecordFrom(row) : null
    },

    async insert(input: CreateAgentInput, createdAt): Promise<AgentRecord> {
      const row = {
        id: newId('agent'),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        archivedAt: null,
        currentVersionId: null,
        createdAt,
        updatedAt: createdAt,
        ...configColumns(input.config),
      }
      await db.insert(agents).values(row)
      return agentRecordFrom(row, 0)
    },

    async setCurrentVersion(agentId, versionId) {
      await db.update(agents).set({ currentVersionId: versionId }).where(eq(agents.id, agentId))
    },

    async update(projectId, agentId, fields: UpdateAgentFields, updatedAt) {
      await db
        .update(agents)
        .set({
          name: fields.name,
          description: fields.description,
          archivedAt: fields.archivedAt,
          currentVersionId: fields.currentVersionId,
          updatedAt,
          ...configColumns(fields.config),
        })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    },

    async unarchive(projectId, agentId, updatedAt) {
      await db
        .update(agents)
        .set({ archivedAt: null, updatedAt })
        .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
    },

    async findMemory(projectId, agentId) {
      const row = await db
        .select()
        .from(agentMemories)
        .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, projectId)))
        .get()
      return row ? memoryRecordFrom(row) : null
    },

    async insertMemory(record: AgentMemoryRecord) {
      await db.insert(agentMemories).values({
        agentId: record.agentId,
        projectId: record.projectId,
        content: record.content,
        metadata: stringify(record.metadata),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
    },

    async replaceMemory(projectId, agentId, content, metadata, updatedAt) {
      await db
        .update(agentMemories)
        .set({ content, metadata: stringify(metadata), updatedAt })
        .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, projectId)))
    },

    async providerEnabled(projectId, providerId) {
      const provider = await db
        .select({ enabled: providers.enabled })
        .from(providers)
        .where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
        .get()
      return Boolean(provider?.enabled)
    },

    async modelAvailable(projectId, providerId, model) {
      const known = await db
        .select({ id: providerModels.id })
        .from(providerModels)
        .where(
          and(
            eq(providerModels.providerId, providerId),
            eq(providerModels.projectId, projectId),
            eq(providerModels.modelId, model),
            eq(providerModels.availability, 'available'),
          ),
        )
        .get()
      return Boolean(known)
    },

    async connectorConnected(projectId, connectorId) {
      const connection = await db
        .select({ id: connections.id })
        .from(connections)
        .where(
          and(
            eq(connections.projectId, projectId),
            eq(connections.connectorId, connectorId),
            eq(connections.state, 'connected'),
          ),
        )
        .get()
      return Boolean(connection)
    },
  }
}
