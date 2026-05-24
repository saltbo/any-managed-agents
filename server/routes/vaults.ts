import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { environments, projects, sessions, vaultCredentials, vaultCredentialVersions, vaults } from '../db/schema'
import type { Env } from '../env'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'

const app = createApiRouter()

const ACTIVE_SESSION_STATUSES = ['idle', 'running'] as const
const JsonObjectSchema = z.record(z.string(), z.unknown())
const SecretProviderSchema = z.enum(['cloudflare-secrets', 'external-vault'])

const ConnectorBindingSchema = z
  .object({
    connectorId: z.string().min(1).max(120).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .strict()

const VaultSchema = z
  .object({
    id: z.string().openapi({ example: 'vault_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().nullable().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Provider credentials' }),
    description: z.string().nullable().openapi({ example: 'Credentials used by runtime sessions.' }),
    scope: z.enum(['project', 'organization']).openapi({ example: 'project' }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    status: z.enum(['active', 'archived']).openapi({ example: 'active' }),
    archivedAt: z.string().datetime().nullable().openapi({ example: '2026-05-24T00:00:00.000Z' }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
  })
  .openapi('Vault')

const CredentialVersionSchema = z
  .object({
    id: z.string().openapi({ example: 'vaultver_abc123' }),
    credentialId: z.string().openapi({ example: 'vaultcred_abc123' }),
    vaultId: z.string().openapi({ example: 'vault_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().nullable().openapi({ example: 'project_abc123' }),
    version: z.number().int().openapi({ example: 2 }),
    provider: SecretProviderSchema.openapi({ example: 'cloudflare-secrets' }),
    secretRef: z.string().openapi({ example: 'cloudflare-secret:AMA_PROJECT_ABC123_TOKEN_V2' }),
    externalVaultPath: z.string().nullable().openapi({ example: 'vault://team/provider/token' }),
    referenceName: z.string().openapi({ example: 'AMA_PROJECT_ABC123_TOKEN_V2' }),
    status: z.enum(['active', 'superseded', 'revoked', 'deleted']).openapi({ example: 'active' }),
    hasSecret: z.boolean().openapi({ example: true }),
    metadata: JsonObjectSchema.openapi({ example: { rotatedBy: 'operator' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
    supersededAt: z.string().datetime().nullable().openapi({ example: '2026-05-24T01:00:00.000Z' }),
    revokedAt: z.string().datetime().nullable().openapi({ example: null }),
    deletedAt: z.string().datetime().nullable().openapi({ example: null }),
  })
  .openapi('VaultCredentialVersion')

const CredentialSchema = z
  .object({
    id: z.string().openapi({ example: 'vaultcred_abc123' }),
    vaultId: z.string().openapi({ example: 'vault_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().nullable().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Workers AI token' }),
    type: z.string().openapi({ example: 'api_key' }),
    connectorBinding: ConnectorBindingSchema.openapi({ example: { connectorId: 'workers-ai', name: 'apiKey' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    status: z.enum(['active', 'revoked']).openapi({ example: 'active' }),
    activeVersionId: z.string().nullable().openapi({ example: 'vaultver_abc123' }),
    activeVersion: CredentialVersionSchema.nullable(),
    revokedAt: z.string().datetime().nullable().openapi({ example: null }),
    revokedByUserId: z.string().nullable().openapi({ example: null }),
    revokeReason: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
  })
  .openapi('VaultCredential')

const CreateVaultSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Provider credentials' }),
    description: z.string().max(1000).optional().openapi({ example: 'Credentials used by runtime sessions.' }),
    scope: z.enum(['project', 'organization']).optional().openapi({ example: 'project' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
  })
  .openapi('CreateVaultRequest')

const UpdateVaultSchema = CreateVaultSchema.partial().openapi('UpdateVaultRequest')

const SecretMaterialSchema = z
  .object({
    provider: SecretProviderSchema.optional().openapi({ example: 'cloudflare-secrets' }),
    secretValue: z.string().min(1).max(16000).optional().openapi({ example: 'redacted-input-only' }),
    externalVaultPath: z.string().min(1).max(500).optional().openapi({ example: 'vault://team/provider/token' }),
    referenceName: z.string().min(1).max(160).optional().openapi({ example: 'AMA_PROJECT_TOKEN' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { source: 'console' } }),
  })
  .strict()

const CreateCredentialSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Workers AI token' }),
    type: z.string().min(1).max(80).openapi({ example: 'api_key' }),
    connectorBinding: ConnectorBindingSchema.optional().openapi({
      example: { connectorId: 'workers-ai', name: 'apiKey' },
    }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
    secret: SecretMaterialSchema.openapi({ example: { provider: 'cloudflare-secrets', secretValue: 'input-only' } }),
  })
  .openapi('CreateVaultCredentialRequest')

const RotateCredentialSchema = SecretMaterialSchema.openapi('RotateVaultCredentialRequest')

const UpdateCredentialSchema = z
  .object({
    status: z.enum(['revoked']).optional().openapi({ example: 'revoked' }),
    revokeReason: z.string().max(500).optional().openapi({ example: 'Replaced by scoped credential.' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
  })
  .strict()
  .openapi('UpdateVaultCredentialRequest')

const VaultParamsSchema = z.object({
  vaultId: z.string().openapi({ param: { name: 'vaultId', in: 'path' }, example: 'vault_abc123' }),
})

const CredentialParamsSchema = VaultParamsSchema.extend({
  credentialId: z.string().openapi({ param: { name: 'credentialId', in: 'path' }, example: 'vaultcred_abc123' }),
})

const VersionParamsSchema = CredentialParamsSchema.extend({
  versionId: z.string().openapi({ param: { name: 'versionId', in: 'path' }, example: 'vaultver_abc123' }),
})

const DeleteVersionQuerySchema = z.object({
  confirm: z.enum(['true']).openapi({ param: { name: 'confirm', in: 'query' }, example: 'true' }),
})

const VaultListQuerySchema = listQuerySchema(['active', 'archived'])
const CredentialListQuerySchema = listQuerySchema(['active', 'revoked'])
const CredentialVersionListQuerySchema = listQuerySchema(['active', 'superseded', 'revoked', 'deleted'])
const VaultListResponseSchema = listResponseSchema('VaultListResponse', VaultSchema)
const CredentialListResponseSchema = listResponseSchema('VaultCredentialListResponse', CredentialSchema)
const CredentialVersionListResponseSchema = listResponseSchema(
  'VaultCredentialVersionListResponse',
  CredentialVersionSchema,
)

type VaultRow = typeof vaults.$inferSelect
type CredentialRow = typeof vaultCredentials.$inferSelect
type CredentialVersionRow = typeof vaultCredentialVersions.$inferSelect
type SecretMaterial = z.infer<typeof SecretMaterialSchema>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string) {
  return JSON.parse(value) as T
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } }
}

function secretReferenceName(credentialId: string, version: number, requestedName: string | undefined) {
  return requestedName ?? `AMA_${credentialId.toUpperCase()}_V${version}`
}

function secretReference(
  credentialId: string,
  version: number,
  values: SecretMaterial,
): Pick<
  CredentialVersionRow,
  'provider' | 'secretRef' | 'externalVaultPath' | 'referenceName' | 'hasSecret' | 'metadata'
> {
  const provider = values.provider ?? 'cloudflare-secrets'
  if (provider === 'external-vault') {
    if (values.secretValue) {
      throw new Error('secretValue is not accepted for external-vault credentials')
    }
    if (!values.externalVaultPath) {
      throw new Error('externalVaultPath is required for external-vault credentials')
    }
    return {
      provider,
      secretRef: values.externalVaultPath,
      externalVaultPath: values.externalVaultPath,
      referenceName: values.referenceName ?? values.externalVaultPath,
      hasSecret: true,
      metadata: stringify(values.metadata ?? {}),
    }
  }

  if (!values.secretValue) {
    throw new Error('secretValue is required for cloudflare-secrets credentials')
  }
  if (values.externalVaultPath) {
    throw new Error('externalVaultPath is not accepted for cloudflare-secrets credentials')
  }
  const referenceName = secretReferenceName(credentialId, version, values.referenceName)
  return {
    provider,
    secretRef: `cloudflare-secret:${referenceName}`,
    externalVaultPath: null,
    referenceName,
    hasSecret: true,
    metadata: stringify(values.metadata ?? {}),
  }
}

async function storeCloudflareSecret(env: Env, referenceName: string, secretValue: string) {
  if (!env.AMA_WORKERS_AI_ACCOUNT_ID) {
    throw new Error('AMA_WORKERS_AI_ACCOUNT_ID is required to store Cloudflare secrets')
  }
  if (!env.AMA_CLOUDFLARE_SECRETS_STORE_ID) {
    throw new Error('AMA_CLOUDFLARE_SECRETS_STORE_ID is required to store Cloudflare secrets')
  }
  if (!env.AMA_CLOUDFLARE_API_TOKEN) {
    throw new Error('AMA_CLOUDFLARE_API_TOKEN is required to store Cloudflare secrets')
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.AMA_WORKERS_AI_ACCOUNT_ID}/secrets_store/stores/${env.AMA_CLOUDFLARE_SECRETS_STORE_ID}/secrets`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.AMA_CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([{ name: referenceName, value: secretValue, scopes: ['workers'] }]),
    },
  )
  if (!response.ok) {
    throw new Error('Cloudflare secret storage failed')
  }
  const body = (await response.json()) as { result?: Array<{ id?: string }> }
  const secretId = body.result?.[0]?.id
  if (!secretId) {
    throw new Error('Cloudflare secret storage did not return a secret id')
  }
  return secretId
}

async function storeSecretMaterial(env: Env, reference: ReturnType<typeof secretReference>, values: SecretMaterial) {
  if (reference.provider === 'external-vault') {
    const prefixes = (env.AMA_APPROVED_EXTERNAL_VAULT_PREFIXES ?? '')
      .split(',')
      .map((prefix) => prefix.trim())
      .filter(Boolean)
    if (!prefixes.some((prefix) => reference.externalVaultPath?.startsWith(prefix))) {
      throw new Error('externalVaultPath is not approved for this deployment')
    }
    return
  }

  if (!values.secretValue) {
    throw new Error('secretValue is required for cloudflare-secrets credentials')
  }
  return { cloudflareSecretId: await storeCloudflareSecret(env, reference.referenceName, values.secretValue) }
}

async function deleteCloudflareSecret(env: Env, version: CredentialVersionRow) {
  if (version.provider !== 'cloudflare-secrets' || !version.hasSecret) {
    return
  }
  if (!env.AMA_WORKERS_AI_ACCOUNT_ID) {
    throw new Error('AMA_WORKERS_AI_ACCOUNT_ID is required to delete Cloudflare secrets')
  }
  if (!env.AMA_CLOUDFLARE_SECRETS_STORE_ID) {
    throw new Error('AMA_CLOUDFLARE_SECRETS_STORE_ID is required to delete Cloudflare secrets')
  }
  if (!env.AMA_CLOUDFLARE_API_TOKEN) {
    throw new Error('AMA_CLOUDFLARE_API_TOKEN is required to delete Cloudflare secrets')
  }

  const metadata = parseJson<Record<string, unknown>>(version.metadata)
  const secretId = metadata.cloudflareSecretId
  if (typeof secretId !== 'string' || !secretId) {
    throw new Error('Cloudflare secret id is required to delete credential version')
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.AMA_WORKERS_AI_ACCOUNT_ID}/secrets_store/stores/${env.AMA_CLOUDFLARE_SECRETS_STORE_ID}/secrets/${secretId}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${env.AMA_CLOUDFLARE_API_TOKEN}`,
      },
    },
  )
  if (!response.ok) {
    throw new Error('Cloudflare secret deletion failed')
  }
}

function versionMetadata(reference: ReturnType<typeof secretReference>, stored: Record<string, unknown> | undefined) {
  return stringify({
    ...parseJson<Record<string, unknown>>(reference.metadata),
    ...(stored ?? {}),
  })
}

function parseSecretRefs(value: string | null) {
  if (!value) {
    return []
  }
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed : []
}

function secretRefMatches(ref: unknown, version: CredentialVersionRow) {
  if (typeof ref === 'string') {
    return ref === version.id || ref === version.secretRef || ref === version.referenceName
  }
  if (!ref || typeof ref !== 'object') {
    return false
  }
  const record = ref as Record<string, unknown>
  const values = [
    record.ref,
    record.credentialVersionId,
    record.credentialVersionRef,
    record.secretRef,
    record.referenceName,
  ]
  return values.some((value) => value === version.id || value === version.secretRef || value === version.referenceName)
}

function serializeVault(row: VaultRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    scope: row.scope as 'project' | 'organization',
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    status: row.status as 'active' | 'archived',
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeVersion(row: CredentialVersionRow) {
  return {
    id: row.id,
    credentialId: row.credentialId,
    vaultId: row.vaultId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    version: row.version,
    provider: row.provider as z.infer<typeof SecretProviderSchema>,
    secretRef: row.secretRef,
    externalVaultPath: row.externalVaultPath,
    referenceName: row.referenceName,
    status: row.status as 'active' | 'superseded' | 'revoked' | 'deleted',
    hasSecret: row.hasSecret,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
    supersededAt: row.supersededAt,
    revokedAt: row.revokedAt,
    deletedAt: row.deletedAt,
  }
}

function serializeCredential(row: CredentialRow, activeVersion: CredentialVersionRow | null) {
  return {
    id: row.id,
    vaultId: row.vaultId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    type: row.type,
    connectorBinding: parseJson<z.infer<typeof ConnectorBindingSchema>>(row.connectorBinding),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    status: row.status as 'active' | 'revoked',
    activeVersionId: row.activeVersionId,
    activeVersion: activeVersion ? serializeVersion(activeVersion) : null,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    revokeReason: row.revokeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function vaultVisibilityFilter(auth: { organization: { id: string }; project: { id: string } }) {
  return or(
    and(eq(vaults.scope, 'project'), eq(vaults.projectId, auth.project.id)),
    and(eq(vaults.scope, 'organization'), eq(vaults.organizationId, auth.organization.id)),
  )
}

async function findVault(
  db: ReturnType<typeof drizzle>,
  vaultId: string,
  auth: { organization: { id: string }; project: { id: string } },
) {
  return await db
    .select()
    .from(vaults)
    .where(and(eq(vaults.id, vaultId), vaultVisibilityFilter(auth)))
    .get()
}

async function findCredential(db: ReturnType<typeof drizzle>, vault: VaultRow, credentialId: string) {
  return await db
    .select()
    .from(vaultCredentials)
    .where(and(eq(vaultCredentials.id, credentialId), eq(vaultCredentials.vaultId, vault.id)))
    .get()
}

async function activeVersion(db: ReturnType<typeof drizzle>, credential: CredentialRow) {
  if (!credential.activeVersionId) {
    return null
  }
  return (
    (await db
      .select()
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, credential.activeVersionId),
          eq(vaultCredentialVersions.credentialId, credential.id),
        ),
      )
      .get()) ?? null
  )
}

async function latestVersionNumber(db: ReturnType<typeof drizzle>, credentialId: string) {
  const latest = await db
    .select({ version: vaultCredentialVersions.version })
    .from(vaultCredentialVersions)
    .where(eq(vaultCredentialVersions.credentialId, credentialId))
    .orderBy(desc(vaultCredentialVersions.version))
    .limit(1)
    .get()
  return latest?.version ?? 0
}

async function versionHasActiveReferences(db: ReturnType<typeof drizzle>, version: CredentialVersionRow) {
  const environmentFilters = [eq(environments.status, 'active'), eq(projects.organizationId, version.organizationId)]
  if (version.projectId) {
    environmentFilters.push(eq(environments.projectId, version.projectId))
  }
  const environmentReferences = await db
    .select({ secretRefs: environments.secretRefs })
    .from(environments)
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .where(and(...environmentFilters))
  if (
    environmentReferences.some((row) => parseSecretRefs(row.secretRefs).some((ref) => secretRefMatches(ref, version)))
  ) {
    return true
  }

  const sessionFilters = [
    eq(sessions.organizationId, version.organizationId),
    version.projectId ? eq(sessions.projectId, version.projectId) : undefined,
    or(eq(sessions.status, ACTIVE_SESSION_STATUSES[0]), eq(sessions.status, ACTIVE_SESSION_STATUSES[1])),
  ].filter((filter) => filter !== undefined)
  const sessionReferences = await db
    .select({ environmentSnapshot: sessions.environmentSnapshot })
    .from(sessions)
    .where(and(...sessionFilters))
  return sessionReferences.some((row) => {
    const snapshot = row.environmentSnapshot
      ? (JSON.parse(row.environmentSnapshot) as { secretRefs?: unknown[] })
      : null
    return snapshot?.secretRefs?.some((ref) => secretRefMatches(ref, version)) ?? false
  })
}

function routeValidationError(c: Parameters<Parameters<typeof app.openapi>[1]>[0], error: unknown) {
  return c.json(
    domainValidation(error instanceof Error ? error.message : 'Invalid secret reference', {
      secret: error instanceof Error ? error.message : 'Invalid secret reference.',
    }),
    400,
  )
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listVaults',
  tags: ['Vaults'],
  summary: 'List vaults',
  ...AuthenticatedOperation,
  request: { query: VaultListQuerySchema },
  responses: {
    200: { description: 'Vault list', content: { 'application/json': { schema: VaultListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createVaultRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createVault',
  tags: ['Vaults'],
  summary: 'Create a vault',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateVaultSchema } } } },
  responses: {
    201: { description: 'Created vault', content: { 'application/json': { schema: VaultSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readVaultRoute = createRoute({
  method: 'get',
  path: '/{vaultId}',
  operationId: 'readVault',
  tags: ['Vaults'],
  summary: 'Read a vault',
  ...AuthenticatedOperation,
  request: { params: VaultParamsSchema },
  responses: {
    200: { description: 'Vault', content: { 'application/json': { schema: VaultSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateVaultRoute = createRoute({
  method: 'patch',
  path: '/{vaultId}',
  operationId: 'updateVault',
  tags: ['Vaults'],
  summary: 'Update a vault',
  ...AuthenticatedOperation,
  request: {
    params: VaultParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateVaultSchema } } },
  },
  responses: {
    200: { description: 'Updated vault', content: { 'application/json': { schema: VaultSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Vault scope conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveVaultRoute = createRoute({
  method: 'delete',
  path: '/{vaultId}',
  operationId: 'archiveVault',
  tags: ['Vaults'],
  summary: 'Archive a vault',
  ...AuthenticatedOperation,
  request: { params: VaultParamsSchema },
  responses: {
    204: { description: 'Vault archived' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listCredentialsRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials',
  operationId: 'listVaultCredentials',
  tags: ['Vaults'],
  summary: 'List vault credential metadata',
  ...AuthenticatedOperation,
  request: { params: VaultParamsSchema, query: CredentialListQuerySchema },
  responses: {
    200: {
      description: 'Credential list',
      content: { 'application/json': { schema: CredentialListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createCredentialRoute = createRoute({
  method: 'post',
  path: '/{vaultId}/credentials',
  operationId: 'createVaultCredential',
  tags: ['Vaults'],
  summary: 'Create vault credential metadata',
  ...AuthenticatedOperation,
  request: {
    params: VaultParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateCredentialSchema } } },
  },
  responses: {
    201: { description: 'Created credential', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Vault not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Vault archived', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readCredentialRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials/{credentialId}',
  operationId: 'readVaultCredential',
  tags: ['Vaults'],
  summary: 'Read vault credential metadata',
  ...AuthenticatedOperation,
  request: { params: CredentialParamsSchema },
  responses: {
    200: { description: 'Credential', content: { 'application/json': { schema: CredentialSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateCredentialRoute = createRoute({
  method: 'patch',
  path: '/{vaultId}/credentials/{credentialId}',
  operationId: 'updateVaultCredential',
  tags: ['Vaults'],
  summary: 'Update or revoke vault credential metadata',
  ...AuthenticatedOperation,
  request: {
    params: CredentialParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateCredentialSchema } } },
  },
  responses: {
    200: { description: 'Updated credential', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listVersionsRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials/{credentialId}/versions',
  operationId: 'listVaultCredentialVersions',
  tags: ['Vaults'],
  summary: 'List vault credential versions',
  ...AuthenticatedOperation,
  request: { params: CredentialParamsSchema, query: CredentialVersionListQuerySchema },
  responses: {
    200: {
      description: 'Credential versions',
      content: { 'application/json': { schema: CredentialVersionListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const rotateCredentialRoute = createRoute({
  method: 'post',
  path: '/{vaultId}/credentials/{credentialId}/versions',
  operationId: 'rotateVaultCredential',
  tags: ['Vaults'],
  summary: 'Rotate vault credential',
  ...AuthenticatedOperation,
  request: {
    params: CredentialParamsSchema,
    body: { required: true, content: { 'application/json': { schema: RotateCredentialSchema } } },
  },
  responses: {
    201: { description: 'Created credential version', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Credential unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteVersionRoute = createRoute({
  method: 'delete',
  path: '/{vaultId}/credentials/{credentialId}/versions/{versionId}',
  operationId: 'deleteVaultCredentialVersion',
  tags: ['Vaults'],
  summary: 'Delete unused vault credential version metadata',
  ...AuthenticatedOperation,
  request: { params: VersionParamsSchema, query: DeleteVersionQuerySchema },
  responses: {
    204: { description: 'Credential version deleted' },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Credential version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    409: {
      description: 'Credential version still referenced',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

app.openapi(listRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
  }

  const statusFilter = status ?? (includeArchived === 'true' ? undefined : 'active')
  const filters = [
    vaultVisibilityFilter(auth),
    statusFilter ? eq(vaults.status, statusFilter) : undefined,
    search ? like(vaults.name, `%${search}%`) : undefined,
    createdFrom ? gte(vaults.createdAt, createdFrom) : undefined,
    createdTo ? lte(vaults.createdAt, createdTo) : undefined,
    parsedCursor
      ? or(
          lt(vaults.createdAt, parsedCursor.createdAt),
          and(eq(vaults.createdAt, parsedCursor.createdAt), lt(vaults.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(vaults)
    .where(and(...filters))
    .orderBy(desc(vaults.createdAt), desc(vaults.id))
    .limit(limit + 1)
  const page = paginateRows(rows, limit)
  return c.json({ data: page.data.map(serializeVault), pagination: page.pagination }, 200)
})

app.openapi(createVaultRoute, async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const timestamp = now()
  const scope = body.scope ?? 'project'
  const row = {
    id: newId('vault'),
    organizationId: auth.organization.id,
    projectId: scope === 'project' ? auth.project.id : null,
    name: body.name,
    description: body.description ?? null,
    scope,
    metadata: stringify(body.metadata ?? {}),
    status: 'active',
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.insert(vaults).values(row)
  return c.json(serializeVault(row), 201)
})

app.openapi(readVaultRoute, async (c) => {
  const { vaultId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  if (!vault) {
    return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
  }
  return c.json(serializeVault(vault), 200)
})

app.openapi(updateVaultRoute, async (c) => {
  const { vaultId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  if (!vault) {
    return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
  }

  const scope = body.scope ?? (vault.scope as 'project' | 'organization')
  if (scope !== vault.scope) {
    const credential = await db
      .select({ id: vaultCredentials.id })
      .from(vaultCredentials)
      .where(eq(vaultCredentials.vaultId, vault.id))
      .limit(1)
      .get()
    if (credential) {
      return c.json({ error: { type: 'conflict', message: 'Vault scope cannot change after credentials exist' } }, 409)
    }
  }
  const updated = {
    name: body.name ?? vault.name,
    description: body.description ?? vault.description,
    scope,
    projectId: scope === 'project' ? auth.project.id : null,
    metadata: stringify(body.metadata ?? parseJson<Record<string, unknown>>(vault.metadata)),
    updatedAt: now(),
  }
  await db.update(vaults).set(updated).where(eq(vaults.id, vault.id))
  return c.json(serializeVault({ ...vault, ...updated }), 200)
})

app.openapi(archiveVaultRoute, async (c) => {
  const { vaultId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  if (!vault) {
    return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
  }

  const timestamp = now()
  await db
    .update(vaults)
    .set({ status: 'archived', archivedAt: timestamp, updatedAt: timestamp })
    .where(eq(vaults.id, vault.id))
  return c.body(null, 204)
})

app.openapi(listCredentialsRoute, async (c) => {
  const { vaultId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  if (!vault) {
    return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
  }

  const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
  }

  const statusFilter = status ?? (includeArchived === 'true' ? undefined : 'active')
  const filters = [
    eq(vaultCredentials.vaultId, vault.id),
    statusFilter ? eq(vaultCredentials.status, statusFilter) : undefined,
    search ? like(vaultCredentials.name, `%${search}%`) : undefined,
    createdFrom ? gte(vaultCredentials.createdAt, createdFrom) : undefined,
    createdTo ? lte(vaultCredentials.createdAt, createdTo) : undefined,
    parsedCursor
      ? or(
          lt(vaultCredentials.createdAt, parsedCursor.createdAt),
          and(eq(vaultCredentials.createdAt, parsedCursor.createdAt), lt(vaultCredentials.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(vaultCredentials)
    .where(and(...filters))
    .orderBy(desc(vaultCredentials.createdAt), desc(vaultCredentials.id))
    .limit(limit + 1)
  const page = paginateRows(rows, limit)
  const data = await Promise.all(page.data.map(async (row) => serializeCredential(row, await activeVersion(db, row))))
  return c.json({ data, pagination: page.pagination }, 200)
})

app.openapi(createCredentialRoute, async (c) => {
  const { vaultId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  if (!vault) {
    return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
  }
  if (vault.status !== 'active') {
    return c.json({ error: { type: 'conflict', message: 'Vault is archived' } }, 409)
  }

  const timestamp = now()
  const credentialId = newId('vaultcred')
  let firstSecretRef: ReturnType<typeof secretReference>
  try {
    firstSecretRef = secretReference(credentialId, 1, body.secret)
  } catch (error) {
    return routeValidationError(c, error)
  }
  const credential = {
    id: credentialId,
    vaultId: vault.id,
    organizationId: vault.organizationId,
    projectId: vault.projectId,
    name: body.name,
    type: body.type,
    connectorBinding: stringify(body.connectorBinding ?? {}),
    metadata: stringify(body.metadata ?? {}),
    status: 'active',
    activeVersionId: null,
    revokedAt: null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  let storedSecretMetadata: Record<string, unknown> | undefined
  try {
    storedSecretMetadata = await storeSecretMaterial(c.env, firstSecretRef, body.secret)
  } catch (error) {
    return routeValidationError(c, error)
  }
  const version = {
    id: newId('vaultver'),
    credentialId: credential.id,
    vaultId: credential.vaultId,
    organizationId: credential.organizationId,
    projectId: credential.projectId,
    version: 1,
    ...firstSecretRef,
    metadata: versionMetadata(firstSecretRef, storedSecretMetadata),
    status: 'active',
    createdAt: timestamp,
    supersededAt: null,
    revokedAt: null,
    deletedAt: null,
  }
  await db.batch([
    db.insert(vaultCredentials).values(credential),
    db.insert(vaultCredentialVersions).values(version),
    db.update(vaultCredentials).set({ activeVersionId: version.id }).where(eq(vaultCredentials.id, credential.id)),
  ])
  return c.json(serializeCredential({ ...credential, activeVersionId: version.id }, version), 201)
})

app.openapi(readCredentialRoute, async (c) => {
  const { vaultId, credentialId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  const credential = vault ? await findCredential(db, vault, credentialId) : null
  if (!vault || !credential) {
    return c.json({ error: { type: 'not_found', message: 'Credential not found' } }, 404)
  }
  return c.json(serializeCredential(credential, await activeVersion(db, credential)), 200)
})

app.openapi(updateCredentialRoute, async (c) => {
  const { vaultId, credentialId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  const credential = vault ? await findCredential(db, vault, credentialId) : null
  if (!vault || !credential) {
    return c.json({ error: { type: 'not_found', message: 'Credential not found' } }, 404)
  }

  const timestamp = now()
  const updated = {
    metadata: stringify(body.metadata ?? parseJson<Record<string, unknown>>(credential.metadata)),
    status: body.status ?? (credential.status as 'active' | 'revoked'),
    activeVersionId: body.status === 'revoked' ? null : credential.activeVersionId,
    revokedAt: body.status === 'revoked' ? timestamp : credential.revokedAt,
    revokedByUserId: body.status === 'revoked' ? auth.user.id : credential.revokedByUserId,
    revokeReason: body.status === 'revoked' ? (body.revokeReason ?? null) : credential.revokeReason,
    updatedAt: timestamp,
  }
  await db.update(vaultCredentials).set(updated).where(eq(vaultCredentials.id, credential.id))
  if (body.status === 'revoked') {
    await db
      .update(vaultCredentialVersions)
      .set({ status: 'revoked', revokedAt: timestamp })
      .where(and(eq(vaultCredentialVersions.credentialId, credential.id), eq(vaultCredentialVersions.status, 'active')))
  }
  const serializedActiveVersion =
    body.status === 'revoked' ? null : await activeVersion(db, { ...credential, ...updated })
  return c.json(serializeCredential({ ...credential, ...updated }, serializedActiveVersion), 200)
})

app.openapi(listVersionsRoute, async (c) => {
  const { vaultId, credentialId } = c.req.valid('param')
  const { includeArchived, status, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  const credential = vault ? await findCredential(db, vault, credentialId) : null
  if (!vault || !credential) {
    return c.json({ error: { type: 'not_found', message: 'Credential not found' } }, 404)
  }

  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
  }

  const statusFilter = status ?? (includeArchived === 'true' ? undefined : 'active')
  const filters = [
    eq(vaultCredentialVersions.credentialId, credential.id),
    statusFilter ? eq(vaultCredentialVersions.status, statusFilter) : undefined,
    createdFrom ? gte(vaultCredentialVersions.createdAt, createdFrom) : undefined,
    createdTo ? lte(vaultCredentialVersions.createdAt, createdTo) : undefined,
    parsedCursor
      ? or(
          lt(vaultCredentialVersions.createdAt, parsedCursor.createdAt),
          and(
            eq(vaultCredentialVersions.createdAt, parsedCursor.createdAt),
            lt(vaultCredentialVersions.id, parsedCursor.id),
          ),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const rows = await db
    .select()
    .from(vaultCredentialVersions)
    .where(and(...filters))
    .orderBy(desc(vaultCredentialVersions.createdAt), desc(vaultCredentialVersions.id))
    .limit(limit + 1)
  const page = paginateRows(rows, limit)
  return c.json({ data: page.data.map(serializeVersion), pagination: page.pagination }, 200)
})

app.openapi(rotateCredentialRoute, async (c) => {
  const { vaultId, credentialId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  const credential = vault ? await findCredential(db, vault, credentialId) : null
  if (!vault || !credential) {
    return c.json({ error: { type: 'not_found', message: 'Credential not found' } }, 404)
  }
  if (vault.status !== 'active' || credential.status !== 'active') {
    return c.json({ error: { type: 'conflict', message: 'Credential is not active' } }, 409)
  }

  const timestamp = now()
  let version: CredentialVersionRow
  let reference: ReturnType<typeof secretReference>
  let storedSecretMetadata: Record<string, unknown> | undefined
  try {
    const nextVersion = (await latestVersionNumber(db, credential.id)) + 1
    reference = secretReference(credential.id, nextVersion, body)
    storedSecretMetadata = await storeSecretMaterial(c.env, reference, body)
    version = {
      id: newId('vaultver'),
      credentialId: credential.id,
      vaultId: credential.vaultId,
      organizationId: credential.organizationId,
      projectId: credential.projectId,
      version: nextVersion,
      ...reference,
      metadata: versionMetadata(reference, storedSecretMetadata),
      status: 'active',
      createdAt: timestamp,
      supersededAt: null,
      revokedAt: null,
      deletedAt: null,
    }
  } catch (error) {
    return routeValidationError(c, error)
  }
  const updated = { activeVersionId: version.id, updatedAt: timestamp }
  await db.batch([
    db.insert(vaultCredentialVersions).values(version),
    ...(credential.activeVersionId
      ? [
          db
            .update(vaultCredentialVersions)
            .set({ status: 'superseded', supersededAt: timestamp })
            .where(eq(vaultCredentialVersions.id, credential.activeVersionId)),
        ]
      : []),
    db.update(vaultCredentials).set(updated).where(eq(vaultCredentials.id, credential.id)),
  ])
  return c.json(serializeCredential({ ...credential, ...updated }, version), 201)
})

app.openapi(deleteVersionRoute, async (c) => {
  const { vaultId, credentialId, versionId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const vault = await findVault(db, vaultId, auth)
  const credential = vault ? await findCredential(db, vault, credentialId) : null
  const version = credential
    ? await db
        .select()
        .from(vaultCredentialVersions)
        .where(and(eq(vaultCredentialVersions.id, versionId), eq(vaultCredentialVersions.credentialId, credential.id)))
        .get()
    : null
  if (!vault || !credential || !version) {
    return c.json({ error: { type: 'not_found', message: 'Credential version not found' } }, 404)
  }
  if (credential.activeVersionId === version.id) {
    return c.json({ error: { type: 'conflict', message: 'Active credential version cannot be deleted' } }, 409)
  }
  if (await versionHasActiveReferences(db, version)) {
    return c.json(
      { error: { type: 'conflict', message: 'Credential version is referenced by active runtime metadata' } },
      409,
    )
  }

  const timestamp = now()
  try {
    await deleteCloudflareSecret(c.env, version)
  } catch (error) {
    return routeValidationError(c, error)
  }

  await db
    .update(vaultCredentialVersions)
    .set({
      status: 'deleted',
      deletedAt: timestamp,
      hasSecret: false,
      metadata: stringify({
        ...parseJson<Record<string, unknown>>(version.metadata),
        deletedByUserId: auth.user.id,
        deleteConfirmedAt: timestamp,
      }),
    })
    .where(eq(vaultCredentialVersions.id, version.id))
  return c.body(null, 204)
})

export default app
