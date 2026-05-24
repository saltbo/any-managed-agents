import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, redactSecrets, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { providerConfigs, providerModels } from '../db/schema'
import { errorResponse } from '../errors'
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

const PROVIDER_TYPES = ['workers-ai', 'anthropic', 'openai', 'openai-compatible', 'ollama', 'other'] as const
const PROVIDER_STATUSES = ['active', 'disabled', 'deleted'] as const
const MODEL_AVAILABILITY = ['available', 'unavailable', 'disabled'] as const

const JsonObjectSchema = z.record(z.string(), z.unknown())

const ProviderSchema = z
  .object({
    id: z.string().openapi({ example: 'workers-ai' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    type: z.enum(PROVIDER_TYPES).openapi({ example: 'workers-ai' }),
    displayName: z.string().openapi({ example: 'Workers AI' }),
    baseUrl: z.string().nullable().openapi({ example: 'https://api.openai.com/v1' }),
    isDefault: z.boolean().openapi({ example: true }),
    status: z.enum(PROVIDER_STATUSES).openapi({ example: 'active' }),
    hasCredential: z.boolean().openapi({ example: true }),
    credentialStatus: z.enum(['not_required', 'configured', 'missing']).openapi({ example: 'not_required' }),
    metadata: JsonObjectSchema.openapi({ example: { accountId: 'cf-account-ref' } }),
    rateLimits: JsonObjectSchema.openapi({ example: { requestsPerMinute: 120 } }),
    budgetPolicy: JsonObjectSchema.openapi({ example: { monthlyCostMicros: 1000000 } }),
    modelCatalogStatus: z.string().openapi({ example: 'ready' }),
    lastError: JsonObjectSchema.nullable().openapi({ example: { type: 'network_error', retryable: true } }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Provider')

const ProviderModelSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    displayName: z.string(),
    capabilities: z.array(z.string()),
    contextWindow: z.number().int().nullable(),
    pricing: JsonObjectSchema,
    availability: z.enum(MODEL_AVAILABILITY),
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ProviderModel')

const ProviderPayloadSchema = z.object({
  type: z.enum(PROVIDER_TYPES).openapi({ example: 'workers-ai' }),
  displayName: z.string().min(1).max(120).openapi({ example: 'Workers AI' }),
  baseUrl: z.string().url().optional().openapi({ example: 'https://api.example.com/v1' }),
  isDefault: z.boolean().optional().openapi({ example: true }),
  credentialSecretRef: z.string().min(1).max(240).optional().openapi({ example: 'secret://providers/openai' }),
  metadata: JsonObjectSchema.optional().openapi({ example: { accountId: 'cf-account-ref' } }),
  rateLimits: JsonObjectSchema.optional().openapi({ example: { requestsPerMinute: 120 } }),
  budgetPolicy: JsonObjectSchema.optional().openapi({ example: { monthlyCostMicros: 1000000 } }),
})
const CreateProviderSchema = ProviderPayloadSchema.openapi('CreateProviderRequest')
const UpdateProviderSchema = ProviderPayloadSchema.partial()
  .extend({
    status: z.enum(['active', 'disabled']).optional().openapi({ example: 'disabled' }),
    modelCatalogStatus: z.string().optional().openapi({ example: 'error' }),
    lastError: JsonObjectSchema.nullable()
      .optional()
      .openapi({ example: { type: 'authentication_error' } }),
  })
  .openapi('UpdateProviderRequest')

const ProviderModelPayloadSchema = z
  .object({
    modelId: z.string().min(1).max(240).openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    displayName: z.string().min(1).max(240).openapi({ example: 'Kimi K2.6' }),
    capabilities: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .openapi({ example: ['text'] }),
    contextWindow: z.number().int().positive().optional().openapi({ example: 128000 }),
    pricing: JsonObjectSchema.optional().openapi({ example: { inputMicrosPerToken: 1 } }),
    availability: z.enum(MODEL_AVAILABILITY).optional().openapi({ example: 'available' }),
    metadata: JsonObjectSchema.optional().openapi({ example: { family: 'kimi' } }),
  })
  .openapi('UpsertProviderModelRequest')

const ParamsSchema = z.object({
  providerId: z.string().openapi({ param: { name: 'providerId', in: 'path' }, example: 'workers-ai' }),
})
const ListQuerySchema = listQuerySchema(PROVIDER_STATUSES)
const ProviderListResponseSchema = listResponseSchema('ProviderListResponse', ProviderSchema)
const ProviderModelListResponseSchema = listResponseSchema('ProviderModelListResponse', ProviderModelSchema)

type ProviderRow = typeof providerConfigs.$inferSelect
type ProviderModelRow = typeof providerModels.$inferSelect

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function parseJson<T>(value: string | null, fallback: T) {
  return value ? (JSON.parse(value) as T) : fallback
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

function providerCredentialStatus(row: Pick<ProviderRow, 'type' | 'credentialSecretRef'>) {
  if (row.type === 'workers-ai' || row.type === 'ollama') {
    return row.credentialSecretRef ? ('configured' as const) : ('not_required' as const)
  }
  return row.credentialSecretRef ? ('configured' as const) : ('missing' as const)
}

function serializeProvider(row: ProviderRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as (typeof PROVIDER_TYPES)[number],
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    isDefault: row.isDefault,
    status: row.status as (typeof PROVIDER_STATUSES)[number],
    hasCredential: Boolean(row.credentialSecretRef),
    credentialStatus: providerCredentialStatus(row),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    rateLimits: parseJson<Record<string, unknown>>(row.rateLimits, {}),
    budgetPolicy: parseJson<Record<string, unknown>>(row.budgetPolicy, {}),
    modelCatalogStatus: row.modelCatalogStatus,
    lastError: parseJson<Record<string, unknown> | null>(row.lastError, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeModel(row: ProviderModelRow) {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    displayName: row.displayName,
    capabilities: parseJson<string[]>(row.capabilities, []),
    contextWindow: row.contextWindow,
    pricing: parseJson<Record<string, unknown>>(row.pricing, {}),
    availability: row.availability as (typeof MODEL_AVAILABILITY)[number],
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function findProvider(db: ReturnType<typeof drizzle>, projectId: string, providerId: string) {
  return (
    (await db
      .select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.id, providerId), eq(providerConfigs.projectId, projectId)))
      .get()) ?? null
  )
}

async function defaultProviderRows(projectId: string, timestamp: string) {
  const row: ProviderRow = {
    id: 'workers-ai',
    organizationId: '',
    projectId,
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    status: 'active',
    credentialSecretRef: null,
    metadata: stringify({ platformDefault: true }),
    rateLimits: stringify({}),
    budgetPolicy: stringify({}),
    modelCatalogStatus: 'ready',
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return row
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listProviders',
  tags: ['Providers'],
  summary: 'List providers',
  ...AuthenticatedOperation,
  request: { query: ListQuerySchema },
  responses: {
    200: { description: 'Provider list', content: { 'application/json': { schema: ProviderListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createProviderRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createProvider',
  tags: ['Providers'],
  summary: 'Create a provider',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateProviderSchema } } } },
  responses: {
    201: { description: 'Created provider', content: { 'application/json': { schema: ProviderSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{providerId}',
  operationId: 'readProvider',
  tags: ['Providers'],
  summary: 'Read a provider',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: { description: 'Provider', content: { 'application/json': { schema: ProviderSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{providerId}',
  operationId: 'updateProvider',
  tags: ['Providers'],
  summary: 'Update a provider',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateProviderSchema } } },
  },
  responses: {
    200: { description: 'Updated provider', content: { 'application/json': { schema: ProviderSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{providerId}',
  operationId: 'deleteProvider',
  tags: ['Providers'],
  summary: 'Delete a provider',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    204: { description: 'Provider deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const listModelsRoute = createRoute({
  method: 'get',
  path: '/{providerId}/models',
  operationId: 'listProviderModels',
  tags: ['Providers'],
  summary: 'List provider models',
  ...AuthenticatedOperation,
  request: { params: ParamsSchema },
  responses: {
    200: {
      description: 'Provider models',
      content: { 'application/json': { schema: ProviderModelListResponseSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const upsertModelRoute = createRoute({
  method: 'post',
  path: '/{providerId}/models',
  operationId: 'upsertProviderModel',
  tags: ['Providers'],
  summary: 'Upsert provider model metadata',
  ...AuthenticatedOperation,
  request: {
    params: ParamsSchema,
    body: { required: true, content: { 'application/json': { schema: ProviderModelPayloadSchema } } },
  },
  responses: {
    201: { description: 'Provider model', content: { 'application/json': { schema: ProviderModelSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

app.openapi(listRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth

  const { includeArchived, status, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
  let parsedCursor: ReturnType<typeof parseListCursor> | null = null
  try {
    parsedCursor = cursor ? parseListCursor(cursor) : null
  } catch {
    return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
      fields: { cursor: 'Cursor is invalid.' },
    })
  }
  const statusFilter = status ?? (includeArchived === 'true' ? undefined : 'active')
  const filters = [
    eq(providerConfigs.projectId, auth.project.id),
    statusFilter ? eq(providerConfigs.status, statusFilter) : undefined,
    search ? like(providerConfigs.displayName, `%${search}%`) : undefined,
    createdFrom ? gte(providerConfigs.createdAt, createdFrom) : undefined,
    createdTo ? lte(providerConfigs.createdAt, createdTo) : undefined,
    parsedCursor
      ? or(
          lt(providerConfigs.createdAt, parsedCursor.createdAt),
          and(eq(providerConfigs.createdAt, parsedCursor.createdAt), lt(providerConfigs.id, parsedCursor.id)),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  const configuredRows = await db
    .select()
    .from(providerConfigs)
    .where(and(...filters))
    .orderBy(desc(providerConfigs.createdAt), desc(providerConfigs.id))
    .limit(limit + 1)
  const rows =
    configuredRows.length === 0 && !status && !search && !createdFrom && !createdTo && !cursor
      ? [await defaultProviderRows(auth.project.id, now())]
      : configuredRows
  const page = paginateRows(rows, limit)
  return c.json({ data: page.data.map(serializeProvider), pagination: page.pagination }, 200)
})

app.openapi(createProviderRoute, async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  if (body.type === 'openai-compatible' && !body.baseUrl) {
    return errorResponse(c, 400, 'validation_error', 'Invalid provider configuration', {
      fields: { baseUrl: 'OpenAI-compatible providers require a base URL.' },
    })
  }

  const timestamp = now()
  if (body.isDefault) {
    await db
      .update(providerConfigs)
      .set({ isDefault: false, updatedAt: timestamp })
      .where(and(eq(providerConfigs.projectId, auth.project.id), eq(providerConfigs.isDefault, true)))
  }
  const row = {
    id: newId('provider'),
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    type: body.type,
    displayName: body.displayName,
    baseUrl: body.baseUrl ?? null,
    isDefault: body.isDefault ?? false,
    status: 'active',
    credentialSecretRef: body.credentialSecretRef ?? null,
    metadata: stringify(redactSecrets(body.metadata ?? {})),
    rateLimits: stringify(body.rateLimits ?? {}),
    budgetPolicy: stringify(body.budgetPolicy ?? {}),
    modelCatalogStatus: 'ready',
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.insert(providerConfigs).values(row)
  await recordAudit(db, {
    auth,
    action: 'provider.create',
    resourceType: 'provider',
    resourceId: row.id,
    outcome: 'success',
    requestId: requestId(c),
    after: serializeProvider(row),
  })
  return c.json(serializeProvider(row), 201)
})

app.openapi(readRoute, async (c) => {
  const { providerId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const provider = await findProvider(db, auth.project.id, providerId)
  if (!provider && providerId !== 'workers-ai') return errorResponse(c, 404, 'not_found', 'Provider not found')
  return c.json(serializeProvider(provider ?? (await defaultProviderRows(auth.project.id, now()))), 200)
})

app.openapi(updateRoute, async (c) => {
  const { providerId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const provider = await findProvider(db, auth.project.id, providerId)
  if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
  const timestamp = now()
  if (body.isDefault) {
    await db
      .update(providerConfigs)
      .set({ isDefault: false, updatedAt: timestamp })
      .where(and(eq(providerConfigs.projectId, auth.project.id), eq(providerConfigs.isDefault, true)))
  }
  const updated = {
    type: body.type ?? provider.type,
    displayName: body.displayName ?? provider.displayName,
    baseUrl: body.baseUrl ?? provider.baseUrl,
    isDefault: body.isDefault ?? provider.isDefault,
    status: body.status ?? provider.status,
    credentialSecretRef: body.credentialSecretRef ?? provider.credentialSecretRef,
    metadata: stringify(redactSecrets(body.metadata ?? parseJson<Record<string, unknown>>(provider.metadata, {}))),
    rateLimits: stringify(body.rateLimits ?? parseJson<Record<string, unknown>>(provider.rateLimits, {})),
    budgetPolicy: stringify(body.budgetPolicy ?? parseJson<Record<string, unknown>>(provider.budgetPolicy, {})),
    modelCatalogStatus: body.modelCatalogStatus ?? provider.modelCatalogStatus,
    lastError: body.lastError === undefined ? provider.lastError : stringify(body.lastError),
    updatedAt: timestamp,
  }
  await db
    .update(providerConfigs)
    .set(updated)
    .where(and(eq(providerConfigs.id, providerId), eq(providerConfigs.projectId, auth.project.id)))
  const row = { ...provider, ...updated }
  await recordAudit(db, {
    auth,
    action: 'provider.update',
    resourceType: 'provider',
    resourceId: providerId,
    outcome: 'success',
    requestId: requestId(c),
    before: serializeProvider(provider),
    after: serializeProvider(row),
  })
  return c.json(serializeProvider(row), 200)
})

app.openapi(deleteRoute, async (c) => {
  const { providerId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const provider = await findProvider(db, auth.project.id, providerId)
  if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
  await db
    .update(providerConfigs)
    .set({ status: 'deleted', isDefault: false, updatedAt: now() })
    .where(and(eq(providerConfigs.id, providerId), eq(providerConfigs.projectId, auth.project.id)))
  await recordAudit(db, {
    auth,
    action: 'provider.delete',
    resourceType: 'provider',
    resourceId: providerId,
    outcome: 'success',
    requestId: requestId(c),
    before: serializeProvider(provider),
  })
  return c.body(null, 204)
})

app.openapi(listModelsRoute, async (c) => {
  const { providerId } = c.req.valid('param')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const provider = await findProvider(db, auth.project.id, providerId)
  if (!provider && providerId !== 'workers-ai') return errorResponse(c, 404, 'not_found', 'Provider not found')
  const rows = await db
    .select()
    .from(providerModels)
    .where(and(eq(providerModels.projectId, auth.project.id), eq(providerModels.providerId, providerId)))
    .orderBy(providerModels.modelId)
  const data =
    rows.length === 0 && providerId === 'workers-ai'
      ? [
          {
            id: 'model_workers_ai_default',
            organizationId: auth.organization.id,
            projectId: auth.project.id,
            providerId: 'workers-ai',
            modelId: c.env.AMA_DEFAULT_MODEL ?? '@cf/moonshotai/kimi-k2.6',
            displayName: 'Workers AI default model',
            capabilities: stringify(['text']),
            contextWindow: null,
            pricing: stringify({}),
            availability: 'available',
            metadata: stringify({ platformDefault: true }),
            createdAt: now(),
            updatedAt: now(),
          } satisfies ProviderModelRow,
        ]
      : rows
  const page = paginateRows(data, data.length || 1)
  return c.json({ data: page.data.map(serializeModel), pagination: page.pagination }, 200)
})

app.openapi(upsertModelRoute, async (c) => {
  const { providerId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (auth instanceof Response) return auth
  const provider = await findProvider(db, auth.project.id, providerId)
  if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
  const timestamp = now()
  const existing = await db
    .select()
    .from(providerModels)
    .where(
      and(
        eq(providerModels.projectId, auth.project.id),
        eq(providerModels.providerId, providerId),
        eq(providerModels.modelId, body.modelId),
      ),
    )
    .get()
  const values = {
    organizationId: auth.organization.id,
    projectId: auth.project.id,
    providerId,
    modelId: body.modelId,
    displayName: body.displayName,
    capabilities: stringify(body.capabilities ?? []),
    contextWindow: body.contextWindow ?? null,
    pricing: stringify(body.pricing ?? {}),
    availability: body.availability ?? 'available',
    metadata: stringify(body.metadata ?? {}),
    updatedAt: timestamp,
  }
  const row = existing
    ? { ...existing, ...values }
    : {
        id: newId('model'),
        ...values,
        createdAt: timestamp,
      }
  if (existing) {
    await db
      .update(providerModels)
      .set(values)
      .where(and(eq(providerModels.id, existing.id), eq(providerModels.projectId, auth.project.id)))
  } else {
    await db.insert(providerModels).values(row)
  }
  await recordAudit(db, {
    auth,
    action: 'provider_model.upsert',
    resourceType: 'provider_model',
    resourceId: row.id,
    outcome: 'success',
    requestId: requestId(c),
    after: serializeModel(row),
  })
  return c.json(serializeModel(row), 201)
})

export default app
