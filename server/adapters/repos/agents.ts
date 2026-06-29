import type {
  Agent,
  AgentConfig,
  AgentHandoff,
  AgentMemory,
  AgentToolAttachment,
  AgentVersion,
} from '@server/domain/agent'
import { DEFAULT_CONNECTORS } from '@server/domain/connector'
import { resourceMetadata, resourcePhase } from '@server/domain/resource'
import type {
  AgentListPage,
  AgentListQuery,
  AgentRepo,
  CreateAgentInput,
  UpdateAgentFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { agentMemories, agents, agentVersions, connectors, providers } from '../../db/schema'

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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeHandoff(value: unknown, capabilityTags: string[]): AgentHandoff {
  const policy = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const accepts =
    policy.accepts && typeof policy.accepts === 'object' ? (policy.accepts as Record<string, unknown>) : {}
  const targets = Array.isArray(policy.targets)
    ? policy.targets
        .filter((target): target is Record<string, unknown> => Boolean(target) && typeof target === 'object')
        .map((target) => ({
          ...(typeof target.role === 'string' && target.role ? { role: target.role } : {}),
          ...(typeof target.capability === 'string' && target.capability ? { capability: target.capability } : {}),
        }))
        .filter((target) => target.role !== undefined || target.capability !== undefined)
    : []
  return {
    enabled: policy.enabled === true,
    accepts: {
      roles: stringArray(accepts.roles),
      capabilities: stringArray(accepts.capabilities).length > 0 ? stringArray(accepts.capabilities) : capabilityTags,
    },
    targets,
  }
}

function configFromRow(row: AgentRow | AgentVersionRow): AgentConfig {
  const capabilityTags = parseJson<string[]>(row.capabilityTags)
  return {
    systemPrompt: row.instructions,
    provider: row.providerId,
    model: row.model,
    skills: parseJson<string[]>(row.skills),
    subagents: parseJson<Record<string, unknown>[]>(row.subagents),
    role: row.role,
    handoff: normalizeHandoff(parseJson<Record<string, unknown>>(row.handoffPolicy), capabilityTags),
    tools: parseJson<AgentToolAttachment[]>(row.tools),
    mcpConnectors: parseJson<string[]>(row.mcpConnectors),
  }
}

function configColumns(config: AgentConfig) {
  return {
    instructions: config.systemPrompt,
    providerId: config.provider,
    model: config.model,
    skills: stringify(config.skills),
    subagents: stringify(config.subagents),
    role: config.role,
    capabilityTags: stringify(config.handoff.accepts.capabilities),
    handoffPolicy: stringify(config.handoff),
    memoryPolicy: stringify({}),
    tools: stringify(config.tools),
    mcpConnectors: stringify(config.mcpConnectors),
    metadata: stringify({}),
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

function agentRecordFrom(row: AgentRow, version: number): Agent {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    }),
    spec: configFromRow(row),
    status: {
      phase: resourcePhase(row.archivedAt),
      currentVersionId: row.currentVersionId,
      version,
    },
  }
}

function versionRecordFrom(row: AgentVersionRow): AgentVersion {
  return {
    metadata: resourceMetadata({
      uid: row.id,
      pid: row.projectId,
      name: `v${row.version}`,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    }),
    spec: configFromRow(row),
    status: {
      agentId: row.agentId,
      version: row.version,
    },
  }
}

function memoryRecordFrom(row: AgentMemoryRow): AgentMemory {
  return {
    metadata: resourceMetadata({
      uid: row.agentId,
      pid: row.projectId,
      name: 'memory',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    spec: {
      agentId: row.agentId,
      content: row.content,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    },
    status: { phase: 'active' },
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

    async insertVersion(agent, config, createdAt): Promise<AgentVersion> {
      const latest = await this.latestVersionNumber(agent.metadata.uid)
      const row = {
        id: newId('agentver'),
        agentId: agent.metadata.uid,
        projectId: agent.metadata.pid ?? '',
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

    async insert(input: CreateAgentInput, createdAt): Promise<Agent> {
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

    async insertMemory(record: AgentMemory) {
      await db.insert(agentMemories).values({
        agentId: record.spec.agentId,
        projectId: record.metadata.pid ?? '',
        content: record.spec.content,
        metadata: stringify(record.spec.metadata),
        createdAt: record.metadata.createdAt,
        updatedAt: record.metadata.updatedAt,
      })
    },

    async replaceMemory(projectId, agentId, content, metadata, updatedAt) {
      await db
        .update(agentMemories)
        .set({ content, metadata: stringify(metadata), updatedAt })
        .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, projectId)))
    },

    async providerEnabled(_projectId, providerId) {
      const provider = await db
        .select({ enabled: providers.enabled })
        .from(providers)
        .where(eq(providers.id, providerId))
        .get()
      return Boolean(provider?.enabled)
    },

    async connectorAvailable(connectorId) {
      const connector = await db
        .select({ availability: connectors.availability })
        .from(connectors)
        .where(eq(connectors.id, connectorId))
        .get()
      if (connector) {
        return connector.availability === 'available'
      }
      return DEFAULT_CONNECTORS.some((item) => item.id === connectorId && item.availability === 'available')
    },
  }
}
