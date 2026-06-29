import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { normalizeEnvironmentNetworkPolicy } from '@server/contracts/environment-contracts'
import { ResourceMetadataSchema, ResourcePhaseSchema } from '@server/contracts/resource-contracts'
import type { Environment, EnvironmentVersion } from '@server/domain/environment'
import { requireAuth } from '../auth/session'
import { EnvironmentHostingModeSchema, EnvironmentNetworkPolicySchema } from '../contracts/environment-contracts'
import {
  AuthenticatedOperation,
  type DepsEnv,
  ErrorResponseSchema,
  formatListCursor,
  listQuerySchema,
  listResponseSchema,
  parseListCursor,
} from '../openapi'
import { createEnvironment, type UpdateEnvironmentPatch, updateEnvironment } from '../usecases/environments'
import { EnvironmentArchivedError, EnvironmentValidationError } from '../usecases/ports'
import { requestId } from './request-context'

type EnvironmentRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())
const PackageSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(120).optional(),
})
const VariableSchema = z.object({
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
})
const HostingModeSchema = EnvironmentHostingModeSchema
const NetworkPolicySchema = EnvironmentNetworkPolicySchema
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
const RuntimeConfigSchema = JsonObjectSchema

const EnvironmentSpecSchema = z
  .object({
    packages: z.array(PackageSchema).openapi({ example: [{ name: 'tsx', version: 'latest' }] }),
    variables: z.record(z.string(), VariableSchema).openapi({ example: { NODE_ENV: { description: 'Runtime mode' } } }),
    hostingMode: HostingModeSchema.openapi({ example: 'cloud' }),
    networkPolicy: NetworkPolicySchema.openapi({
      example: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    }),
    mcpPolicy: McpPolicySchema.openapi({ example: { allowedConnectors: ['github'] } }),
    packageManagerPolicy: JsonObjectSchema.openapi({ example: { allowedRegistries: ['registry.npmjs.org'] } }),
    resourceLimits: ResourceLimitsSchema.openapi({ example: { memoryMb: 512 } }),
    runtimeConfig: JsonObjectSchema.openapi({ example: { image: 'node:24' } }),
    metadata: JsonObjectSchema.openapi({ example: { owner: 'platform' } }),
  })
  .openapi('EnvironmentSpec')

const EnvironmentStatusSchema = z
  .object({
    phase: ResourcePhaseSchema,
    currentVersionId: z.string().nullable().openapi({ example: 'envver_abc123' }),
    version: z.number().int().openapi({ example: 1 }),
  })
  .openapi('EnvironmentStatus')

const EnvironmentSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: EnvironmentSpecSchema,
    status: EnvironmentStatusSchema,
  })
  .openapi('Environment')

const EnvironmentVersionSchema = z
  .object({
    metadata: ResourceMetadataSchema,
    spec: EnvironmentSpecSchema,
    status: z
      .object({
        environmentId: z.string().openapi({ example: 'env_abc123' }),
        version: z.number().int().openapi({ example: 1 }),
      })
      .openapi('EnvironmentVersionStatus'),
  })
  .openapi('EnvironmentVersion')

const EnvironmentPayloadSchema = z
  .object({
    name: z.string().min(1).max(120).openapi({ example: 'Node workspace' }),
    description: z.string().max(1000).nullable().optional().openapi({ example: 'Default Node.js environment.' }),
    packages: z
      .array(PackageSchema)
      .max(200)
      .optional()
      .openapi({ example: [{ name: 'tsx', version: 'latest' }] }),
    variables: z
      .record(z.string(), VariableSchema)
      .optional()
      .openapi({ example: { NODE_ENV: { required: true } } }),
    hostingMode: HostingModeSchema.optional().openapi({ example: 'cloud' }),
    networkPolicy: NetworkPolicySchema.optional().openapi({
      example: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    }),
    mcpPolicy: McpPolicySchema.optional().openapi({ example: { allowedConnectors: ['github'] } }),
    packageManagerPolicy: JsonObjectSchema.optional().openapi({
      example: { allowedRegistries: ['registry.npmjs.org'] },
    }),
    resourceLimits: ResourceLimitsSchema.optional().openapi({ example: { memoryMb: 512 } }),
    runtimeConfig: RuntimeConfigSchema.optional().openapi({ example: { image: 'node:24' } }),
    metadata: JsonObjectSchema.optional().openapi({ example: { owner: 'platform' } }),
  })
  .strict()
const CreateEnvironmentSchema = EnvironmentPayloadSchema.openapi('CreateEnvironmentRequest')
const UpdateEnvironmentSchema = EnvironmentPayloadSchema.partial()
  .extend({
    archived: z.boolean().optional().openapi({
      description: 'Lifecycle transition: true archives the environment, false unarchives it.',
      example: false,
    }),
  })
  .strict()
  .openapi('UpdateEnvironmentRequest')

const EnvironmentParamsSchema = z.object({
  environmentId: z.string().openapi({
    param: { name: 'environmentId', in: 'path' },
    example: 'env_abc123',
  }),
})
const EnvironmentVersionParamsSchema = EnvironmentParamsSchema.extend({
  version: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({
      param: { name: 'version', in: 'path' },
      example: 1,
    }),
})
const ListQuerySchema = listQuerySchema()
const EnvironmentListResponseSchema = listResponseSchema('EnvironmentListResponse', EnvironmentSchema)
const EnvironmentVersionListResponseSchema = listResponseSchema(
  'EnvironmentVersionListResponse',
  EnvironmentVersionSchema,
)

function domainValidation(message: string, fields: Record<string, string>) {
  return { error: { type: 'validation_error', message, details: { fields } } } as const
}

function serializeEnvironment(record: Environment) {
  return record
}

function serializeEnvironmentVersion(record: EnvironmentVersion) {
  return record
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

const createEnvironmentRoute = createRoute({
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
  description:
    'Partial update. Lifecycle transitions use the archived flag: {archived: true} archives, {archived: false} unarchives. Field updates on an archived environment are rejected with 409.',
  ...AuthenticatedOperation,
  request: {
    params: EnvironmentParamsSchema,
    body: { required: true, content: { 'application/json': { schema: UpdateEnvironmentSchema } } },
  },
  responses: {
    200: { description: 'Updated environment', content: { 'application/json': { schema: EnvironmentSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Environment not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: { description: 'Archived environment', content: { 'application/json': { schema: ErrorResponseSchema } } },
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

const versionItemRoute = createRoute({
  method: 'get',
  path: '/{environmentId}/versions/{version}',
  operationId: 'readEnvironmentVersion',
  tags: ['Environments'],
  summary: 'Read an environment version',
  ...AuthenticatedOperation,
  request: { params: EnvironmentVersionParamsSchema },
  responses: {
    200: { description: 'Environment version', content: { 'application/json': { schema: EnvironmentVersionSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: {
      description: 'Environment or version not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// Registration order is load-bearing: requireAuth is the per-route auth wall and
// static segments register before parameter segments. The assembler in app.ts
// calls this at the environments resource's original mount position.
export function registerEnvironmentRoutes(routes: EnvironmentRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const { archived, search, createdFrom, createdTo, limit = 50, cursor } = c.req.valid('query')
      let parsedCursor: { createdAt: string; id: string } | null = null
      try {
        parsedCursor = cursor ? parseListCursor(cursor) : null
      } catch {
        return c.json(domainValidation('Invalid list cursor', { cursor: 'Cursor is invalid.' }), 400)
      }
      const page = await deps.environments.list({
        projectId: auth.project.id,
        archived: archived === 'true',
        ...(search ? { search } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        limit,
        cursor: parsedCursor,
      })
      const last = page.rows.at(-1)
      const nextCursor =
        page.hasMore && last ? formatListCursor({ createdAt: last.metadata.createdAt, id: last.metadata.uid }) : null
      return c.json(
        {
          data: page.rows.map(serializeEnvironment),
          pagination: { limit, nextCursor, hasMore: page.hasMore },
        },
        200,
      )
    })
    .openapi(createEnvironmentRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      try {
        const environment = await createEnvironment(deps, auth, {
          name: body.name,
          description: body.description ?? null,
          config: configFromPayload(body),
        })
        return c.json(serializeEnvironment(environment), 201)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(readRoute, async (c) => {
      const { environmentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      return c.json(serializeEnvironment(environment), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { environmentId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      const scope = auth
      const before = environment
      try {
        const result = await updateEnvironment(deps, scope, environment, patchFromBody(body))
        if (result.archived) {
          await deps.audit.record(scope, {
            action: 'environment.archive',
            resourceType: 'environment',
            resourceId: environmentId,
            outcome: 'success',
            requestId: requestId(c),
            before: serializeEnvironment(before),
            after: { archivedAt: result.environment.metadata.archivedAt },
          })
        } else if (result.unarchived) {
          await deps.audit.record(scope, {
            action: 'environment.unarchive',
            resourceType: 'environment',
            resourceId: environmentId,
            outcome: 'success',
            requestId: requestId(c),
            before: { archivedAt: before.metadata.archivedAt },
            after: { archivedAt: null },
          })
        }
        return c.json(serializeEnvironment(result.environment), 200)
      } catch (error) {
        if (error instanceof EnvironmentArchivedError) {
          return c.json({ error: { type: 'conflict', message: error.message } }, 409)
        }
        return validationOr(c, error)
      }
    })
    .openapi(versionsRoute, async (c) => {
      const { environmentId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      const versions = await deps.environments.listVersions(auth.project.id, environmentId)
      return c.json(
        {
          data: versions.map(serializeEnvironmentVersion),
          pagination: { limit: versions.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(versionItemRoute, async (c) => {
      const { environmentId, version } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const environment = await deps.environments.find(auth.project.id, environmentId)
      if (!environment) {
        return notFound(c)
      }
      const row = await deps.environments.findVersion(auth.project.id, environmentId, version)
      if (!row) {
        return c.json({ error: { type: 'not_found', message: 'Environment version not found' } }, 404)
      }
      return c.json(serializeEnvironmentVersion(row), 200)
    })
}

// --- helpers ---

function configFromPayload(body: z.infer<typeof EnvironmentPayloadSchema>) {
  return {
    packages: body.packages ?? [],
    variables: body.variables ?? {},
    hostingMode: body.hostingMode ?? ('cloud' as const),
    networkPolicy: body.networkPolicy ?? normalizeEnvironmentNetworkPolicy({ mode: 'unrestricted' }),
    mcpPolicy: body.mcpPolicy ?? {},
    packageManagerPolicy: body.packageManagerPolicy ?? {},
    resourceLimits: body.resourceLimits ?? {},
    runtimeConfig: body.runtimeConfig ?? {},
    metadata: body.metadata ?? {},
  }
}

// Builds the usecase patch from the validated PATCH body: only present fields
// are forwarded (so an absent field is distinct from an explicit null).
function patchFromBody(body: z.infer<typeof UpdateEnvironmentSchema>): UpdateEnvironmentPatch {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.packages !== undefined ? { packages: body.packages } : {}),
    ...(body.variables !== undefined ? { variables: body.variables } : {}),
    ...(body.hostingMode !== undefined ? { hostingMode: body.hostingMode } : {}),
    ...(body.networkPolicy !== undefined ? { networkPolicy: body.networkPolicy } : {}),
    ...(body.mcpPolicy !== undefined ? { mcpPolicy: body.mcpPolicy } : {}),
    ...(body.packageManagerPolicy !== undefined ? { packageManagerPolicy: body.packageManagerPolicy } : {}),
    ...(body.resourceLimits !== undefined ? { resourceLimits: body.resourceLimits } : {}),
    ...(body.runtimeConfig !== undefined ? { runtimeConfig: body.runtimeConfig } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
  }
}

function notFound(c: Parameters<Parameters<EnvironmentRoutes['openapi']>[1]>[0]) {
  return c.json({ error: { type: 'not_found', message: 'Environment not found' } }, 404)
}

function validationOr(c: Parameters<Parameters<EnvironmentRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof EnvironmentValidationError) {
    return c.json(domainValidation(error.message, error.fields), 400)
  }
  throw error
}
