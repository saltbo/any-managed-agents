import { createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuth, requireAuthIdentity } from '../auth/session'
import { externalProjectBindings, projects } from '../db/schema'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema, listResponseSchema } from '../openapi'

const app = createApiRouter()

const ProjectSchema = z
  .object({
    id: z.string().openapi({ example: 'project_abc123' }),
    organizationId: z.string().openapi({ example: 'org_abc123' }),
    name: z.string().openapi({ example: 'Control Plane' }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Project')

const CreateProjectSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Control Plane' }),
  })
  .openapi('CreateProjectRequest')

const ProjectListResponseSchema = listResponseSchema('ProjectListResponse', ProjectSchema)
const ExternalProjectBindingSchema = z
  .object({
    id: z.string().openapi({ example: 'epb_abc123' }),
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
  .openapi('ExternalProjectBinding')
const CreateExternalProjectBindingSchema = z
  .object({
    issuer: z.string().url(),
    externalTenantId: z.string().min(1).max(240),
    environmentId: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1).max(120)).max(100).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .openapi('CreateExternalProjectBindingRequest')
const ProjectParamsSchema = z.object({
  projectId: z.string().openapi({ param: { name: 'projectId', in: 'path' }, example: 'project_abc123' }),
})

function serializeExternalBinding(row: typeof externalProjectBindings.$inferSelect) {
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

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listProjects',
  tags: ['Projects'],
  summary: 'List projects in the current organization',
  ...AuthenticatedOperation,
  responses: {
    200: {
      description: 'Projects in the current organization',
      content: { 'application/json': { schema: ProjectListResponseSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const createRouteDefinition = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createProject',
  tags: ['Projects'],
  summary: 'Create a project in the current organization',
  ...AuthenticatedOperation,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateProjectSchema } },
    },
  },
  responses: {
    201: {
      description: 'Created project',
      content: { 'application/json': { schema: ProjectSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const listExternalBindingsRoute = createRoute({
  method: 'get',
  path: '/{projectId}/external-bindings',
  operationId: 'listExternalProjectBindings',
  tags: ['Projects'],
  summary: 'List external tenant bindings for a project',
  ...AuthenticatedOperation,
  request: { params: ProjectParamsSchema },
  responses: {
    200: {
      description: 'External project bindings',
      content: { 'application/json': { schema: z.object({ data: z.array(ExternalProjectBindingSchema) }) } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Project not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const createExternalBindingRoute = createRoute({
  method: 'post',
  path: '/{projectId}/external-bindings',
  operationId: 'createExternalProjectBinding',
  tags: ['Projects'],
  summary: 'Bind an external issuer tenant to a project',
  ...AuthenticatedOperation,
  request: {
    params: ProjectParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: CreateExternalProjectBindingSchema } },
    },
  },
  responses: {
    201: {
      description: 'Created external project binding',
      content: { 'application/json': { schema: ExternalProjectBindingSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Project not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const routes = app
  .openapi(listRoute, async (c) => {
    const auth = await requireAuthIdentity(c)
    if (auth instanceof Response) {
      return auth
    }

    const db = drizzle(c.env.DB)
    let rows = await db.select().from(projects).where(eq(projects.organizationId, auth.organization.id))
    if (rows.length === 0) {
      const timestamp = now()
      const project = {
        id: newId('project'),
        organizationId: auth.organization.id,
        name: 'Default project',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await db.insert(projects).values(project)
      rows = [project]
    }

    return c.json(
      {
        data: rows,
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
  .openapi(createRouteDefinition, async (c) => {
    const auth = await requireAuthIdentity(c)
    if (auth instanceof Response) {
      return auth
    }

    const timestamp = now()
    const project = {
      id: newId('project'),
      organizationId: auth.organization.id,
      name: c.req.valid('json').name,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await drizzle(c.env.DB).insert(projects).values(project)
    return c.json(project, 201)
  })
  .openapi(listExternalBindingsRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { projectId } = c.req.valid('param')
    if (projectId !== auth.project.id) {
      return c.json({ data: [] }, 200)
    }
    const rows = await db.select().from(externalProjectBindings).where(eq(externalProjectBindings.projectId, projectId))
    return c.json({ data: rows.map(serializeExternalBinding) }, 200)
  })
  .openapi(createExternalBindingRoute, async (c) => {
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const { projectId } = c.req.valid('param')
    if (projectId !== auth.project.id) {
      return c.json({ error: { type: 'not_found', message: 'Project not found' } }, 404)
    }
    const body = c.req.valid('json')
    const timestamp = now()
    const row = {
      id: newId('epb'),
      issuer: body.issuer.replace(/\/$/, ''),
      externalTenantId: body.externalTenantId,
      projectId,
      environmentId: body.environmentId ?? null,
      capabilities: JSON.stringify(body.capabilities ?? []),
      enabled: true,
      metadata: JSON.stringify(body.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db
      .insert(externalProjectBindings)
      .values(row)
      .onConflictDoUpdate({
        target: [externalProjectBindings.issuer, externalProjectBindings.externalTenantId],
        set: {
          projectId: row.projectId,
          environmentId: row.environmentId,
          capabilities: row.capabilities,
          enabled: true,
          metadata: row.metadata,
          updatedAt: row.updatedAt,
        },
      })
    const created = await db
      .select()
      .from(externalProjectBindings)
      .where(
        and(
          eq(externalProjectBindings.issuer, row.issuer),
          eq(externalProjectBindings.externalTenantId, row.externalTenantId),
        ),
      )
      .get()
    return c.json(serializeExternalBinding(created ?? row), 201)
  })

export default routes
