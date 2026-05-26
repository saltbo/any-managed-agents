import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, isNull, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { environments, environmentVersions, mcpConnections, vaultCredentialVersions } from '../db/schema'
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

const JsonObjectSchema = z.record(z.string(), z.unknown())
const PackageSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(120).optional(),
})
const VariableSchema = z.object({
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
})
const SecretRefSchema = z.object({
  name: z.string().min(1).max(120),
  ref: z.string().min(1).max(240),
})
const NetworkPolicySchema = z
  .object({
    mode: z.enum(['offline', 'restricted', 'open']).optional(),
    allowedHosts: z.array(z.string().min(1).max(253)).max(100).optional(),
  })
  .strict()
const McpPolicySchema = z
  .object({
    allowedConnectors: z.array(z.string().min(1).max(120)).max(100).optional(),
    blockedConnectors: z.array(z.string().min(1).max(120)).max(100).optional(),
    requireApprovalConnectors: z.array(z.string().min(1).max(120)).max(100).optional(),
    requireApprovalTools: z.array(z.string().min(1).max(240)).max(200).optional(),
    connectorApprovalModes: z.record(z.string().min(1).max(120), z.enum(['none', 'require_approval'])).optional(),
    defaultEffect: z.enum(['allow', 'deny']).optional(),
  })
  .strict()
  .openapi('EnvironmentMcpPolicy')
const ResourceLimitsSchema = z
  .object({
    cpuMs: z.number().int().positive().optional(),
    memoryMb: z.number().int().positive().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
  })
  .strict()
const RuntimeImageSchema = z
  .object({
    image: z.string().min(1).max(240).optional(),
  })
  .strict()

const EnvironmentSchema = z
  .object({
    id: z.string().openapi({ example: 'env_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Node workspace' }),
    description: z.string().nullable().openapi({ example: 'Default Node.js environment.' }),
    packages: z.array(PackageSchema).openapi({ example: [{ name: 'tsx', version: 'latest' }] }),
    variables: z.record(z.string(), VariableSchema).openapi({ example: { NODE_ENV: { description: 'Runtime mode' } } }),
    secretRefs: z.array(SecretRefSchema).openapi({ example: [{ name: 'NPM_TOKEN', ref: 'vault_secret_123' }] }),
    networkPolicy: JsonObjectSchema.openapi({ example: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] } }),
    mcpPolicy: McpPolicySchema.openapi({ example: { allowedConnectors: ['github'] } }),
    packageManagerPolicy: JsonObjectSchema.openapi({ example: { allowedRegistries: ['registry.npmjs.org'] } }),
    resourceLimits: JsonObjectSchema.openapi({ example: { memoryMb: 512 } }),
    runtimeImage: JsonObjectSchema.openapi({ example: { image: 'node:24' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    status: z.enum(['active', 'archived']).openapi({ example: 'active' }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    currentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    version: z.number().int().openapi({ example: 1 }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('Environment')

const EnvironmentVersionSchema = z
  .object({
    id: z.string().openapi({ example: 'envver_abc123' }),
    environmentId: z.string().openapi({ example: 'env_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    version: z.number().int().openapi({ example: 1 }),
    packages: z.array(PackageSchema).openapi({ example: [{ name: 'tsx' }] }),
    variables: z.record(z.string(), VariableSchema).openapi({ example: { NODE_ENV: { required: true } } }),
    secretRefs: z.array(SecretRefSchema).openapi({ example: [{ name: 'NPM_TOKEN', ref: 'vault_secret_123' }] }),
    networkPolicy: JsonObjectSchema.openapi({ example: { mode: 'restricted' } }),
    mcpPolicy: McpPolicySchema.openapi({ example: { allowedConnectors: ['github'] } }),
    packageManagerPolicy: JsonObjectSchema.openapi({ example: { allowedRegistries: ['registry.npmjs.org'] } }),
    resourceLimits: JsonObjectSchema.openapi({ example: { memoryMb: 512 } }),
    runtimeImage: JsonObjectSchema.openapi({ example: { image: 'node:24' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('EnvironmentVersion')

const EnvironmentPayloadSchema = z.object({
  name: z.string().min(1).max(120).openapi({ example: 'Node workspace' }),
  description: z.string().max(1000).optional().openapi({ example: 'Default Node.js environment.' }),
  packages: z
    .array(PackageSchema)
    .max(200)
    .optional()
    .openapi({ example: [{ name: 'tsx', version: 'latest' }] }),
  variables: z
    .record(z.string(), VariableSchema)
    .optional()
    .openapi({ example: { NODE_ENV: { required: true } } }),
  secretRefs: z
    .array(SecretRefSchema)
    .max(100)
    .optional()
    .openapi({ example: [{ name: 'NPM_TOKEN', ref: 'vault_secret_123' }] }),
  networkPolicy: NetworkPolicySchema.optional().openapi({ example: { mode: 'restricted' } }),
  mcpPolicy: McpPolicySchema.optional().openapi({ example: { allowedConnectors: ['github'] } }),
  packageManagerPolicy: JsonObjectSchema.optional().openapi({ example: { allowedRegistries: ['registry.npmjs.org'] } }),
  resourceLimits: ResourceLimitsSchema.optional().openapi({ example: { memoryMb: 512 } }),
  runtimeImage: RuntimeImageSchema.optional().openapi({ example: { image: 'node:24' } }),
  metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
})
const CreateEnvironmentSchema = EnvironmentPayloadSchema.openapi('CreateEnvironmentRequest')
const UpdateEnvironmentSchema = EnvironmentPayloadSchema.partial().openapi('UpdateEnvironmentRequest')

const EnvironmentParamsSchema = z.object({
  environmentId: z.string().openapi({
    param: { name: 'environmentId', in: 'path' },
    example: 'env_abc123',
  }),
})
const ListQuerySchema = listQuerySchema(['active', 'archived'])
const EnvironmentListResponseSchema = listResponseSchema('EnvironmentListResponse', EnvironmentSchema)
const EnvironmentVersionListResponseSchema = listResponseSchema(
  'EnvironmentVersionListResponse',
  EnvironmentVersionSchema,
)

type EnvironmentRow = typeof environments.$inferSelect
type EnvironmentVersionRow = typeof environmentVersions.$inferSelect
type Package = z.infer<typeof PackageSchema>
type Variable = z.infer<typeof VariableSchema>
type SecretRef = z.infer<typeof SecretRefSchema>

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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } }
}

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => {
    return secretKey(key) || hasSecretMaterial(child)
  })
}

function isExternalSecretReference(ref: string) {
  return (
    ref.startsWith('cloudflare-secret:') ||
    ref.startsWith('wrangler_secret:') ||
    ref.startsWith('vault://') ||
    ref.startsWith('secret://')
  )
}

async function validateSecretRefs(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  projectId: string,
  secretRefs: SecretRef[],
) {
  for (const [index, secretRef] of secretRefs.entries()) {
    const secretRefField = `secretRefs[${index}]`
    if (!secretRef.ref.startsWith('vaultver_')) {
      if (isExternalSecretReference(secretRef.ref)) {
        continue
      }
      return { [secretRefField]: 'Secret reference must use an approved reference format.' }
    }
    if (secretRef.ref !== secretRef.ref.trim()) {
      return { [secretRefField]: 'Secret reference must use an approved reference format.' }
    }
    if (secretRef.ref.length < 'vaultver_'.length + 1) {
      return { [secretRefField]: 'Secret reference must use an approved reference format.' }
    }
    if (!/^vaultver_[A-Za-z0-9_]+$/.test(secretRef.ref)) {
      return { [secretRefField]: 'Secret reference must use an approved reference format.' }
    }
    const version = await db
      .select({ id: vaultCredentialVersions.id })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, secretRef.ref),
          eq(vaultCredentialVersions.organizationId, organizationId),
          or(eq(vaultCredentialVersions.projectId, projectId), isNull(vaultCredentialVersions.projectId)),
          or(eq(vaultCredentialVersions.status, 'active'), eq(vaultCredentialVersions.status, 'superseded')),
        ),
      )
      .get()
    if (!version) {
      return { [secretRefField]: 'Secret reference is not an active credential version.' }
    }
  }
  return null
}

async function validateMcpPolicy(
  db: ReturnType<typeof drizzle>,
  projectId: string,
  mcpPolicy: Record<string, unknown>,
) {
  const approvalModes = mcpPolicy.connectorApprovalModes
  const connectorIds = [
    ...stringArray(mcpPolicy.allowedConnectors),
    ...stringArray(mcpPolicy.blockedConnectors),
    ...stringArray(mcpPolicy.requireApprovalConnectors),
    ...(approvalModes && typeof approvalModes === 'object' && !Array.isArray(approvalModes)
      ? Object.keys(approvalModes)
      : []),
  ]
  for (const connectorId of new Set(connectorIds)) {
    if (connectorId === '*') {
      continue
    }
    const connection = await db
      .select({ id: mcpConnections.id })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.projectId, projectId),
          eq(mcpConnections.connectorId, connectorId),
          eq(mcpConnections.status, 'connected'),
        ),
      )
      .get()
    if (!connection) {
      return { mcpPolicy: `MCP connector is not connected for this project: ${connectorId}` }
    }
  }
  return null
}

function validateSecretFreeObjects(values: {
  metadata: Record<string, unknown>
  mcpPolicy: Record<string, unknown>
  packageManagerPolicy: Record<string, unknown>
}) {
  if (hasSecretMaterial(values.metadata)) {
    return { metadata: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(values.mcpPolicy)) {
    return { mcpPolicy: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(values.packageManagerPolicy)) {
    return { packageManagerPolicy: 'Secret material must be stored in a vault.' }
  }
  return null
}

function serializeVersion(row: EnvironmentVersionRow) {
  return {
    id: row.id,
    environmentId: row.environmentId,
    projectId: row.projectId,
    version: row.version,
    packages: parseJson<Package[]>(row.packages),
    variables: parseJson<Record<string, Variable>>(row.variables),
    secretRefs: parseJson<SecretRef[]>(row.secretRefs),
    networkPolicy: parseJson<Record<string, unknown>>(row.networkPolicy),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy),
    packageManagerPolicy: parseJson<Record<string, unknown>>(row.packageManagerPolicy),
    resourceLimits: parseJson<Record<string, unknown>>(row.resourceLimits),
    runtimeImage: parseJson<Record<string, unknown>>(row.runtimeImage),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    createdAt: row.createdAt,
  }
}

function serializeEnvironment(row: EnvironmentRow, version: EnvironmentVersionRow | null) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    packages: parseJson<Package[]>(row.packages),
    variables: parseJson<Record<string, Variable>>(row.variables),
    secretRefs: parseJson<SecretRef[]>(row.secretRefs),
    networkPolicy: parseJson<Record<string, unknown>>(row.networkPolicy),
    mcpPolicy: parseJson<Record<string, unknown>>(row.mcpPolicy),
    packageManagerPolicy: parseJson<Record<string, unknown>>(row.packageManagerPolicy),
    resourceLimits: parseJson<Record<string, unknown>>(row.resourceLimits),
    runtimeImage: parseJson<Record<string, unknown>>(row.runtimeImage),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    status: row.status as 'active' | 'archived',
    archivedAt: row.archivedAt,
    currentVersionId: row.currentVersionId,
    version: version?.version ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function findEnvironment(db: ReturnType<typeof drizzle>, environmentId: string, projectId: string) {
  return await db
    .select()
    .from(environments)
    .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    .get()
}

async function currentVersion(db: ReturnType<typeof drizzle>, environment: EnvironmentRow) {
  if (!environment.currentVersionId) {
    return null
  }
  return (
    (await db
      .select()
      .from(environmentVersions)
      .where(
        and(
          eq(environmentVersions.id, environment.currentVersionId),
          eq(environmentVersions.environmentId, environment.id),
        ),
      )
      .get()) ?? null
  )
}

async function createVersion(
  db: ReturnType<typeof drizzle>,
  environment: Pick<EnvironmentRow, 'id' | 'projectId'>,
  values: {
    packages: Package[]
    variables: Record<string, Variable>
    secretRefs: SecretRef[]
    networkPolicy: Record<string, unknown>
    mcpPolicy: Record<string, unknown>
    packageManagerPolicy: Record<string, unknown>
    resourceLimits: Record<string, unknown>
    runtimeImage: Record<string, unknown>
    metadata: Record<string, unknown>
    createdAt: string
  },
) {
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
    packages: stringify(values.packages),
    variables: stringify(values.variables),
    secretRefs: stringify(values.secretRefs),
    networkPolicy: stringify(values.networkPolicy),
    mcpPolicy: stringify(values.mcpPolicy),
    packageManagerPolicy: stringify(values.packageManagerPolicy),
    resourceLimits: stringify(values.resourceLimits),
    runtimeImage: stringify(values.runtimeImage),
    metadata: stringify(values.metadata),
    createdAt: values.createdAt,
  }
  await db.insert(environmentVersions).values(row)
  return row
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listEnvironments',
  tags: ['Environments'],
  summary: 'List environments',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Environment list',
      content: { 'application/json': { schema: EnvironmentListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createRouteConfig = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createEnvironment',
  tags: ['Environments'],
  summary: 'Create an environment',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateEnvironmentSchema } } } },
  responses: {
    201: { description: 'Created environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{environmentId}',
  operationId: 'readEnvironment',
  tags: ['Environments'],
  summary: 'Read an environment',
  ...AuthenticatedOperation,
  request: { params: EnvironmentParamsSchema },
  responses: {
    200: { description: 'Environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{environmentId}',
  operationId: 'updateEnvironment',
  tags: ['Environments'],
  summary: 'Update an environment',
  ...AuthenticatedOperation,
  request: {
    params: EnvironmentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateEnvironmentSchema } } },
  },
  responses: {
    200: { description: 'Updated environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Archived environment', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveRoute = createRoute({
  method: 'delete',
  path: '/{environmentId}',
  operationId: 'archiveEnvironment',
  tags: ['Environments'],
  summary: 'Archive an environment',
  ...AuthenticatedOperation,
  request: { params: EnvironmentParamsSchema },
  responses: {
    204: { description: 'Environment archived' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const versionsRoute = createRoute({
  method: 'get',
  path: '/{environmentId}/versions',
  operationId: 'listEnvironmentVersions',
  tags: ['Environments'],
  summary: 'List environment versions',
  ...AuthenticatedOperation,
  request: { params: EnvironmentParamsSchema },
  responses: {
    200: {
      description: 'Environment versions',
      content: { 'application/json': { schema: EnvironmentVersionListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const routes = app
  .openapi(listRoute, async (c) => {
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
      return c.json(
        {
          error: {
            type: 'validation_error',
            message: 'Invalid list cursor',
            details: { fields: { cursor: 'Cursor is invalid.' } },
          },
        },
        400,
      )
    }
    const statusFilter = status ?? (includeArchived === 'true' ? undefined : 'active')
    const filters = [
      eq(environments.projectId, auth.project.id),
      statusFilter ? eq(environments.status, statusFilter) : undefined,
      search ? like(environments.name, `%${search}%`) : undefined,
      createdFrom ? gte(environments.createdAt, createdFrom) : undefined,
      createdTo ? lte(environments.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(environments.createdAt, parsedCursor.createdAt),
            and(eq(environments.createdAt, parsedCursor.createdAt), lt(environments.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const rows = await db
      .select()
      .from(environments)
      .where(and(...filters))
      .orderBy(desc(environments.createdAt), desc(environments.id))
      .limit(limit + 1)
    const page = paginateRows(rows, limit)
    const data = await Promise.all(
      page.data.map(async (row) => serializeEnvironment(row, await currentVersion(db, row))),
    )
    return c.json({ data, pagination: page.pagination }, 200)
  })
  .openapi(createRouteConfig, async (c) => {
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const timestamp = now()
    const values = {
      packages: body.packages ?? [],
      variables: body.variables ?? {},
      secretRefs: body.secretRefs ?? [],
      networkPolicy: body.networkPolicy ?? {},
      mcpPolicy: body.mcpPolicy ?? {},
      packageManagerPolicy: body.packageManagerPolicy ?? {},
      resourceLimits: body.resourceLimits ?? {},
      runtimeImage: body.runtimeImage ?? {},
      metadata: body.metadata ?? {},
    }
    const validation =
      (await validateSecretRefs(db, auth.organization.id, auth.project.id, values.secretRefs)) ??
      (await validateMcpPolicy(db, auth.project.id, values.mcpPolicy)) ??
      validateSecretFreeObjects(values)
    if (validation) {
      return c.json(domainValidation('Invalid environment configuration', validation), 400)
    }
    const row = {
      id: newId('env'),
      projectId: auth.project.id,
      name: body.name,
      description: body.description ?? null,
      packages: stringify(values.packages),
      variables: stringify(values.variables),
      secretRefs: stringify(values.secretRefs),
      networkPolicy: stringify(values.networkPolicy),
      mcpPolicy: stringify(values.mcpPolicy),
      packageManagerPolicy: stringify(values.packageManagerPolicy),
      resourceLimits: stringify(values.resourceLimits),
      runtimeImage: stringify(values.runtimeImage),
      metadata: stringify(values.metadata),
      status: 'active',
      archivedAt: null,
      currentVersionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(environments).values(row)
    const version = await createVersion(db, row, { ...values, createdAt: timestamp })
    await db.update(environments).set({ currentVersionId: version.id }).where(eq(environments.id, row.id))
    return c.json(serializeEnvironment({ ...row, currentVersionId: version.id }, version), 201)
  })
  .openapi(readRoute, async (c) => {
    const { environmentId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const environment = await findEnvironment(db, environmentId, auth.project.id)
    if (!environment) {
      return c.json({ error: { type: 'not_found', message: 'Environment not found' } }, 404)
    }
    return c.json(serializeEnvironment(environment, await currentVersion(db, environment)), 200)
  })
  .openapi(updateRoute, async (c) => {
    const { environmentId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const environment = await findEnvironment(db, environmentId, auth.project.id)
    if (!environment) {
      return c.json({ error: { type: 'not_found', message: 'Environment not found' } }, 404)
    }
    if (environment.status === 'archived') {
      return c.json({ error: { type: 'conflict', message: 'Archived environments cannot be updated' } }, 409)
    }

    const next = {
      name: body.name ?? environment.name,
      description: body.description ?? environment.description,
      packages: body.packages ?? parseJson<Package[]>(environment.packages),
      variables: body.variables ?? parseJson<Record<string, Variable>>(environment.variables),
      secretRefs: body.secretRefs ?? parseJson<SecretRef[]>(environment.secretRefs),
      networkPolicy: body.networkPolicy ?? parseJson<Record<string, unknown>>(environment.networkPolicy),
      mcpPolicy: body.mcpPolicy ?? parseJson<Record<string, unknown>>(environment.mcpPolicy),
      packageManagerPolicy:
        body.packageManagerPolicy ?? parseJson<Record<string, unknown>>(environment.packageManagerPolicy),
      resourceLimits: body.resourceLimits ?? parseJson<Record<string, unknown>>(environment.resourceLimits),
      runtimeImage: body.runtimeImage ?? parseJson<Record<string, unknown>>(environment.runtimeImage),
      metadata: body.metadata ?? parseJson<Record<string, unknown>>(environment.metadata),
    }
    const validation =
      (await validateSecretRefs(db, auth.organization.id, auth.project.id, next.secretRefs)) ??
      (await validateMcpPolicy(db, auth.project.id, next.mcpPolicy)) ??
      validateSecretFreeObjects(next)
    if (validation) {
      return c.json(domainValidation('Invalid environment configuration', validation), 400)
    }
    const timestamp = now()
    const runtimeChanged =
      body.packages !== undefined ||
      body.variables !== undefined ||
      body.secretRefs !== undefined ||
      body.networkPolicy !== undefined ||
      body.mcpPolicy !== undefined ||
      body.packageManagerPolicy !== undefined ||
      body.resourceLimits !== undefined ||
      body.runtimeImage !== undefined ||
      body.metadata !== undefined
    const version = runtimeChanged
      ? await createVersion(db, environment, { ...next, createdAt: timestamp })
      : await currentVersion(db, environment)
    const updated = {
      ...next,
      packages: stringify(next.packages),
      variables: stringify(next.variables),
      secretRefs: stringify(next.secretRefs),
      networkPolicy: stringify(next.networkPolicy),
      mcpPolicy: stringify(next.mcpPolicy),
      packageManagerPolicy: stringify(next.packageManagerPolicy),
      resourceLimits: stringify(next.resourceLimits),
      runtimeImage: stringify(next.runtimeImage),
      metadata: stringify(next.metadata),
      currentVersionId: version?.id ?? environment.currentVersionId,
      updatedAt: timestamp,
    }
    await db
      .update(environments)
      .set(updated)
      .where(and(eq(environments.id, environmentId), eq(environments.projectId, auth.project.id)))
    return c.json(serializeEnvironment({ ...environment, ...updated }, version), 200)
  })
  .openapi(archiveRoute, async (c) => {
    const { environmentId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const environment = await findEnvironment(db, environmentId, auth.project.id)
    if (!environment) {
      return c.json({ error: { type: 'not_found', message: 'Environment not found' } }, 404)
    }

    const timestamp = now()
    await db
      .update(environments)
      .set({ status: 'archived', archivedAt: timestamp, updatedAt: timestamp })
      .where(and(eq(environments.id, environmentId), eq(environments.projectId, auth.project.id)))
    await recordAudit(db, {
      auth,
      action: 'environment.archive',
      resourceType: 'environment',
      resourceId: environmentId,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeEnvironment(environment, await currentVersion(db, environment)),
      after: { status: 'archived', archivedAt: timestamp },
    })
    return c.body(null, 204)
  })
  .openapi(versionsRoute, async (c) => {
    const { environmentId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const environment = await findEnvironment(db, environmentId, auth.project.id)
    if (!environment) {
      return c.json({ error: { type: 'not_found', message: 'Environment not found' } }, 404)
    }

    const rows = await db
      .select()
      .from(environmentVersions)
      .where(
        and(eq(environmentVersions.environmentId, environmentId), eq(environmentVersions.projectId, auth.project.id)),
      )
      .orderBy(desc(environmentVersions.version))
    return c.json(
      {
        data: rows.map(serializeVersion),
        pagination: {
          limit: rows.length,
          nextCursor: null,
          hasMore: false,
          firstId: rows[0]?.id ?? null,
          lastId: rows.at(-1)?.id ?? null,
        },
      },
      200,
    )
  })

export default routes
