import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { recordAudit, requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { federatedTenants } from '../db/schema'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'

// Mounted at /api/v1/auth/federated-tenants (docs/api-v1-design.md §2 Auth).
// Federated tenants authorize external platforms (issuer + external tenant)
// to act inside a project; renamed from the project-nested external-bindings.

const app = createApiRouter()

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

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

type FederatedTenantRow = typeof federatedTenants.$inferSelect

function serializeFederatedTenant(row: FederatedTenantRow) {
  return {
    id: row.id,
    issuer: row.issuer,
    externalTenantId: row.externalTenantId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    capabilities: JSON.parse(row.capabilities) as string[],
    enabled: row.enabled,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

function normalizeIssuer(issuer: string) {
  return issuer.replace(/\/$/, '')
}

// ──────────────────────────────────────────────────────────────────────────────
// Route definitions
// ──────────────────────────────────────────────────────────────────────────────

const listFederatedTenantsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listFederatedTenants',
  tags: ['Auth'],
  summary: 'List federated tenants for the current project',
  ...AuthenticatedOperation,
  request: {
    query: FederatedTenantListQuerySchema,
  },
  responses: {
    200: {
      description: 'Federated tenants for the current project',
      content: { 'application/json': { schema: FederatedTenantListResponseSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const createFederatedTenantRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createFederatedTenant',
  tags: ['Auth'],
  summary: 'Authorize an external issuer tenant for the current project',
  ...AuthenticatedOperation,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateFederatedTenantSchema } },
    },
  },
  responses: {
    201: {
      description: 'Created federated tenant',
      content: { 'application/json': { schema: FederatedTenantSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
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
    200: {
      description: 'Federated tenant',
      content: { 'application/json': { schema: FederatedTenantSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
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
    body: {
      required: true,
      content: { 'application/json': { schema: UpdateFederatedTenantSchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated federated tenant',
      content: { 'application/json': { schema: FederatedTenantSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
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
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Federated tenant not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// ──────────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────────

async function findProjectTenant(db: ReturnType<typeof drizzle>, tenantId: string, projectId: string) {
  return db
    .select()
    .from(federatedTenants)
    .where(and(eq(federatedTenants.id, tenantId), eq(federatedTenants.projectId, projectId)))
    .get()
}

const routes = app
  .openapi(listFederatedTenantsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const query = c.req.valid('query')
    const limit = query.limit ?? 50

    let parsedCursor: ReturnType<typeof parseListCursor> | null = null
    try {
      parsedCursor = query.cursor ? parseListCursor(query.cursor) : null
    } catch {
      return errorResponse(c, 400, 'validation_error', 'Invalid list cursor', {
        cursor: 'Cursor is invalid.',
      }) as never
    }

    const filters = [
      eq(federatedTenants.projectId, auth.project.id),
      parsedCursor
        ? or(
            lt(federatedTenants.createdAt, parsedCursor.createdAt),
            and(eq(federatedTenants.createdAt, parsedCursor.createdAt), lt(federatedTenants.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)

    const rows = await db
      .select()
      .from(federatedTenants)
      .where(and(...filters))
      .orderBy(desc(federatedTenants.createdAt), desc(federatedTenants.id))
      .limit(limit + 1)

    return c.json(paginateRows(rows.map(serializeFederatedTenant), limit), 200)
  })
  .openapi(createFederatedTenantRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const body = c.req.valid('json')
    const issuer = normalizeIssuer(body.issuer)

    // issuer + externalTenantId is globally unique (one external tenant maps
    // to exactly one project). POST is create-only, so a clash is a conflict.
    const existing = await db
      .select({ id: federatedTenants.id })
      .from(federatedTenants)
      .where(and(eq(federatedTenants.issuer, issuer), eq(federatedTenants.externalTenantId, body.externalTenantId)))
      .get()
    if (existing) {
      return errorResponse(
        c,
        409,
        'conflict',
        'Federated tenant already exists for this issuer and external tenant',
      ) as never
    }

    const timestamp = now()
    const row = {
      id: newId('ftn'),
      issuer,
      externalTenantId: body.externalTenantId,
      projectId: auth.project.id,
      environmentId: body.environmentId ?? null,
      capabilities: JSON.stringify(body.capabilities ?? []),
      enabled: true,
      metadata: JSON.stringify(body.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(federatedTenants).values(row)

    const serialized = serializeFederatedTenant(row)
    await recordAudit(db, {
      auth,
      action: 'federated_tenant.create',
      resourceType: 'federated_tenant',
      resourceId: row.id,
      outcome: 'success',
      requestId: requestId(c),
      after: serialized,
    })
    return c.json(serialized, 201)
  })
  .openapi(readFederatedTenantRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const { tenantId } = c.req.valid('param')
    const row = await findProjectTenant(db, tenantId, auth.project.id)
    if (!row) {
      return errorResponse(c, 404, 'not_found', 'Federated tenant not found') as never
    }
    return c.json(serializeFederatedTenant(row), 200)
  })
  .openapi(updateFederatedTenantRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const { tenantId } = c.req.valid('param')
    const row = await findProjectTenant(db, tenantId, auth.project.id)
    if (!row) {
      return errorResponse(c, 404, 'not_found', 'Federated tenant not found') as never
    }

    const body = c.req.valid('json')
    const updated = {
      ...row,
      enabled: body.enabled ?? row.enabled,
      capabilities: body.capabilities !== undefined ? JSON.stringify(body.capabilities) : row.capabilities,
      environmentId: body.environmentId !== undefined ? body.environmentId : row.environmentId,
      metadata: body.metadata !== undefined ? JSON.stringify(body.metadata) : row.metadata,
      updatedAt: now(),
    }
    await db
      .update(federatedTenants)
      .set({
        enabled: updated.enabled,
        capabilities: updated.capabilities,
        environmentId: updated.environmentId,
        metadata: updated.metadata,
        updatedAt: updated.updatedAt,
      })
      .where(eq(federatedTenants.id, tenantId))

    const serialized = serializeFederatedTenant(updated)
    await recordAudit(db, {
      auth,
      action: 'federated_tenant.update',
      resourceType: 'federated_tenant',
      resourceId: tenantId,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeFederatedTenant(row),
      after: serialized,
    })
    return c.json(serialized, 200)
  })
  .openapi(deleteFederatedTenantRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }

    const { tenantId } = c.req.valid('param')
    const row = await findProjectTenant(db, tenantId, auth.project.id)
    if (!row) {
      return errorResponse(c, 404, 'not_found', 'Federated tenant not found') as never
    }

    await db.delete(federatedTenants).where(eq(federatedTenants.id, tenantId))
    await recordAudit(db, {
      auth,
      action: 'federated_tenant.delete',
      resourceType: 'federated_tenant',
      resourceId: tenantId,
      outcome: 'success',
      requestId: requestId(c),
      before: serializeFederatedTenant(row),
    })
    return c.body(null, 204)
  })

export default routes
