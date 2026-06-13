import type {
  EnvironmentConfig,
  EnvironmentCredentialRef,
  EnvironmentHostingMode,
  EnvironmentPackage,
  EnvironmentVariable,
} from '@server/domain/environment'
import type {
  CreateEnvironmentInput,
  EnvironmentListPage,
  EnvironmentListQuery,
  EnvironmentRecord,
  EnvironmentRepo,
  EnvironmentVersionRecord,
  UpdateEnvironmentFields,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import {
  connections,
  environments,
  environmentVersions,
  vaultCredentials,
  vaultCredentialVersions,
} from '../../db/schema'
import { normalizeEnvironmentNetworkPolicy } from '../../routes/environment-contracts'

type Db = ReturnType<typeof drizzle>
type EnvironmentRow = typeof environments.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function configFromRow(row: EnvironmentRow | EnvironmentVersionRow): EnvironmentConfig {
  return {
    packages: parseJson<EnvironmentPackage[]>(row.packages),
    variables: parseJson<Record<string, EnvironmentVariable>>(row.variables),
    credentialRefs: parseJson<EnvironmentCredentialRef[]>(row.credentialRefs),
    hostingMode: row.hostingMode as EnvironmentHostingMode,
    networkPolicy: normalizeEnvironmentNetworkPolicy(parseJson<unknown>(row.networkPolicy)),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy),
    packageManagerPolicy: parseJson<Record<string, unknown>>(row.packageManagerPolicy),
    resourceLimits: parseJson<Record<string, unknown>>(row.resourceLimits),
    runtimeConfig: parseJson<Record<string, unknown>>(row.runtimeConfig),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
  }
}

function configColumns(config: EnvironmentConfig) {
  return {
    packages: stringify(config.packages),
    variables: stringify(config.variables),
    credentialRefs: stringify(config.credentialRefs),
    hostingMode: config.hostingMode,
    networkPolicy: stringify(config.networkPolicy),
    mcpPolicy: stringify(config.mcpPolicy),
    packageManagerPolicy: stringify(config.packageManagerPolicy),
    resourceLimits: stringify(config.resourceLimits),
    runtimeConfig: stringify(config.runtimeConfig),
    metadata: stringify(config.metadata),
  }
}

async function versionNumberOf(db: Db, environmentId: string, versionId: string | null) {
  if (!versionId) {
    return 0
  }
  const row = await db
    .select({ version: environmentVersions.version })
    .from(environmentVersions)
    .where(and(eq(environmentVersions.id, versionId), eq(environmentVersions.environmentId, environmentId)))
    .get()
  return row?.version ?? 0
}

function environmentRecordFrom(row: EnvironmentRow, version: number): EnvironmentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
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

function versionRecordFrom(row: EnvironmentVersionRow): EnvironmentVersionRecord {
  return {
    id: row.id,
    environmentId: row.environmentId,
    projectId: row.projectId,
    version: row.version,
    createdAt: row.createdAt,
    ...configFromRow(row),
  }
}

export function createEnvironmentRepo(db: Db): EnvironmentRepo {
  return {
    async list(query: EnvironmentListQuery): Promise<EnvironmentListPage> {
      const filters = [
        eq(environments.projectId, query.projectId),
        query.archived ? isNotNull(environments.archivedAt) : isNull(environments.archivedAt),
        query.search ? like(environments.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(environments.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(environments.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(environments.createdAt, query.cursor.createdAt),
              and(eq(environments.createdAt, query.cursor.createdAt), lt(environments.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(environments)
        .where(and(...filters))
        .orderBy(desc(environments.createdAt), desc(environments.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      const page = rows.slice(0, query.limit)
      const records = await Promise.all(
        page.map(async (row) => environmentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))),
      )
      return { rows: records, hasMore }
    },

    async find(projectId, environmentId) {
      const row = await db
        .select()
        .from(environments)
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
        .get()
      if (!row) {
        return null
      }
      return environmentRecordFrom(row, await versionNumberOf(db, row.id, row.currentVersionId))
    },

    async insertVersion(environment, config, createdAt): Promise<EnvironmentVersionRecord> {
      const latest = await db
        .select({ version: environmentVersions.version })
        .from(environmentVersions)
        .where(eq(environmentVersions.environmentId, environment.id))
        .orderBy(desc(environmentVersions.version))
        .limit(1)
        .get()
      const row = {
        id: newId('envver'),
        environmentId: environment.id,
        projectId: environment.projectId,
        version: (latest?.version ?? 0) + 1,
        createdAt,
        ...configColumns(config),
      }
      await db.insert(environmentVersions).values(row)
      return versionRecordFrom(row)
    },

    async listVersions(projectId, environmentId) {
      const rows = await db
        .select()
        .from(environmentVersions)
        .where(and(eq(environmentVersions.environmentId, environmentId), eq(environmentVersions.projectId, projectId)))
        .orderBy(desc(environmentVersions.version))
      return rows.map(versionRecordFrom)
    },

    async findVersion(projectId, environmentId, version) {
      const row = await db
        .select()
        .from(environmentVersions)
        .where(
          and(
            eq(environmentVersions.environmentId, environmentId),
            eq(environmentVersions.projectId, projectId),
            eq(environmentVersions.version, version),
          ),
        )
        .get()
      return row ? versionRecordFrom(row) : null
    },

    async insert(input: CreateEnvironmentInput, createdAt): Promise<EnvironmentRecord> {
      const row = {
        id: newId('env'),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        archivedAt: null,
        currentVersionId: null,
        createdAt,
        updatedAt: createdAt,
        ...configColumns(input.config),
      }
      await db.insert(environments).values(row)
      return environmentRecordFrom(row, 0)
    },

    async setCurrentVersion(environmentId, versionId) {
      await db.update(environments).set({ currentVersionId: versionId }).where(eq(environments.id, environmentId))
    },

    async update(projectId, environmentId, fields: UpdateEnvironmentFields, updatedAt) {
      await db
        .update(environments)
        .set({
          name: fields.name,
          description: fields.description,
          archivedAt: fields.archivedAt,
          currentVersionId: fields.currentVersionId,
          updatedAt,
          ...configColumns(fields.config),
        })
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    },

    async unarchive(projectId, environmentId, updatedAt) {
      await db
        .update(environments)
        .set({ archivedAt: null, updatedAt })
        .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    },

    async credentialActive(organizationId, projectId, credentialId) {
      const credential = await db
        .select({ state: vaultCredentials.state })
        .from(vaultCredentials)
        .where(
          and(
            eq(vaultCredentials.id, credentialId),
            eq(vaultCredentials.organizationId, organizationId),
            or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
          ),
        )
        .get()
      return credential?.state === 'active'
    },

    async credentialVersionUsable(credentialId, versionId) {
      const version = await db
        .select({ id: vaultCredentialVersions.id })
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, versionId),
            eq(vaultCredentialVersions.credentialId, credentialId),
            or(eq(vaultCredentialVersions.state, 'active'), eq(vaultCredentialVersions.state, 'superseded')),
          ),
        )
        .get()
      return Boolean(version)
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
