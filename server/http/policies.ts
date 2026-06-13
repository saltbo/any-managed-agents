import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { requestId } from '../audit'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema, listResponseSchema } from '../openapi'
import {
  type CreatePolicyInputDto,
  createPolicy,
  type ReplacePolicyInputDto,
  replacePolicy,
} from '../usecases/policies'
import {
  type AuthScope,
  GovernanceValidationError,
  type PolicyRecord,
  type PolicyScope,
  PolicyScopeConflictError,
} from '../usecases/ports'

type PolicyRoutes = OpenAPIHono<DepsEnv>

const JsonObjectSchema = z.record(z.string(), z.unknown())

const PolicyScopeSchema = z
  .object({
    level: z.enum(['organization', 'team', 'project']).openapi({ example: 'project' }),
    teamId: z.string().min(1).optional().openapi({ example: 'team_platform' }),
  })
  .strict()
  .openapi('PolicyScope')

const PolicySchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    scope: PolicyScopeSchema,
    toolPolicy: JsonObjectSchema,
    mcpPolicy: JsonObjectSchema,
    sandboxPolicy: JsonObjectSchema,
    metadata: JsonObjectSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Policy')

const CreatePolicySchema = z
  .object({
    scope: PolicyScopeSchema,
    toolPolicy: JsonObjectSchema.optional(),
    mcpPolicy: JsonObjectSchema.optional(),
    sandboxPolicy: JsonObjectSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('CreatePolicyRequest')

// PUT replaces the whole policy document: omitted policy objects reset to {}.
// Scope identifies the row and is immutable after creation.
const ReplacePolicySchema = z
  .object({
    scope: PolicyScopeSchema.optional(),
    toolPolicy: JsonObjectSchema.optional(),
    mcpPolicy: JsonObjectSchema.optional(),
    sandboxPolicy: JsonObjectSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('ReplacePolicyRequest')

const PolicyListResponseSchema = listResponseSchema('PolicyListResponse', PolicySchema)

const PolicyParamsSchema = z.object({
  policyId: z.string().openapi({ param: { name: 'policyId', in: 'path' }, example: 'policy_abc123' }),
})

function errorBody(type: string, message: string, details?: Record<string, unknown>) {
  return { error: { type, message, ...(details ? { details } : {}) } } as const
}

function serializePolicy(record: PolicyRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    scope: {
      level: record.scope.level,
      ...(record.scope.teamId ? { teamId: record.scope.teamId } : {}),
    },
    toolPolicy: record.toolPolicy,
    mcpPolicy: record.mcpPolicy,
    sandboxPolicy: record.sandboxPolicy,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listPolicies',
  tags: ['Governance'],
  summary: 'List scoped governance policies',
  ...AuthenticatedOperation,
  responses: {
    200: { description: 'Policies', content: { 'application/json': { schema: PolicyListResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const createPolicyRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createPolicy',
  tags: ['Governance'],
  summary: 'Create a scoped governance policy',
  ...AuthenticatedOperation,
  request: { body: { required: true, content: { 'application/json': { schema: CreatePolicySchema } } } },
  responses: {
    201: { description: 'Created policy', content: { 'application/json': { schema: PolicySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    409: {
      description: 'A policy already exists for this scope',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{policyId}',
  operationId: 'readPolicy',
  tags: ['Governance'],
  summary: 'Read a governance policy',
  ...AuthenticatedOperation,
  request: { params: PolicyParamsSchema },
  responses: {
    200: { description: 'Policy', content: { 'application/json': { schema: PolicySchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const replaceRoute = createRoute({
  method: 'put',
  path: '/{policyId}',
  operationId: 'replacePolicy',
  tags: ['Governance'],
  summary: 'Replace a governance policy',
  ...AuthenticatedOperation,
  request: {
    params: PolicyParamsSchema,
    body: { required: true, content: { 'application/json': { schema: ReplacePolicySchema } } },
  },
  responses: {
    200: { description: 'Replaced policy', content: { 'application/json': { schema: PolicySchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{policyId}',
  operationId: 'deletePolicy',
  tags: ['Governance'],
  summary: 'Delete a governance policy',
  ...AuthenticatedOperation,
  request: { params: PolicyParamsSchema },
  responses: {
    204: { description: 'Policy deleted' },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// Registration order is load-bearing: static segments register before parameter
// segments. The assembler in app.ts calls this at the policies resource's
// original mount position.
export function registerPolicyRoutes(routes: PolicyRoutes) {
  return routes
    .openapi(listRoute, async (c) => {
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const records = await deps.policies.list(auth.project.id)
      return c.json(
        {
          data: records.map(serializePolicy),
          pagination: { limit: records.length, nextCursor: null, hasMore: false },
        },
        200,
      )
    })
    .openapi(createPolicyRoute, async (c) => {
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const scope = authScope(auth)
      try {
        const policy = await createPolicy(deps, scope, inputFromBody(body))
        await deps.audit.record(scope, {
          action: 'policy.create',
          resourceType: 'policy',
          resourceId: policy.id,
          outcome: 'success',
          requestId: requestId(c),
          after: serializePolicy(policy),
        })
        return c.json(serializePolicy(policy), 201)
      } catch (error) {
        if (error instanceof PolicyScopeConflictError) {
          return c.json(
            errorBody('conflict', error.message, { resourceType: 'policy', resourceId: error.policyId }),
            409,
          )
        }
        return validationOr(c, error)
      }
    })
    .openapi(readRoute, async (c) => {
      const { policyId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const policy = await deps.policies.find(auth.project.id, policyId)
      if (!policy) {
        return c.json(errorBody('not_found', 'Policy not found'), 404)
      }
      return c.json(serializePolicy(policy), 200)
    })
    .openapi(replaceRoute, async (c) => {
      const { policyId } = c.req.valid('param')
      const body = c.req.valid('json')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const existing = await deps.policies.find(auth.project.id, policyId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Policy not found'), 404)
      }
      const scope = authScope(auth)
      try {
        const policy = await replacePolicy(deps, scope, existing, replaceInputFromBody(body))
        await deps.audit.record(scope, {
          action: 'policy.update',
          resourceType: 'policy',
          resourceId: policy.id,
          outcome: 'success',
          requestId: requestId(c),
          before: serializePolicy(existing),
          after: serializePolicy(policy),
        })
        return c.json(serializePolicy(policy), 200)
      } catch (error) {
        return validationOr(c, error)
      }
    })
    .openapi(deleteRoute, async (c) => {
      const { policyId } = c.req.valid('param')
      const deps = c.get('deps')
      const auth = await requireAuth(c)
      if (auth instanceof Response) {
        return auth
      }
      const existing = await deps.policies.find(auth.project.id, policyId)
      if (!existing) {
        return c.json(errorBody('not_found', 'Policy not found'), 404)
      }
      const scope = authScope(auth)
      await deps.policies.delete(auth.project.id, policyId)
      await deps.audit.record(scope, {
        action: 'policy.delete',
        resourceType: 'policy',
        resourceId: existing.id,
        outcome: 'success',
        requestId: requestId(c),
        before: serializePolicy(existing),
      })
      return c.body(null, 204)
    })
}

// --- helpers ---

function authScope(auth: Awaited<ReturnType<typeof requireAuth>> & object): AuthScope {
  return auth as unknown as AuthScope
}

// teamId is only present for team scope; drop the key entirely otherwise so the
// exactOptional PolicyScope shape never carries an explicit undefined.
function normalizeScope(scope: z.infer<typeof PolicyScopeSchema>): PolicyScope {
  return { level: scope.level, ...(scope.teamId ? { teamId: scope.teamId } : {}) }
}

function inputFromBody(body: z.infer<typeof CreatePolicySchema>): CreatePolicyInputDto {
  return {
    scope: normalizeScope(body.scope),
    toolPolicy: body.toolPolicy ?? {},
    mcpPolicy: body.mcpPolicy ?? {},
    sandboxPolicy: body.sandboxPolicy ?? {},
    metadata: body.metadata ?? {},
  }
}

function replaceInputFromBody(body: z.infer<typeof ReplacePolicySchema>): ReplacePolicyInputDto {
  return {
    ...(body.scope ? { scope: normalizeScope(body.scope) } : {}),
    toolPolicy: body.toolPolicy ?? {},
    mcpPolicy: body.mcpPolicy ?? {},
    sandboxPolicy: body.sandboxPolicy ?? {},
    metadata: body.metadata ?? {},
  }
}

function validationOr(c: Parameters<Parameters<PolicyRoutes['openapi']>[1]>[0], error: unknown) {
  if (error instanceof GovernanceValidationError) {
    return c.json(errorBody('validation_error', error.message, { fields: error.fields }), 400)
  }
  throw error
}
