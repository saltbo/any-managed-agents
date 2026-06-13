import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { DISCOVERY_TASK_STATES, MODEL_AVAILABILITY, PROVIDER_TYPES } from '@server/domain/provider'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  CredentialRefSchema,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { redactSensitiveValue } from '../redaction'
import {
  type AuthScope,
  type ModelDiscoveryTaskRecord,
  type ProviderModelRecord,
  type ProviderRecord,
  ProviderReferencedError,
  ProviderValidationError,
} from '../usecases/ports'
import {
  type CredentialPatch,
  createProvider,
  deleteProvider,
  runModelDiscovery,
  type UpdateProviderPatch,
  updateProvider,
} from '../usecases/providers'
import { requestId } from './request-context'

type ProviderRoutes = OpenAPIHono<DepsEnv>

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

const PLATFORM_DEFAULT_ID = 'workers-ai'

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function serializeProvider(record: ProviderRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    type: record.type,
    displayName: record.displayName,
    baseUrl: record.baseUrl,
    isDefault: record.isDefault,
    enabled: record.enabled,
    credentialRef: record.credentialId
      ? {
          credentialId: record.credentialId,
          ...(record.credentialVersionId ? { versionId: record.credentialVersionId } : {}),
        }
      : null,
    credentialStatus: record.credentialStatus,
    metadata: record.metadata,
    rateLimits: record.rateLimits,
    budgetPolicy: record.budgetPolicy,
    modelCatalogState: record.modelCatalogState,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeModel(record: ProviderModelRecord) {
  return {
    id: record.id,
    providerId: record.providerId,
    modelId: record.modelId,
    displayName: record.displayName,
    capabilities: record.capabilities,
    contextWindow: record.contextWindow,
    pricing: record.pricing,
    availability: record.availability,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function serializeTask(record: ModelDiscoveryTaskRecord) {
  return {
    id: record.id,
    providerId: record.providerId,
    state: record.state,
    discoveredCount: record.discoveredCount,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the providers resource's original mount position.
export function registerProviderRoutes(routes: ProviderRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      // Providers have no archived lifecycle (DELETE is permanent), so the
      // archived=true slice of the standard list contract is always empty.
      if (archived === 'true') {
        return c.json({ data: [], pagination: { limit, nextCursor: null, hasMore: false } }, 200)
      }
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(
          errorBody('validation_error', 'Invalid list cursor', { fields: { cursor: 'Cursor is invalid.' } }),
          400,
        )
      }
      const page = await deps.providers.list({
        projectId: auth.project.id,
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeProvider), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createProviderRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = authScope(auth)
      try {
        const provider = await createProvider(deps, scope, {
          type: body.type,
          displayName: body.displayName,
          baseUrl: body.baseUrl ?? null,
          isDefault: body.isDefault ?? false,
          credentialId: body.credentialRef?.credentialId ?? null,
          credentialVersionId: body.credentialRef?.versionId ?? null,
          metadata: redactSensitiveValue(body.metadata ?? {}) as Record<string, unknown>,
          rateLimits: body.rateLimits ?? {},
          budgetPolicy: body.budgetPolicy ?? {},
        })
        await deps.audit.record(scope, {
          action: 'provider.create',
          resourceType: 'provider',
          resourceId: provider.id,
          outcome: 'success',
          requestId: requestId(c),
          after: serializeProvider(provider),
        })
        return c.json(serializeProvider(provider), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readRoute, async (c) => {
      const { providerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider && providerId !== PLATFORM_DEFAULT_ID) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      return c.json(serializeProvider(provider ?? deps.providers.platformDefault(auth.project.id)), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { providerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const scope = authScope(auth)
      try {
        const updated = await updateProvider(deps, scope, provider, patchFromBody(body))
        await deps.audit.record(scope, {
          action: 'provider.update',
          resourceType: 'provider',
          resourceId: providerId,
          outcome: 'success',
          requestId: requestId(c),
          before: serializeProvider(provider),
          after: serializeProvider(updated),
        })
        return c.json(serializeProvider(updated), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(deleteRoute, async (c) => {
      const { providerId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const scope = authScope(auth)
      try {
        await deleteProvider(deps, scope, provider)
      } catch (error) {
        if (error instanceof ProviderReferencedError) {
          return c.json(errorBody('conflict', error.message, { fields: error.fields }), 409)
        }
        throw error
      }
      await deps.audit.record(scope, {
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
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider && providerId !== PLATFORM_DEFAULT_ID) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const rows = await deps.providers.listModels(auth.project.id, providerId)
      const data =
        rows.length === 0 && providerId === PLATFORM_DEFAULT_ID
          ? deps.providers.platformDefaultModels(
              auth.project.id,
              providerId,
              c.env.AMA_DEFAULT_MODEL ?? '@cf/moonshotai/kimi-k2.6',
            )
          : rows
      return c.json(
        {
          data: data.map(serializeModel),
          pagination: { limit: data.length || 1, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(upsertModelRoute, async (c) => {
      const { providerId, modelId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const scope = authScope(auth)
      const { record, created } = await deps.providers.upsertModel(
        {
          organizationId: auth.organization.id,
          projectId: auth.project.id,
          providerId,
          modelId,
          displayName: body.displayName,
          capabilities: body.capabilities ?? [],
          contextWindow: body.contextWindow ?? null,
          pricing: body.pricing ?? {},
          availability: body.availability ?? 'available',
          metadata: body.metadata ?? {},
        },
        new Date().toISOString(),
      )
      await deps.audit.record(scope, {
        action: 'provider_model.upsert',
        resourceType: 'provider_model',
        resourceId: record.id,
        outcome: 'success',
        requestId: requestId(c),
        metadata: { created },
        after: serializeModel(record),
      })
      return c.json(serializeModel(record), created ? 201 : 200)
    })
    .openapi(deleteModelRoute, async (c) => {
      const { providerId, modelId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const existing = await deps.providers.findModel(auth.project.id, providerId, modelId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Provider model not found'), 404)
      }
      const scope = authScope(auth)
      await deps.providers.deleteModel(auth.project.id, existing.id)
      await deps.audit.record(scope, {
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
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      // Discovery tasks are persisted rows referencing the provider, so the
      // synthesized platform-default Workers AI (no DB row) cannot host them.
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const scope = authScope(auth)
      const result = await runModelDiscovery(deps, scope, provider, c.env.AMA_DEFAULT_MODEL)
      const location = `/api/v1/providers/${provider.id}/model-discovery-tasks/${result.task.id}`
      if (result.outcome === 'failed') {
        await deps.audit.record(scope, {
          action: 'model_discovery_task.create',
          resourceType: 'model_discovery_task',
          resourceId: result.task.id,
          outcome: 'failure',
          requestId: requestId(c),
          metadata: { providerId: provider.id, category: result.category, retryable: result.retryable },
        })
      } else {
        await deps.audit.record(scope, {
          action: 'model_discovery_task.create',
          resourceType: 'model_discovery_task',
          resourceId: result.task.id,
          outcome: 'success',
          requestId: requestId(c),
          metadata: { providerId: provider.id, discoveredModels: result.discoveredCount },
        })
      }
      return c.json(serializeTask(result.task), 201, { Location: location })
    })
    .openapi(readDiscoveryTaskRoute, async (c) => {
      const { providerId, taskId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const provider = await deps.providers.find(auth.project.id, providerId)
      if (!provider) {
        return c.json(errorBody('not_found', 'Provider not found'), 404)
      }
      const task = await deps.providers.findDiscoveryTask(auth.project.id, providerId, taskId)
      if (!task) {
        return c.json(errorBody('not_found', 'Model discovery task not found'), 404)
      }
      return c.json(serializeTask(task), 200)
    })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}

function credentialPatch(ref: z.infer<typeof CredentialRefSchema> | null | undefined): CredentialPatch {
  if (ref === undefined) {
    return undefined
  }
  return { credentialId: ref?.credentialId ?? null, credentialVersionId: ref?.versionId ?? null }
}

function patchFromBody(body: z.infer<typeof UpdateProviderSchema>): UpdateProviderPatch {
  return {
    ...(body.type !== undefined ? { type: body.type } : {}),
    ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.credentialRef !== undefined ? { credential: credentialPatch(body.credentialRef) } : {}),
    ...(body.metadata !== undefined
      ? { metadata: redactSensitiveValue(body.metadata) as Record<string, unknown> }
      : {}),
    ...(body.rateLimits !== undefined ? { rateLimits: body.rateLimits } : {}),
    ...(body.budgetPolicy !== undefined ? { budgetPolicy: body.budgetPolicy } : {}),
  }
}

function validationOr(c: Parameters<Parameters<ProviderRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof ProviderValidationError) {
    return c.json(errorBody('validation_error', error.message, { fields: error.fields }), 400)
  }
  throw error
}
