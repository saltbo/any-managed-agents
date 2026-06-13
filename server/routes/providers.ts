import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, redactSecrets, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { agents, modelDiscoveryTasks, providerModels, providers } from '../db/schema'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  CredentialRefSchema,
  createApiRouter,
  ErrorResponseSchema,
  listQuerySchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'
import {
  type DiscoveredProviderModel,
  normalizeProviderError,
  parseProviderModelCatalog,
  providerFamily,
} from '../providers/adapters'

const app = createApiRouter()

const PROVIDER_TYPES = ['workers-ai', 'anthropic', 'openai', 'openai-compatible', 'ollama', 'other'] as const
const MODEL_AVAILABILITY = ['available', 'unavailable', 'disabled'] as const
const DISCOVERY_TASK_STATES = ['pending', 'running', 'succeeded', 'failed'] as const

const JsonObjectSchema = z.record(z.string(), z.unknown())

const ProviderSchema = z
  .object({
    id: z.string().openapi({ example: 'workers-ai' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    type: z.enum(PROVIDER_TYPES).openapi({ example: 'workers-ai' }),
    displayName: z.string().openapi({ example: 'Workers AI' }),
    baseUrl: z.string().nullable().openapi({ example: 'https://api.openai.com/v1' }),
    isDefault: z.boolean().openapi({ example: true }),
    enabled: z.boolean().openapi({ example: true }),
    credentialRef: CredentialRefSchema.nullable().openapi({
      description: 'Vault credential reference used as the provider API key, or null when none is configured.',
    }),
    credentialStatus: z.enum(['not_required', 'configured', 'missing']).openapi({ example: 'not_required' }),
    metadata: JsonObjectSchema.openapi({ example: { accountId: 'cf-account-ref' } }),
    rateLimits: JsonObjectSchema.openapi({ example: { requestsPerMinute: 120 } }),
    budgetPolicy: JsonObjectSchema.openapi({ example: { monthlyCostMicros: 1000000 } }),
    modelCatalogState: z.string().openapi({ example: 'ready' }),
    lastError: JsonObjectSchema.nullable().openapi({ example: { type: 'provider_error', retryable: true } }),
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

const ModelDiscoveryTaskSchema = z
  .object({
    id: z.string().openapi({ example: 'mdtask_abc123' }),
    providerId: z.string().openapi({ example: 'provider_abc123' }),
    state: z.enum(DISCOVERY_TASK_STATES).openapi({ example: 'succeeded' }),
    discoveredCount: z.number().int().nullable().openapi({ example: 12 }),
    error: JsonObjectSchema.nullable().openapi({
      example: { type: 'provider_error', category: 'network', retryable: true },
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ModelDiscoveryTask')

const ProviderPayloadSchema = z.object({
  type: z.enum(PROVIDER_TYPES).openapi({ example: 'workers-ai' }),
  displayName: z.string().min(1).max(120).openapi({ example: 'Workers AI' }),
  baseUrl: z.string().url().optional().openapi({ example: 'https://api.example.com/v1' }),
  isDefault: z.boolean().optional().openapi({ example: true }),
  credentialRef: CredentialRefSchema.nullable().optional().openapi({
    description: 'Vault credential reference dispatched to session runtimes as the provider API key.',
  }),
  metadata: JsonObjectSchema.optional().openapi({ example: { accountId: 'cf-account-ref' } }),
  rateLimits: JsonObjectSchema.optional().openapi({ example: { requestsPerMinute: 120 } }),
  budgetPolicy: JsonObjectSchema.optional().openapi({ example: { monthlyCostMicros: 1000000 } }),
})
const CreateProviderSchema = ProviderPayloadSchema.openapi('CreateProviderRequest')
const UpdateProviderSchema = ProviderPayloadSchema.partial()
  .extend({
    enabled: z.boolean().optional().openapi({ example: false }),
  })
  .openapi('UpdateProviderRequest')

const UpsertProviderModelSchema = z
  .object({
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

const ProviderParamsSchema = z.object({
  providerId: z.string().openapi({ param: { name: 'providerId', in: 'path' }, example: 'workers-ai' }),
})
const ModelParamsSchema = ProviderParamsSchema.extend({
  modelId: z
    .string()
    .min(1)
    .max(240)
    .openapi({
      param: { name: 'modelId', in: 'path' },
      description: 'Provider model id. Ids containing slashes (e.g. @cf/…) must be URL-encoded.',
      example: '@cf%2Fmoonshotai%2Fkimi-k2.6',
    }),
})
const TaskParamsSchema = ProviderParamsSchema.extend({
  taskId: z.string().openapi({ param: { name: 'taskId', in: 'path' }, example: 'mdtask_abc123' }),
})

const ListQuerySchema = listQuerySchema()
const ProviderListResponseSchema = listResponseSchema('ProviderListResponse', ProviderSchema)
const ProviderModelListResponseSchema = listResponseSchema('ProviderModelListResponse', ProviderModelSchema)

type ProviderRow = typeof providers.$inferSelect
type ProviderModelRow = typeof providerModels.$inferSelect
type ModelDiscoveryTaskRow = typeof modelDiscoveryTasks.$inferSelect

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

function providerCredentialStatus(row: Pick<ProviderRow, 'type' | 'credentialId'>) {
  if (row.type === 'workers-ai' || row.type === 'ollama') {
    return row.credentialId ? ('configured' as const) : ('not_required' as const)
  }
  return row.credentialId ? ('configured' as const) : ('missing' as const)
}

function serializeProvider(row: ProviderRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as (typeof PROVIDER_TYPES)[number],
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    isDefault: row.isDefault,
    enabled: row.enabled,
    credentialRef: row.credentialId
      ? { credentialId: row.credentialId, ...(row.credentialVersionId ? { versionId: row.credentialVersionId } : {}) }
      : null,
    credentialStatus: providerCredentialStatus(row),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    rateLimits: parseJson<Record<string, unknown>>(row.rateLimits, {}),
    budgetPolicy: parseJson<Record<string, unknown>>(row.budgetPolicy, {}),
    modelCatalogState: row.modelCatalogState,
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

function serializeTask(row: ModelDiscoveryTaskRow) {
  return {
    id: row.id,
    providerId: row.providerId,
    state: row.state as (typeof DISCOVERY_TASK_STATES)[number],
    discoveredCount: row.discoveredCount,
    error: parseJson<Record<string, unknown> | null>(row.error, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function findProvider(db: ReturnType<typeof drizzle>, projectId: string, providerId: string) {
  return (
    (await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, providerId), eq(providers.projectId, projectId)))
      .get()) ?? null
  )
}

// Platform-default Workers AI: a synthesized read-only row that exists until
// the project configures its own providers. Write operations require a real
// provider row.
function defaultProviderRow(projectId: string, timestamp: string): ProviderRow {
  return {
    id: 'workers-ai',
    organizationId: '',
    projectId,
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    enabled: true,
    credentialId: null,
    credentialVersionId: null,
    metadata: stringify({ platformDefault: true }),
    rateLimits: stringify({}),
    budgetPolicy: stringify({}),
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const FAMILY_DEFAULT_BASE_URLS: Record<string, string | undefined> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://127.0.0.1:11434',
}

const DISCOVERY_TIMEOUT_MS = 10_000

function workersAiCatalog(defaultModel: string | undefined): DiscoveredProviderModel[] {
  return [
    {
      modelId: defaultModel ?? '@cf/moonshotai/kimi-k2.6',
      displayName: 'Workers AI default model',
      capabilities: ['text'],
      contextWindow: null,
      pricing: {},
      availability: 'available',
      metadata: { source: 'workers-ai-binding' },
    },
  ]
}

// Fetches the provider's model list. Discovery never sends or echoes stored
// credential references; failures bubble raw and are normalized by the
// caller so responses stay credential-free.
async function fetchProviderModelCatalog(provider: Pick<ProviderRow, 'type' | 'baseUrl'>) {
  const family = providerFamily(provider.type)
  const baseUrl = (provider.baseUrl ?? FAMILY_DEFAULT_BASE_URLS[family])?.replace(/\/$/, '')
  if (!baseUrl) {
    throw new Error('invalid request: provider base URL is required for model discovery')
  }
  const url = family === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw Object.assign(new Error(`provider model discovery returned HTTP ${response.status}`), {
      status: response.status,
    })
  }
  return parseProviderModelCatalog(family, await response.json())
}

async function clearOtherDefaults(db: ReturnType<typeof drizzle>, projectId: string, timestamp: string) {
  await db
    .update(providers)
    .set({ isDefault: false, updatedAt: timestamp })
    .where(and(eq(providers.projectId, projectId), eq(providers.isDefault, true)))
}

type CredentialRefInput = z.infer<typeof CredentialRefSchema> | null | undefined

function credentialColumns(ref: CredentialRefInput) {
  if (ref === undefined) {
    return null
  }
  return {
    credentialId: ref?.credentialId ?? null,
    credentialVersionId: ref?.versionId ?? null,
  }
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
  request: { params: ProviderParamsSchema },
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
    params: ProviderParamsSchema,
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
  description:
    'Permanently deletes the provider and its model catalog. Fails with 409 while agents still reference the provider.',
  ...AuthenticatedOperation,
  request: { params: ProviderParamsSchema },
  responses: {
    204: { description: 'Provider deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'Provider is still referenced',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listModelsRoute = createRoute({
  method: 'get',
  path: '/{providerId}/models',
  operationId: 'listProviderModels',
  tags: ['Providers'],
  summary: 'List provider models',
  ...AuthenticatedOperation,
  request: { params: ProviderParamsSchema },
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
  method: 'put',
  path: '/{providerId}/models/{modelId}',
  operationId: 'upsertProviderModel',
  tags: ['Providers'],
  summary: 'Create or replace provider model metadata',
  description: 'Idempotent full replacement keyed by model id. Omitted optional fields reset to their defaults.',
  ...AuthenticatedOperation,
  request: {
    params: ModelParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpsertProviderModelSchema } } },
  },
  responses: {
    200: { description: 'Updated provider model', content: { 'application/json': { schema: ProviderModelSchema } } },
    201: { description: 'Created provider model', content: { 'application/json': { schema: ProviderModelSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteModelRoute = createRoute({
  method: 'delete',
  path: '/{providerId}/models/{modelId}',
  operationId: 'deleteProviderModel',
  tags: ['Providers'],
  summary: 'Delete a provider model',
  ...AuthenticatedOperation,
  request: { params: ModelParamsSchema },
  responses: {
    204: { description: 'Provider model deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Provider or model not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const createDiscoveryTaskRoute = createRoute({
  method: 'post',
  path: '/{providerId}/model-discovery-tasks',
  operationId: 'createModelDiscoveryTask',
  tags: ['Providers'],
  summary: 'Create a model discovery task',
  description:
    'Refreshes the model catalog from the provider. The task executes synchronously: the response carries the ' +
    'final task state (succeeded or failed). Discovery never sends or echoes stored credential references.',
  ...AuthenticatedOperation,
  request: { params: ProviderParamsSchema },
  responses: {
    201: {
      description: 'Model discovery task (terminal state)',
      headers: z.object({ Location: z.string().openapi({ description: 'URL of the created task' }) }),
      content: { 'application/json': { schema: ModelDiscoveryTaskSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const readDiscoveryTaskRoute = createRoute({
  method: 'get',
  path: '/{providerId}/model-discovery-tasks/{taskId}',
  operationId: 'readModelDiscoveryTask',
  tags: ['Providers'],
  summary: 'Read a model discovery task',
  ...AuthenticatedOperation,
  request: { params: TaskParamsSchema },
  responses: {
    200: {
      description: 'Model discovery task',
      content: { 'application/json': { schema: ModelDiscoveryTaskSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Provider or task not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const routes = app
  .openapi(listRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth

    const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
    // Providers have no archived lifecycle (DELETE is permanent), so the
    // archived=true slice of the standard list contract is always empty.
    if (archived === 'true') {
      return c.json({ data: [], pagination: { limit, nextCursor: null, hasMore: false } }, 200)
    }
    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = cursor ? parseListCursor(cursor) : null
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        fields: { cursor: 'Cursor is invalid.' },
      })
    }
    const filters = [
      eq(providers.projectId, auth.project.id),
      search ? like(providers.displayName, `%${search}%`) : undefined,
      createdFrom ? gte(providers.createdAt, createdFrom) : undefined,
      createdTo ? lte(providers.createdAt, createdTo) : undefined,
      parsedCursor
        ? or(
            lt(providers.createdAt, parsedCursor.createdAt),
            and(eq(providers.createdAt, parsedCursor.createdAt), lt(providers.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)
    const configuredRows = await db
      .select()
      .from(providers)
      .where(and(...filters))
      .orderBy(desc(providers.createdAt), desc(providers.id))
      .limit(limit + 1)
    const rows =
      configuredRows.length === 0 && !search && !createdFrom && !createdTo && !cursor
        ? [defaultProviderRow(auth.project.id, now())]
        : configuredRows
    const page = paginateRows(rows, limit)
    return c.json({ data: page.data.map(serializeProvider), pagination: page.pagination }, 200)
  })
  .openapi(createProviderRoute, async (c) => {
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
      await clearOtherDefaults(db, auth.project.id, timestamp)
    }
    const row = {
      id: newId('provider'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      type: body.type,
      displayName: body.displayName,
      baseUrl: body.baseUrl ?? null,
      isDefault: body.isDefault ?? false,
      enabled: true,
      credentialId: body.credentialRef?.credentialId ?? null,
      credentialVersionId: body.credentialRef?.versionId ?? null,
      metadata: stringify(redactSecrets(body.metadata ?? {})),
      rateLimits: stringify(body.rateLimits ?? {}),
      budgetPolicy: stringify(body.budgetPolicy ?? {}),
      modelCatalogState: 'ready',
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(providers).values(row)
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
  .openapi(readRoute, async (c) => {
    const { providerId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const provider = await findProvider(db, auth.project.id, providerId)
    if (!provider && providerId !== 'workers-ai') return errorResponse(c, 404, 'not_found', 'Provider not found')
    return c.json(serializeProvider(provider ?? defaultProviderRow(auth.project.id, now())), 200)
  })
  .openapi(updateRoute, async (c) => {
    const { providerId } = c.req.valid('param')
    const body = c.req.valid('json')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const provider = await findProvider(db, auth.project.id, providerId)
    if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
    const nextType = body.type ?? provider.type
    const nextBaseUrl = body.baseUrl ?? provider.baseUrl
    if (nextType === 'openai-compatible' && !nextBaseUrl) {
      return errorResponse(c, 400, 'validation_error', 'Invalid provider configuration', {
        fields: { baseUrl: 'OpenAI-compatible providers require a base URL.' },
      })
    }
    const timestamp = now()
    if (body.isDefault) {
      await clearOtherDefaults(db, auth.project.id, timestamp)
    }
    const credentials = credentialColumns(body.credentialRef)
    const updated = {
      type: nextType,
      displayName: body.displayName ?? provider.displayName,
      baseUrl: nextBaseUrl,
      isDefault: body.isDefault ?? provider.isDefault,
      enabled: body.enabled ?? provider.enabled,
      credentialId: credentials ? credentials.credentialId : provider.credentialId,
      credentialVersionId: credentials ? credentials.credentialVersionId : provider.credentialVersionId,
      metadata: stringify(redactSecrets(body.metadata ?? parseJson<Record<string, unknown>>(provider.metadata, {}))),
      rateLimits: stringify(body.rateLimits ?? parseJson<Record<string, unknown>>(provider.rateLimits, {})),
      budgetPolicy: stringify(body.budgetPolicy ?? parseJson<Record<string, unknown>>(provider.budgetPolicy, {})),
      updatedAt: timestamp,
    }
    await db
      .update(providers)
      .set(updated)
      .where(and(eq(providers.id, providerId), eq(providers.projectId, auth.project.id)))
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
  .openapi(deleteRoute, async (c) => {
    const { providerId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const provider = await findProvider(db, auth.project.id, providerId)
    if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
    const referencingAgent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.projectId, auth.project.id), eq(agents.providerId, providerId)))
      .get()
    if (referencingAgent) {
      return errorResponse(c, 409, 'conflict', 'Provider is referenced by agents and cannot be deleted', {
        fields: { providerId: 'Detach or archive agents using this provider first.' },
      })
    }
    await db
      .delete(modelDiscoveryTasks)
      .where(and(eq(modelDiscoveryTasks.projectId, auth.project.id), eq(modelDiscoveryTasks.providerId, providerId)))
    await db
      .delete(providerModels)
      .where(and(eq(providerModels.projectId, auth.project.id), eq(providerModels.providerId, providerId)))
    await db.delete(providers).where(and(eq(providers.id, providerId), eq(providers.projectId, auth.project.id)))
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
  .openapi(listModelsRoute, async (c) => {
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
  .openapi(upsertModelRoute, async (c) => {
    const { providerId, modelId } = c.req.valid('param')
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
          eq(providerModels.modelId, modelId),
        ),
      )
      .get()
    const values = {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      providerId,
      modelId,
      displayName: body.displayName,
      capabilities: stringify(body.capabilities ?? []),
      contextWindow: body.contextWindow ?? null,
      pricing: stringify(body.pricing ?? {}),
      availability: body.availability ?? 'available',
      metadata: stringify(body.metadata ?? {}),
      updatedAt: timestamp,
    }
    const row = existing ? { ...existing, ...values } : { id: newId('model'), ...values, createdAt: timestamp }
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
      metadata: { created: !existing },
      after: serializeModel(row),
    })
    return c.json(serializeModel(row), existing ? 200 : 201)
  })
  .openapi(deleteModelRoute, async (c) => {
    const { providerId, modelId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const provider = await findProvider(db, auth.project.id, providerId)
    if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
    const existing = await db
      .select()
      .from(providerModels)
      .where(
        and(
          eq(providerModels.projectId, auth.project.id),
          eq(providerModels.providerId, providerId),
          eq(providerModels.modelId, modelId),
        ),
      )
      .get()
    if (!existing) return errorResponse(c, 404, 'not_found', 'Provider model not found')
    await db
      .delete(providerModels)
      .where(and(eq(providerModels.id, existing.id), eq(providerModels.projectId, auth.project.id)))
    await recordAudit(db, {
      auth,
      action: 'provider_model.delete',
      resourceType: 'provider_model',
      resourceId: existing.id,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeModel(existing),
    })
    return c.body(null, 204)
  })
  .openapi(createDiscoveryTaskRoute, async (c) => {
    const { providerId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    // Discovery tasks are persisted rows referencing the provider, so the
    // synthesized platform-default Workers AI (no DB row) cannot host them.
    const provider = await findProvider(db, auth.project.id, providerId)
    if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')

    const createdAt = now()
    const task: ModelDiscoveryTaskRow = {
      id: newId('mdtask'),
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      providerId: provider.id,
      state: 'running',
      discoveredCount: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
    }
    await db.insert(modelDiscoveryTasks).values(task)
    const location = `/api/v1/providers/${provider.id}/model-discovery-tasks/${task.id}`

    let discovered: DiscoveredProviderModel[]
    try {
      discovered =
        provider.type === 'workers-ai'
          ? workersAiCatalog(c.env.AMA_DEFAULT_MODEL)
          : await fetchProviderModelCatalog(provider)
    } catch (error) {
      // Normalized failure path: the stored configuration stays readable and
      // the task carries only the stable category, never raw provider
      // payloads or credential references.
      const failedAt = now()
      const normalized = normalizeProviderError(providerFamily(provider.type), error)
      const lastError = {
        type: 'provider_error',
        category: normalized.category,
        message: normalized.message,
        retryable: normalized.retryable,
        ...(normalized.retryAfterSeconds !== undefined ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
        occurredAt: failedAt,
      }
      await db
        .update(providers)
        .set({ modelCatalogState: 'error', lastError: stringify(lastError), updatedAt: failedAt })
        .where(and(eq(providers.id, provider.id), eq(providers.projectId, auth.project.id)))
      const failedTask = { ...task, state: 'failed', error: stringify(lastError), updatedAt: failedAt }
      await db
        .update(modelDiscoveryTasks)
        .set({ state: failedTask.state, error: failedTask.error, updatedAt: failedTask.updatedAt })
        .where(and(eq(modelDiscoveryTasks.id, task.id), eq(modelDiscoveryTasks.projectId, auth.project.id)))
      await recordAudit(db, {
        auth,
        action: 'model_discovery_task.create',
        resourceType: 'model_discovery_task',
        resourceId: task.id,
        outcome: 'failure',
        requestId: requestId(c),
        metadata: { providerId: provider.id, category: normalized.category, retryable: normalized.retryable },
      })
      return c.json(serializeTask(failedTask), 201, { Location: location })
    }

    const upsertedAt = now()
    for (const model of discovered) {
      const existing = await db
        .select()
        .from(providerModels)
        .where(
          and(
            eq(providerModels.projectId, auth.project.id),
            eq(providerModels.providerId, provider.id),
            eq(providerModels.modelId, model.modelId),
          ),
        )
        .get()
      const values = {
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        providerId: provider.id,
        modelId: model.modelId,
        displayName: model.displayName,
        capabilities: stringify(model.capabilities),
        contextWindow: model.contextWindow,
        pricing: stringify(model.pricing),
        availability: model.availability,
        metadata: stringify(model.metadata),
        updatedAt: upsertedAt,
      }
      if (existing) {
        await db
          .update(providerModels)
          .set(values)
          .where(and(eq(providerModels.id, existing.id), eq(providerModels.projectId, auth.project.id)))
      } else {
        await db.insert(providerModels).values({ id: newId('model'), ...values, createdAt: upsertedAt })
      }
    }
    await db
      .update(providers)
      .set({ modelCatalogState: 'ready', lastError: null, updatedAt: upsertedAt })
      .where(and(eq(providers.id, provider.id), eq(providers.projectId, auth.project.id)))
    const succeededTask = {
      ...task,
      state: 'succeeded',
      discoveredCount: discovered.length,
      updatedAt: upsertedAt,
    }
    await db
      .update(modelDiscoveryTasks)
      .set({
        state: succeededTask.state,
        discoveredCount: succeededTask.discoveredCount,
        updatedAt: succeededTask.updatedAt,
      })
      .where(and(eq(modelDiscoveryTasks.id, task.id), eq(modelDiscoveryTasks.projectId, auth.project.id)))
    await recordAudit(db, {
      auth,
      action: 'model_discovery_task.create',
      resourceType: 'model_discovery_task',
      resourceId: task.id,
      outcome: 'success',
      requestId: requestId(c),
      metadata: { providerId: provider.id, discoveredModels: discovered.length },
    })
    return c.json(serializeTask(succeededTask), 201, { Location: location })
  })
  .openapi(readDiscoveryTaskRoute, async (c) => {
    const { providerId, taskId } = c.req.valid('param')
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) return auth
    const provider = await findProvider(db, auth.project.id, providerId)
    if (!provider) return errorResponse(c, 404, 'not_found', 'Provider not found')
    const task = await db
      .select()
      .from(modelDiscoveryTasks)
      .where(
        and(
          eq(modelDiscoveryTasks.id, taskId),
          eq(modelDiscoveryTasks.projectId, auth.project.id),
          eq(modelDiscoveryTasks.providerId, providerId),
        ),
      )
      .get()
    if (!task) return errorResponse(c, 404, 'not_found', 'Model discovery task not found')
    return c.json(serializeTask(task), 200)
  })

export default routes
