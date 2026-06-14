import {
  type ConnectorAuthMode,
  type ConnectorCatalogTool,
  type ConnectorCategory,
  type ConnectorTrustLevel,
  DEFAULT_CONNECTORS,
} from '@server/domain/connector'
import type { ConnectorListQuery, ConnectorRecord, ConnectorRepo, ListPageResult } from '@server/usecases/ports'
import { and, desc, eq, like, lt, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { connectors } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type ConnectorRow = typeof connectors.$inferSelect

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null | undefined, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function recordFrom(row: ConnectorRow): ConnectorRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // DB text columns constrained to the catalog enums by the seed writer.
    category: row.category as ConnectorCategory,
    trustLevel: row.trustLevel as ConnectorTrustLevel,
    capabilities: parseJson<string[]>(row.capabilities, []),
    supportedAuthModes: parseJson<ConnectorAuthMode[]>(row.supportedAuthModes, []),
    setupRequirements: parseJson<string[]>(row.setupRequirements, []),
    tools: parseJson<ConnectorCatalogTool[]>(row.tools, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    availability: row.availability as ConnectorRecord['availability'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createConnectorRepo(db: Db): ConnectorRepo {
  return {
    async seedCatalog() {
      const timestamp = now()
      for (const connector of DEFAULT_CONNECTORS) {
        const existing = await db
          .select({ id: connectors.id })
          .from(connectors)
          .where(eq(connectors.id, connector.id))
          .get()
        if (!existing) {
          await db.insert(connectors).values({
            id: connector.id,
            name: connector.name,
            description: connector.description,
            category: connector.category,
            trustLevel: connector.trustLevel,
            capabilities: stringify(connector.capabilities),
            supportedAuthModes: stringify(connector.supportedAuthModes),
            setupRequirements: stringify(connector.setupRequirements),
            tools: stringify(connector.tools),
            metadata: stringify(connector.metadata),
            availability: connector.availability,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
      }
    },

    async list(query: ConnectorListQuery): Promise<ListPageResult<ConnectorRecord>> {
      const filters = [
        query.availability ? eq(connectors.availability, query.availability) : undefined,
        query.category ? eq(connectors.category, query.category) : undefined,
        query.trustLevel ? eq(connectors.trustLevel, query.trustLevel) : undefined,
        query.search
          ? or(like(connectors.name, `%${query.search}%`), like(connectors.description, `%${query.search}%`))
          : undefined,
        query.capability ? like(connectors.capabilities, `%${query.capability}%`) : undefined,
        query.cursor
          ? or(
              lt(connectors.createdAt, query.cursor.createdAt),
              and(eq(connectors.createdAt, query.cursor.createdAt), lt(connectors.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(connectors)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(connectors.createdAt), desc(connectors.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(recordFrom), hasMore }
    },

    async find(connectorId) {
      const row = await db.select().from(connectors).where(eq(connectors.id, connectorId)).get()
      return row ? recordFrom(row) : null
    },
  }
}
