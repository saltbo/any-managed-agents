import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  CREDENTIAL_STATES,
  SECRET_PROVIDERS,
  stripStoredSecretMetadata,
  VAULT_SCOPES,
  VERSION_STATES,
} from '@server/domain/vault'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import {
  type CredentialRecord,
  type CredentialVersionRecord,
  type VaultRecord,
  VaultSecretError,
  VaultVersionReferencedError,
} from '../usecases/ports'
import { createCredential, deleteCredentialVersion, rotateCredential } from '../usecases/vaults'
import { requestId } from './request-context'

type VaultRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())
const VaultJsonObjectSchema = JsonObjectSchema.openapi('VaultJsonObject')
const SecretProviderSchema = z.enum(SECRET_PROVIDERS)

const ConnectorBindingSchema = z
  .object({
    connectorId: z.string().min(1).max(120).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .strict()

const VaultSchema = z
  .object({
    id: z.string().openapi({ example: 'vault_abc123' }),
    projectId: z.string().nullable().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Provider credentials' }),
    description: z.string().nullable().openapi({ example: 'Credentials used by runtime sessions.' }),
    scope: z.enum(VAULT_SCOPES).openapi({ example: 'project' }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
  })
  .openapi('Vault')

const CredentialVersionSchema = z
  .object({
    id: z.string().openapi({ example: 'vaultver_abc123' }),
    credentialId: z.string().openapi({ example: 'vaultcred_abc123' }),
    vaultId: z.string().openapi({ example: 'vault_abc123' }),
    projectId: z.string().nullable().openapi({ example: 'project_abc123' }),
    version: z.number().int().openapi({ example: 2 }),
    provider: SecretProviderSchema.openapi({ example: 'cloudflare-secrets' }),
    secretRef: z.string().openapi({ example: 'cloudflare-secret:AMA_PROJECT_ABC123_TOKEN_V2' }),
    externalVaultPath: z.string().nullable().openapi({ example: 'vault://team/provider/token' }),
    referenceName: z.string().openapi({ example: 'AMA_PROJECT_ABC123_TOKEN_V2' }),
    state: z.enum(VERSION_STATES).openapi({ example: 'active' }),
    hasSecret: z.boolean().openapi({ example: true }),
    metadata: VaultJsonObjectSchema.openapi({ example: { rotatedBy: 'operator' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-24T00:00:00.000Z' }),
    supersededAt: z.string().datetime().nullable().openapi({ example: '2026-05-24T01:00:00.000Z' }),
    revokedAt: z.string().datetime().nullable().openapi({ example: null }),
  })
  .openapi('VaultCredentialVersion')

const CredentialSchema = z
  .object({
    id: z.string().openapi({ example: 'vaultcred_abc123' }),
    vaultId: z.string().openapi({ example: 'vault_abc123' }),
    projectId: z.string().nullable().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Workers AI token' }),
    type: z.string().openapi({ example: 'api_key' }),
    connectorBinding: ConnectorBindingSchema.openapi({ example: { connectorId: 'workers-ai', name: 'apiKey' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    state: z.enum(CREDENTIAL_STATES).openapi({ example: 'active' }),
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
    scope: z.enum(VAULT_SCOPES).optional().openapi({ example: 'project' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
  })
  .openapi('CreateVaultRequest')

const UpdateVaultSchema = CreateVaultSchema.partial()
  .extend({
    archived: z.boolean().optional().openapi({ example: true }),
  })
  .openapi('UpdateVaultRequest')

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

const CreateCredentialVersionSchema = SecretMaterialSchema.openapi('CreateVaultCredentialVersionRequest')

const UpdateCredentialSchema = z
  .object({
    state: z.enum(['revoked']).optional().openapi({ example: 'revoked' }),
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

const credentialStateQuery = z
  .enum(CREDENTIAL_STATES)
  .optional()
  .openapi({ param: { name: 'state', in: 'query' }, example: 'active' })

const versionStateQuery = z
  .enum(VERSION_STATES)
  .optional()
  .openapi({ param: { name: 'state', in: 'query' }, example: 'active' })

const VaultListQuerySchema = listQuerySchema()
const CredentialListQuerySchema = listQuerySchema().omit({ archived: true }).extend({ state: credentialStateQuery })
const CredentialVersionListQuerySchema = listQuerySchema()
  .omit({ archived: true, search: true })
  .extend({ state: versionStateQuery })
const VaultListResponseSchema = listResponseSchema('VaultListResponse', VaultSchema)
const CredentialListResponseSchema = listResponseSchema('VaultCredentialListResponse', CredentialSchema)
const CredentialVersionListResponseSchema = listResponseSchema(
  'VaultCredentialVersionListResponse',
  CredentialVersionSchema,
)

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

function serializeVault(record: VaultRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    scope: record.scope,
    metadata: record.metadata,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

// Stored secret material (ciphertext, legacy local values) lives only in the
// version record metadata. It must never leave through API responses or audit
// snapshots.
function serializeVersion(record: CredentialVersionRecord) {
  return {
    id: record.id,
    credentialId: record.credentialId,
    vaultId: record.vaultId,
    projectId: record.projectId,
    version: record.version,
    provider: record.provider,
    secretRef: record.secretRef,
    externalVaultPath: record.externalVaultPath,
    referenceName: record.referenceName,
    state: record.state,
    hasSecret: record.hasSecret,
    metadata: stripStoredSecretMetadata(record.metadata),
    createdAt: record.createdAt,
    supersededAt: record.supersededAt,
    revokedAt: record.revokedAt,
  }
}

function serializeCredential(record: CredentialRecord, activeVersion: CredentialVersionRecord | null) {
  return {
    id: record.id,
    vaultId: record.vaultId,
    projectId: record.projectId,
    name: record.name,
    type: record.type,
    connectorBinding: record.connectorBinding,
    metadata: record.metadata,
    state: record.state,
    activeVersionId: record.activeVersionId,
    activeVersion: activeVersion ? serializeVersion(activeVersion) : null,
    revokedAt: record.revokedAt,
    revokedByUserId: record.revokedByUserId,
    revokeReason: record.revokeReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
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
  summary: 'Update or archive a vault',
  description: 'Partial update. Archive with `archived: true`; restore with `archived: false`.',
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

const listCredentialsRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials',
  operationId: 'listVaultCredentials',
  tags: ['Vaults'],
  summary: 'List vault credential metadata',
  ...AuthenticatedOperation,
  request: { params: VaultParamsSchema, query: CredentialListQuerySchema },
  responses: {
    200: { description: 'Credential list', content: { 'application/json': { schema: CredentialListResponseSchema } } },
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
  description: "Revoke with `state: 'revoked'` and an optional `revokeReason`.",
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

const createVersionRoute = createRoute({
  method: 'post',
  path: '/{vaultId}/credentials/{credentialId}/versions',
  operationId: 'createVaultCredentialVersion',
  tags: ['Vaults'],
  summary: 'Rotate a vault credential by creating a new version',
  ...AuthenticatedOperation,
  request: {
    params: CredentialParamsSchema,
    body: { required: true, content: { 'application/json': { schema: CreateCredentialVersionSchema } } },
  },
  responses: {
    201: { description: 'Created credential version', content: { 'application/json': { schema: CredentialSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Credential not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Credential unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readVersionRoute = createRoute({
  method: 'get',
  path: '/{vaultId}/credentials/{credentialId}/versions/{versionId}',
  operationId: 'readVaultCredentialVersion',
  tags: ['Vaults'],
  summary: 'Read a vault credential version',
  ...AuthenticatedOperation,
  request: { params: VersionParamsSchema },
  responses: {
    200: { description: 'Credential version', content: { 'application/json': { schema: CredentialVersionSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Credential version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const deleteVersionRoute = createRoute({
  method: 'delete',
  path: '/{vaultId}/credentials/{credentialId}/versions/{versionId}',
  operationId: 'deleteVaultCredentialVersion',
  tags: ['Vaults'],
  summary: 'Delete an unused vault credential version',
  description: 'Hard delete. The active version and versions pinned by live runtime metadata cannot be deleted.',
  ...AuthenticatedOperation,
  request: { params: VersionParamsSchema },
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

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the vaults resource's original mount position.
export function registerVaultRoutes(routes: VaultRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.vaults.list({
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeVault), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createVaultRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = body.scope ?? 'project'
      const vault = await deps.vaults.insert(
        {
          organizationId: auth.organization.id,
          projectId: scope === 'project' ? auth.project.id : null,
          name: body.name,
          description: body.description ?? null,
          scope,
          metadata: body.metadata ?? {},
        },
        new Date().toISOString(),
      )
      const serialized = serializeVault(vault)
      await deps.audit.record(auth, {
        action: 'vault.create',
        resourceType: 'vault',
        resourceId: vault.id,
        outcome: 'success',
        requestId: requestId(c),
        after: serialized,
      })
      return c.json(serialized, 201)
    })
    .openapi(readVaultRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      return c.json(serializeVault(vault), 200)
    })
    .openapi(updateVaultRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      const scope = body.scope ?? vault.scope
      if (scope !== vault.scope && (await deps.vaults.hasCredentials(vault.id))) {
        return c.json(
          { error: { type: 'conflict', message: 'Vault scope cannot change after credentials exist' } },
          409,
        )
      }
      const timestamp = new Date().toISOString()
      const archivedAt =
        body.archived === true ? (vault.archivedAt ?? timestamp) : body.archived === false ? null : vault.archivedAt
      const fields = {
        name: body.name ?? vault.name,
        description: body.description ?? vault.description,
        scope,
        projectId: scope === 'project' ? auth.project.id : null,
        metadata: body.metadata ?? vault.metadata,
        archivedAt,
      }
      await deps.vaults.update(vault.id, fields, timestamp)
      const serialized = serializeVault({ ...vault, ...fields, updatedAt: timestamp })
      await deps.audit.record(auth, {
        action: body.archived === true && vault.archivedAt === null ? 'vault.archive' : 'vault.update',
        resourceType: 'vault',
        resourceId: vault.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeVault(vault),
        after: serialized,
      })
      return c.json(serialized, 200)
    })
    .openapi(listCredentialsRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      const { state, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.vaults.listCredentials({
        vaultId: vault.id,
        ...(state ? { state } : {}),
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const data = await Promise.all(
        page.rows.map(async (row) => serializeCredential(row, await deps.vaults.activeVersion(row))),
      )
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json({ data, pagination: { limit, nextCursor, hasMore: page.hasMore } }, 200)
    })
    .openapi(createCredentialRoute, async (c) => {
      const { vaultId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      if (!vault) {
        return vaultNotFound(c)
      }
      if (vault.archivedAt !== null) {
        return c.json({ error: { type: 'conflict', message: 'Vault is archived' } }, 409)
      }
      let result: Awaited<ReturnType<typeof createCredential>>
      try {
        result = await createCredential(deps, vault, {
          name: body.name,
          type: body.type,
          connectorBinding: body.connectorBinding ?? {},
          metadata: body.metadata ?? {},
          secret: body.secret,
        })
      } catch (error) {
        return secretErrorOr(c, error)
      }
      const serialized = serializeCredential(result.credential, result.version)
      await deps.audit.record(auth, {
        action: 'vault_credential.create',
        resourceType: 'vault_credential',
        resourceId: result.credential.id,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.id },
        after: serialized,
      })
      return c.json(serialized, 201)
    })
    .openapi(readCredentialRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.id, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      return c.json(serializeCredential(credential, await deps.vaults.activeVersion(credential)), 200)
    })
    .openapi(updateCredentialRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.id, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      const timestamp = new Date().toISOString()
      const revoking = body.state === 'revoked'
      const fields = {
        metadata: body.metadata ?? credential.metadata,
        state: body.state ?? credential.state,
        activeVersionId: revoking ? null : credential.activeVersionId,
        revokedAt: revoking ? timestamp : credential.revokedAt,
        revokedByUserId: revoking ? auth.user.id : credential.revokedByUserId,
        revokeReason: revoking ? (body.revokeReason ?? null) : credential.revokeReason,
      }
      const before = serializeCredential(credential, await deps.vaults.activeVersion(credential))
      await deps.vaults.updateCredential(credential.id, fields, timestamp, revoking, timestamp)
      const updated = { ...credential, ...fields, updatedAt: timestamp }
      const serializedActiveVersion = revoking ? null : await deps.vaults.activeVersion(updated)
      const serialized = serializeCredential(updated, serializedActiveVersion)
      await deps.audit.record(auth, {
        action: revoking ? 'vault_credential.revoke' : 'vault_credential.update',
        resourceType: 'vault_credential',
        resourceId: credential.id,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.id },
        before,
        after: serialized,
      })
      return c.json(serialized, 200)
    })
    .openapi(listVersionsRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const { state, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.id, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.vaults.listVersions({
        credentialId: credential.id,
        ...(state ? { state } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeVersion), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createVersionRoute, async (c) => {
      const { vaultId, credentialId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.id, credentialId) : null
      if (!vault || !credential) {
        return credentialNotFound(c)
      }
      if (vault.archivedAt !== null || credential.state !== 'active') {
        return c.json({ error: { type: 'conflict', message: 'Credential is not active' } }, 409)
      }
      const before = serializeCredential(credential, await deps.vaults.activeVersion(credential))
      let result: Awaited<ReturnType<typeof rotateCredential>>
      try {
        result = await rotateCredential(deps, credential, body)
      } catch (error) {
        return secretErrorOr(c, error)
      }
      const serialized = serializeCredential(result.credential, result.version)
      await deps.audit.record(auth, {
        action: 'vault_credential.rotate',
        resourceType: 'vault_credential',
        resourceId: credential.id,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.id, versionId: result.version.id },
        before,
        after: serialized,
      })
      return c.json(serialized, 201)
    })
    .openapi(readVersionRoute, async (c) => {
      const { vaultId, credentialId, versionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.id, credentialId) : null
      const version = credential ? await deps.vaults.findVersion(credential.id, versionId) : null
      if (!vault || !credential || !version) {
        return versionNotFound(c)
      }
      return c.json(serializeVersion(version), 200)
    })
    .openapi(deleteVersionRoute, async (c) => {
      const { vaultId, credentialId, versionId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const vault = await deps.vaults.find(vaultId, visibility(auth))
      const credential = vault ? await deps.vaults.findCredential(vault.id, credentialId) : null
      const version = credential ? await deps.vaults.findVersion(credential.id, versionId) : null
      if (!vault || !credential || !version) {
        return versionNotFound(c)
      }
      try {
        await deleteCredentialVersion(deps, credential, version)
      } catch (error) {
        if (error instanceof VaultVersionReferencedError) {
          return c.json({ error: { type: 'conflict', message: error.message } }, 409)
        }
        return secretErrorOr(c, error)
      }
      await deps.audit.record(auth, {
        action: 'vault_credential_version.delete',
        resourceType: 'vault_credential_version',
        resourceId: version.id,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { vaultId: vault.id, credentialId: credential.id },
        before: serializeVersion(version),
      })
      return c.body(null, 204)
    })
}

// --- helpers ---

function visibility(auth: { organization: { id: string }; project: { id: string } }) {
  return { organizationId: auth.organization.id, projectId: auth.project.id }
}

function vaultNotFound(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Vault not found' } }, 404)
}

function credentialNotFound(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Credential not found' } }, 404)
}

function versionNotFound(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Credential version not found' } }, 404)
}

function secretErrorOr(c: Parameters<Parameters<VaultRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof VaultSecretError) {
    return c.json(domainValidation(error.message, { secret: error.message }), 400)
  }
  throw error
}
