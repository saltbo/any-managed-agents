import { createRoute, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuthIdentity } from '../auth/session'
import { projects } from '../db/schema'
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

export default routes
