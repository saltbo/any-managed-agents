import { createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { requireAuthIdentity } from '../auth/session'
import { projects } from '../db/schema'
import { errorResponse } from '../errors'
import {
  AuthenticatedOperation,
  createApiRouter,
  ErrorResponseSchema,
  listResponseSchema,
  paginateRows,
  parseListCursor,
} from '../openapi'

// Mounted at /api/v1/projects (docs/api-v1-design.md §2 Projects).

const app = createApiRouter()

const ProjectSchema = z
  .object({
    id: z.string().openapi({ example: 'project_abc123' }),
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

const ProjectListQuerySchema = z.object({
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
      example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6InByb2plY3RfYWJjMTIzIn0',
    }),
})

const ProjectParamsSchema = z.object({
  projectId: z.string().openapi({ param: { name: 'projectId', in: 'path' }, example: 'project_abc123' }),
})

type ProjectRow = typeof projects.$inferSelect

// organizationId stays in the DB for tenancy but never leaves the API
// (docs/api-v1-design.md §1.7).
function serializeProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
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

const listProjectsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listProjects',
  tags: ['Projects'],
  summary: 'List projects in the current organization',
  ...AuthenticatedOperation,
  request: {
    query: ProjectListQuerySchema,
  },
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

const createProjectRoute = createRoute({
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

const readProjectRoute = createRoute({
  method: 'get',
  path: '/{projectId}',
  operationId: 'readProject',
  tags: ['Projects'],
  summary: 'Read a single project',
  ...AuthenticatedOperation,
  request: { params: ProjectParamsSchema },
  responses: {
    200: {
      description: 'Project',
      content: { 'application/json': { schema: ProjectSchema } },
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
  .openapi(listProjectsRoute, async (c) => {
    const auth = await requireAuthIdentity(c)
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

    const db = drizzle(c.env.DB)
    const filters = [
      eq(projects.organizationId, auth.organization.id),
      parsedCursor
        ? or(
            lt(projects.createdAt, parsedCursor.createdAt),
            and(eq(projects.createdAt, parsedCursor.createdAt), lt(projects.id, parsedCursor.id)),
          )
        : undefined,
    ].filter((filter) => filter !== undefined)

    let rows = await db
      .select()
      .from(projects)
      .where(and(...filters))
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(limit + 1)

    // Every organization always has at least its default project.
    if (rows.length === 0 && !parsedCursor) {
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

    return c.json(paginateRows(rows.map(serializeProject), limit), 200)
  })
  .openapi(createProjectRoute, async (c) => {
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
    return c.json(serializeProject(project), 201)
  })
  .openapi(readProjectRoute, async (c) => {
    const auth = await requireAuthIdentity(c)
    if (auth instanceof Response) {
      return auth
    }

    const { projectId } = c.req.valid('param')
    const row = await drizzle(c.env.DB)
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, auth.organization.id)))
      .get()
    if (!row) {
      return errorResponse(c, 404, 'not_found', 'Project not found') as never
    }
    return c.json(serializeProject(row), 200)
  })

export default routes
