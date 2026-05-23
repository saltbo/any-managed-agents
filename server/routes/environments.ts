import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth } from '../auth/session'
import { environments, environmentVersions } from '../db/schema'
import { createApiRouter, ErrorResponseSchema } from '../openapi'

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
    resourceLimits: JsonObjectSchema.openapi({ example: { memoryMb: 512 } }),
    runtimeImage: JsonObjectSchema.openapi({ example: { image: 'node:24' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
    status: z.enum(['active', 'archived']).openapi({ example: 'active' }),
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
const ListQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .openapi({ param: { name: 'includeArchived', in: 'query' }, example: 'false' }),
})

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
    resourceLimits: parseJson<Record<string, unknown>>(row.resourceLimits),
    runtimeImage: parseJson<Record<string, unknown>>(row.runtimeImage),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    status: row.status as 'active' | 'archived',
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
  tags: ['Environments'],
  summary: 'List environments',
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Environment list',
      content: { 'application/json': { schema: z.object({ data: z.array(EnvironmentSchema) }) } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createRouteConfig = createRoute({
  method: 'post',
  path: '/',
  tags: ['Environments'],
  summary: 'Create an environment',
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
  tags: ['Environments'],
  summary: 'Read an environment',
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
  tags: ['Environments'],
  summary: 'Update an environment',
  request: {
    params: EnvironmentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateEnvironmentSchema } } },
  },
  responses: {
    200: { description: 'Updated environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const archiveRoute = createRoute({
  method: 'delete',
  path: '/{environmentId}',
  tags: ['Environments'],
  summary: 'Archive an environment',
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
  tags: ['Environments'],
  summary: 'List environment versions',
  request: { params: EnvironmentParamsSchema },
  responses: {
    200: {
      description: 'Environment versions',
      content: { 'application/json': { schema: z.object({ data: z.array(EnvironmentVersionSchema) }) } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

app.openapi(listRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) {
    return auth
  }

  const { includeArchived } = c.req.valid('query')
  const where =
    includeArchived === 'true'
      ? eq(environments.projectId, auth.project.id)
      : and(eq(environments.projectId, auth.project.id), eq(environments.status, 'active'))
  const rows = await db.select().from(environments).where(where).limit(100)
  const data = await Promise.all(rows.map(async (row) => serializeEnvironment(row, await currentVersion(db, row))))
  return c.json({ data }, 200)
})

app.openapi(createRouteConfig, async (c) => {
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
    resourceLimits: body.resourceLimits ?? {},
    runtimeImage: body.runtimeImage ?? {},
    metadata: body.metadata ?? {},
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
    resourceLimits: stringify(values.resourceLimits),
    runtimeImage: stringify(values.runtimeImage),
    metadata: stringify(values.metadata),
    status: 'active',
    currentVersionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.insert(environments).values(row)
  const version = await createVersion(db, row, { ...values, createdAt: timestamp })
  await db.update(environments).set({ currentVersionId: version.id }).where(eq(environments.id, row.id))
  return c.json(serializeEnvironment({ ...row, currentVersionId: version.id }, version), 201)
})

app.openapi(readRoute, async (c) => {
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

app.openapi(updateRoute, async (c) => {
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

  const next = {
    name: body.name ?? environment.name,
    description: body.description ?? environment.description,
    packages: body.packages ?? parseJson<Package[]>(environment.packages),
    variables: body.variables ?? parseJson<Record<string, Variable>>(environment.variables),
    secretRefs: body.secretRefs ?? parseJson<SecretRef[]>(environment.secretRefs),
    networkPolicy: body.networkPolicy ?? parseJson<Record<string, unknown>>(environment.networkPolicy),
    resourceLimits: body.resourceLimits ?? parseJson<Record<string, unknown>>(environment.resourceLimits),
    runtimeImage: body.runtimeImage ?? parseJson<Record<string, unknown>>(environment.runtimeImage),
    metadata: body.metadata ?? parseJson<Record<string, unknown>>(environment.metadata),
  }
  const timestamp = now()
  const runtimeChanged =
    body.packages !== undefined ||
    body.variables !== undefined ||
    body.secretRefs !== undefined ||
    body.networkPolicy !== undefined ||
    body.resourceLimits !== undefined ||
    body.runtimeImage !== undefined
  const version = runtimeChanged
    ? await createVersion(db, environment, { ...next, createdAt: timestamp })
    : await currentVersion(db, environment)
  const updated = {
    ...next,
    packages: stringify(next.packages),
    variables: stringify(next.variables),
    secretRefs: stringify(next.secretRefs),
    networkPolicy: stringify(next.networkPolicy),
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

app.openapi(archiveRoute, async (c) => {
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

  await db
    .update(environments)
    .set({ status: 'archived', updatedAt: now() })
    .where(and(eq(environments.id, environmentId), eq(environments.projectId, auth.project.id)))
  return c.body(null, 204)
})

app.openapi(versionsRoute, async (c) => {
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
  return c.json({ data: rows.map(serializeVersion) }, 200)
})

export default app
