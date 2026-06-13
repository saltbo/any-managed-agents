import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requestId } from '../audit'
import { requireAuth } from '../auth/session'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { createFederatedTenant, updateFederatedTenant } from '../usecases/federated-tenants'
import { type AuthScope, FederatedTenantConflictError, type FederatedTenantRecord } from '../usecases/ports'

// Mounted at /api/v1/auth/federated-tenants (docs/api-v1-design.md §2 Auth).
// Federated tenants authorize external platforms (issuer + external tenant)
// to act inside a project.

type FederatedTenantRoutes = OpenAPIHono<DepsEnv>

const FederatedTenantSchema = z
  .object({
    id: z.string().openapi({ example: 'ftn_abc123' }),
    issuer: z.string().url().openapi({ example: 'https://ak.example.com' }),
    externalTenantId: z.string().openapi({ example: 'org_abc123' }),
    projectId: z.string().openapi({ example: 'project_abc123' }),
    environmentId: z.string().nullable().openapi({ example: 'env_abc123' }),
    capabilities: z.array(z.string()).openapi({ example: ['session:poll', 'session:claim'] }),
    enabled: z.boolean().openapi({ example: true }),
    metadata: z.record(z.string(), z.unknown()).openapi({ example: { platform: 'agent-kanban' } }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FederatedTenant')

const CreateFederatedTenantSchema = z
  .object({
    issuer: z.string().url().openapi({ example: 'https://ak.example.com' }),
    externalTenantId: z.string().min(1).max(240).openapi({ example: 'org_abc123' }),
    environmentId: z.string().min(1).optional().openapi({ example: 'env_abc123' }),
    capabilities: z
      .array(z.string().min(1).max(120))
      .max(100)
      .optional()
      .openapi({ example: ['session:poll', 'session:claim'] }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ example: { platform: 'agent-kanban' } }),
  })
  .strict()
  .openapi('CreateFederatedTenantRequest')

const UpdateFederatedTenantSchema = z
  .object({
    enabled: z.boolean().optional().openapi({ example: false }),
    capabilities: z
      .array(z.string().min(1).max(120))
      .max(100)
      .optional()
      .openapi({ example: ['session:poll'] }),
    environmentId: z.string().min(1).nullable().optional().openapi({ example: 'env_abc123' }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ example: { platform: 'agent-kanban' } }),
  })
  .strict()
  .openapi('UpdateFederatedTenantRequest')

const FederatedTenantListResponseSchema = listResponseSchema('FederatedTenantListResponse', FederatedTenantSchema)

const FederatedTenantListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name: 'limit', in: 'query' },
      example: 50,
    }),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .openapi({
      param: { name: 'cursor', in: 'query' },
      example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImZ0bl9hYmMxMjMifQ',
    }),
})

const FederatedTenantParamsSchema = z.object({
  tenantId: z.string().openapi({ param: { name: 'tenantId', in: 'path' }, example: 'ftn_abc123' }),
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function serializeFederatedTenant(record: FederatedTenantRecord) {
  return {
    id: record.id,
    issuer: record.issuer,
    externalTenantId: record.externalTenantId,
    projectId: record.projectId,
    environmentId: record.environmentId,
    capabilities: record.capabilities,
    enabled: record.enabled,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listFederatedTenantsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listFederatedTenants',
  tags: ['Auth'],
  summary: 'List federated tenants for the current project',
  ...AuthenticatedOperation,
  request: { query: FederatedTenantListQuerySchema },
  responses: {
    200: {
      description: 'Federated tenants for the current project',
      content: { 'application/json': { schema: FederatedTenantListResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createFederatedTenantRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createFederatedTenant',
  tags: ['Auth'],
  summary: 'Authorize an external issuer tenant for the current project',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreateFederatedTenantSchema } } } },
  responses: {
    201: {
      description: 'Created federated tenant',
      content: { 'application/json': { schema: FederatedTenantSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'A federated tenant with the same issuer and external tenant id already exists',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const readFederatedTenantRoute = createRoute({
  method: 'get',
  path: '/{tenantId}',
  operationId: 'readFederatedTenant',
  tags: ['Auth'],
  summary: 'Read a federated tenant',
  ...AuthenticatedOperation,
  request: { params: FederatedTenantParamsSchema },
  responses: {
    200: { description: 'Federated tenant', content: { 'application/json': { schema: FederatedTenantSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Federated tenant not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const updateFederatedTenantRoute = createRoute({
  method: 'patch',
  path: '/{tenantId}',
  operationId: 'updateFederatedTenant',
  tags: ['Auth'],
  summary: 'Update a federated tenant',
  ...AuthenticatedOperation,
  request: {
    params: FederatedTenantParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateFederatedTenantSchema } } },
  },
  responses: {
    200: {
      description: 'Updated federated tenant',
      content: { 'application/json': { schema: FederatedTenantSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Federated tenant not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const deleteFederatedTenantRoute = createRoute({
  method: 'delete',
  path: '/{tenantId}',
  operationId: 'deleteFederatedTenant',
  tags: ['Auth'],
  summary: 'Delete a federated tenant',
  ...AuthenticatedOperation,
  request: { params: FederatedTenantParamsSchema },
  responses: {
    204: { description: 'Federated tenant deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Federated tenant not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this BEFORE the auth resource (so /federated-tenants matches before the
// /api/v1/auth catch-all), at the federated-tenants resource's original mount
// position.
export function registerFederatedTenantRoutes(routes: FederatedTenantRoutes) {
  return routes
    .openapi(listFederatedTenantsRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const query = c.req.valid('query')
      const limit = query.limit ?? 50
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = query.cursor ? parseListCursor(query.cursor) : null
      } catch {
        return c.json(errorBody('validation_error', 'Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.federatedTenants.list({ projectId: auth.project.id, limit, cursor: parsedCursor })
      const last = page.rows.at(-1)
      const nextCursor = page.hasMore && last ? formatListCursor({ createdAt: last.createdAt, id: last.id }) : null
      return c.json(
        { data: page.rows.map(serializeFederatedTenant), pagination: { limit, nextCursor, hasMore: page.hasMore } },
        200,
      )
    })
    .openapi(createFederatedTenantRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const body = c.req.valid('json')
      const scope = authScope(auth)
      try {
        const tenant = await createFederatedTenant(deps, scope, {
          issuer: body.issuer,
          externalTenantId: body.externalTenantId,
          environmentId: body.environmentId ?? null,
          capabilities: body.capabilities ?? [],
          metadata: body.metadata ?? {},
        })
        const serialized = serializeFederatedTenant(tenant)
        await deps.audit.record(scope, {
          action: 'federated_tenant.create',
          resourceType: 'federated_tenant',
          resourceId: tenant.id,
          outcome: 'success',
          requestId: requestId(c),
          after: serialized,
        })
        return c.json(serialized, 201)
      } catch (error) {
        if (error instanceof FederatedTenantConflictError) {
          return c.json(errorBody('conflict', error.message), 409)
        }
        throw error
      }
    })
    .openapi(readFederatedTenantRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { tenantId } = c.req.valid('param')
      const tenant = await deps.federatedTenants.find(auth.project.id, tenantId)
      if (!tenant) {
        return c.json(errorBody('not_found', 'Federated tenant not found'), 404)
      }
      return c.json(serializeFederatedTenant(tenant), 200)
    })
    .openapi(updateFederatedTenantRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { tenantId } = c.req.valid('param')
      const existing = await deps.federatedTenants.find(auth.project.id, tenantId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Federated tenant not found'), 404)
      }
      const body = c.req.valid('json')
      const scope = authScope(auth)
      const updated = await updateFederatedTenant(deps, scope, existing, {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
        ...(body.environmentId !== undefined ? { environmentId: body.environmentId } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      })
      const serialized = serializeFederatedTenant(updated)
      await deps.audit.record(scope, {
        action: 'federated_tenant.update',
        resourceType: 'federated_tenant',
        resourceId: tenantId,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeFederatedTenant(existing),
        after: serialized,
      })
      return c.json(serialized, 200)
    })
    .openapi(deleteFederatedTenantRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { tenantId } = c.req.valid('param')
      const existing = await deps.federatedTenants.find(auth.project.id, tenantId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Federated tenant not found'), 404)
      }
      const scope = authScope(auth)
      await deps.federatedTenants.delete(auth.project.id, tenantId)
      await deps.audit.record(scope, {
        action: 'federated_tenant.delete',
        resourceType: 'federated_tenant',
        resourceId: tenantId,
        outcome: 'success',
        requestId: requestId(c),
        before: serializeFederatedTenant(existing),
      })
      return c.body(null, 204)
    })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}
