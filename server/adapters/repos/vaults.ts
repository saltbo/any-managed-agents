import type { SecretProvider, VaultScope, VersionState } from '@server/domain/vault'
import { secretRefPinsVersion } from '@server/domain/vault'
import type {
  CreateCredentialInput,
  CreateVaultInput,
  CredentialListQuery,
  CredentialRecord,
  CredentialVersionRecord,
  InsertVersionInput,
  ListPageResult,
  UpdateVaultFields,
  VaultListQuery,
  VaultRecord,
  VaultRepo,
  VaultVisibility,
  VersionListQuery,
} from '@server/usecases/ports'
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { sessions, vaultCredentials, vaultCredentialVersions, vaults } from '../../db/schema'

type Db = ReturnType<typeof drizzle>
type VaultRow = typeof vaults.$inferSelect
type CredentialRow = typeof vaultCredentials.$inferSelect
type CredentialVersionRow = typeof vaultCredentialVersions.$inferSelect

const ACTIVE_SESSION_STATES = ['idle', 'running'] as const

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function parseRefArray(value: string | null): unknown[] {
  if (!value) {
    return []
  }
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? (parsed as unknown[]) : []
}

function vaultRecordFrom(row: VaultRow): VaultRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    scope: row.scope as VaultScope,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function credentialRecordFrom(row: CredentialRow): CredentialRecord {
  return {
    id: row.id,
    vaultId: row.vaultId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    type: row.type,
    connectorBinding: parseJson<Record<string, unknown>>(row.connectorBinding),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    state: row.state as CredentialRecord['state'],
    activeVersionId: row.activeVersionId,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    revokeReason: row.revokeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// The version record carries the full stored metadata (encryptedSecretValue).
// The http serializer strips stored secret keys before it crosses the wire.
function versionRecordFrom(row: CredentialVersionRow): CredentialVersionRecord {
  return {
    id: row.id,
    credentialId: row.credentialId,
    vaultId: row.vaultId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    version: row.version,
    provider: row.provider as SecretProvider,
    secretRef: row.secretRef,
    referenceName: row.referenceName,
    state: row.state as VersionState,
    hasSecret: row.hasSecret,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
    supersededAt: row.supersededAt,
    revokedAt: row.revokedAt,
  }
}

function visibilityFilter(visibility: VaultVisibility) {
  return or(
    and(eq(vaults.scope, 'project'), eq(vaults.projectId, visibility.projectId)),
    and(eq(vaults.scope, 'organization'), eq(vaults.organizationId, visibility.organizationId)),
  )
}

function versionColumns(version: InsertVersionInput) {
  return {
    provider: version.reference.provider,
    secretRef: version.reference.secretRef,
    referenceName: version.reference.referenceName,
    hasSecret: version.reference.hasSecret,
    metadata: stringify(version.metadata),
  }
}

export function createVaultRepo(db: Db): VaultRepo {
  return {
    async list(query: VaultListQuery): Promise<ListPageResult<VaultRecord>> {
      const filters = [
        visibilityFilter(query),
        query.archived ? isNotNull(vaults.archivedAt) : isNull(vaults.archivedAt),
        query.search ? like(vaults.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(vaults.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(vaults.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(vaults.createdAt, query.cursor.createdAt),
              and(eq(vaults.createdAt, query.cursor.createdAt), lt(vaults.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(vaults)
        .where(and(...filters))
        .orderBy(desc(vaults.createdAt), desc(vaults.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(vaultRecordFrom), hasMore }
    },

    async find(vaultId, visibility) {
      const row = await db
        .select()
        .from(vaults)
        .where(and(eq(vaults.id, vaultId), visibilityFilter(visibility)))
        .get()
      return row ? vaultRecordFrom(row) : null
    },

    async insert(input: CreateVaultInput, createdAt): Promise<VaultRecord> {
      const row = {
        id: newId('vault'),
        organizationId: input.organizationId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        scope: input.scope,
        metadata: stringify(input.metadata),
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
      }
      await db.insert(vaults).values(row)
      return vaultRecordFrom(row)
    },

    async update(vaultId, fields: UpdateVaultFields, updatedAt) {
      await db
        .update(vaults)
        .set({
          name: fields.name,
          description: fields.description,
          scope: fields.scope,
          projectId: fields.projectId,
          metadata: stringify(fields.metadata),
          archivedAt: fields.archivedAt,
          updatedAt,
        })
        .where(eq(vaults.id, vaultId))
    },

    async hasCredentials(vaultId) {
      const credential = await db
        .select({ id: vaultCredentials.id })
        .from(vaultCredentials)
        .where(eq(vaultCredentials.vaultId, vaultId))
        .limit(1)
        .get()
      return Boolean(credential)
    },

    async listCredentials(query: CredentialListQuery): Promise<ListPageResult<CredentialRecord>> {
      const filters = [
        eq(vaultCredentials.vaultId, query.vaultId),
        query.state ? eq(vaultCredentials.state, query.state) : undefined,
        query.search ? like(vaultCredentials.name, `%${query.search}%`) : undefined,
        query.createdFrom ? gte(vaultCredentials.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(vaultCredentials.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(vaultCredentials.createdAt, query.cursor.createdAt),
              and(eq(vaultCredentials.createdAt, query.cursor.createdAt), lt(vaultCredentials.id, query.cursor.id)),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(vaultCredentials)
        .where(and(...filters))
        .orderBy(desc(vaultCredentials.createdAt), desc(vaultCredentials.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(credentialRecordFrom), hasMore }
    },

    async findCredential(vaultId, credentialId) {
      const row = await db
        .select()
        .from(vaultCredentials)
        .where(and(eq(vaultCredentials.id, credentialId), eq(vaultCredentials.vaultId, vaultId)))
        .get()
      return row ? credentialRecordFrom(row) : null
    },

    async activeVersion(credential) {
      if (!credential.activeVersionId) {
        return null
      }
      const row = await db
        .select()
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, credential.activeVersionId),
            eq(vaultCredentialVersions.credentialId, credential.id),
          ),
        )
        .get()
      return row ? versionRecordFrom(row) : null
    },

    async latestVersionNumber(credentialId) {
      const latest = await db
        .select({ version: vaultCredentialVersions.version })
        .from(vaultCredentialVersions)
        .where(eq(vaultCredentialVersions.credentialId, credentialId))
        .orderBy(desc(vaultCredentialVersions.version))
        .limit(1)
        .get()
      return latest?.version ?? 0
    },

    async insertCredentialWithVersion(credential: CreateCredentialInput, version: InsertVersionInput, createdAt) {
      const credentialRow = {
        id: version.credentialId,
        vaultId: credential.vaultId,
        organizationId: credential.organizationId,
        projectId: credential.projectId,
        name: credential.name,
        type: credential.type,
        connectorBinding: stringify(credential.connectorBinding),
        metadata: stringify(credential.metadata),
        state: 'active',
        activeVersionId: null as string | null,
        revokedAt: null,
        revokedByUserId: null,
        revokeReason: null,
        createdAt,
        updatedAt: createdAt,
      } satisfies typeof vaultCredentials.$inferInsert
      const versionRow = {
        id: version.id,
        credentialId: version.credentialId,
        vaultId: version.vaultId,
        organizationId: version.organizationId,
        projectId: version.projectId,
        version: version.version,
        ...versionColumns(version),
        state: 'active',
        createdAt,
        supersededAt: null,
        revokedAt: null,
      } satisfies typeof vaultCredentialVersions.$inferInsert
      await db.batch([
        db.insert(vaultCredentials).values(credentialRow),
        db.insert(vaultCredentialVersions).values(versionRow),
        db
          .update(vaultCredentials)
          .set({ activeVersionId: versionRow.id })
          .where(eq(vaultCredentials.id, credentialRow.id)),
      ])
      return {
        credential: credentialRecordFrom({ ...credentialRow, activeVersionId: versionRow.id }),
        version: versionRecordFrom(versionRow),
      }
    },

    async updateCredential(credentialId, fields, updatedAt, revokeActiveVersions, revokedAt) {
      await db
        .update(vaultCredentials)
        .set({
          metadata: stringify(fields.metadata),
          state: fields.state,
          activeVersionId: fields.activeVersionId,
          revokedAt: fields.revokedAt,
          revokedByUserId: fields.revokedByUserId,
          revokeReason: fields.revokeReason,
          updatedAt,
        })
        .where(eq(vaultCredentials.id, credentialId))
      if (revokeActiveVersions) {
        await db
          .update(vaultCredentialVersions)
          .set({ state: 'revoked', revokedAt })
          .where(
            and(eq(vaultCredentialVersions.credentialId, credentialId), eq(vaultCredentialVersions.state, 'active')),
          )
      }
    },

    async listVersions(query: VersionListQuery): Promise<ListPageResult<CredentialVersionRecord>> {
      const filters = [
        eq(vaultCredentialVersions.credentialId, query.credentialId),
        query.state ? eq(vaultCredentialVersions.state, query.state) : undefined,
        query.createdFrom ? gte(vaultCredentialVersions.createdAt, query.createdFrom) : undefined,
        query.createdTo ? lte(vaultCredentialVersions.createdAt, query.createdTo) : undefined,
        query.cursor
          ? or(
              lt(vaultCredentialVersions.createdAt, query.cursor.createdAt),
              and(
                eq(vaultCredentialVersions.createdAt, query.cursor.createdAt),
                lt(vaultCredentialVersions.id, query.cursor.id),
              ),
            )
          : undefined,
      ].filter((filter) => filter !== undefined)
      const rows = await db
        .select()
        .from(vaultCredentialVersions)
        .where(and(...filters))
        .orderBy(desc(vaultCredentialVersions.createdAt), desc(vaultCredentialVersions.id))
        .limit(query.limit + 1)
      const hasMore = rows.length > query.limit
      return { rows: rows.slice(0, query.limit).map(versionRecordFrom), hasMore }
    },

    async findVersion(credentialId, versionId) {
      const row = await db
        .select()
        .from(vaultCredentialVersions)
        .where(and(eq(vaultCredentialVersions.id, versionId), eq(vaultCredentialVersions.credentialId, credentialId)))
        .get()
      return row ? versionRecordFrom(row) : null
    },

    async insertVersionRotation(version: InsertVersionInput, previousActiveVersionId, timestamp) {
      const versionRow = {
        id: version.id,
        credentialId: version.credentialId,
        vaultId: version.vaultId,
        organizationId: version.organizationId,
        projectId: version.projectId,
        version: version.version,
        ...versionColumns(version),
        state: 'active',
        createdAt: timestamp,
        supersededAt: null,
        revokedAt: null,
      } satisfies typeof vaultCredentialVersions.$inferInsert
      await db.batch([
        db.insert(vaultCredentialVersions).values(versionRow),
        ...(previousActiveVersionId
          ? [
              db
                .update(vaultCredentialVersions)
                .set({ state: 'superseded', supersededAt: timestamp })
                .where(eq(vaultCredentialVersions.id, previousActiveVersionId)),
            ]
          : []),
        db
          .update(vaultCredentials)
          .set({ activeVersionId: versionRow.id, updatedAt: timestamp })
          .where(eq(vaultCredentials.id, version.credentialId)),
      ])
      return versionRecordFrom(versionRow)
    },

    async deleteVersion(versionId) {
      await db.delete(vaultCredentialVersions).where(eq(vaultCredentialVersions.id, versionId))
    },

    async versionHasActiveReferences(version: CredentialVersionRecord) {
      const sessionFilters = [
        eq(sessions.organizationId, version.organizationId),
        version.projectId ? eq(sessions.projectId, version.projectId) : undefined,
        or(eq(sessions.state, ACTIVE_SESSION_STATES[0]), eq(sessions.state, ACTIVE_SESSION_STATES[1])),
      ].filter((filter) => filter !== undefined)
      const sessionReferences = await db
        .select({ envFrom: sessions.envFrom, volumes: sessions.volumes, environmentSnapshot: sessions.environmentSnapshot })
        .from(sessions)
        .where(and(...sessionFilters))
      return sessionReferences.some((row) => {
        const envFromPins = parseRefArray(row.envFrom).some((entry) => {
          const ref = entry && typeof entry === 'object' ? (entry as { secretRef?: unknown }).secretRef : null
          return secretRefPinsVersion(ref, version)
        })
        const volumePins = parseRefArray(row.volumes).some((entry) => {
          const ref = entry && typeof entry === 'object' ? (entry as { secretRef?: unknown }).secretRef : null
          return secretRefPinsVersion(ref, version)
        })
        if (envFromPins || volumePins) {
          return true
        }
        return false
      })
    },
  }
}
