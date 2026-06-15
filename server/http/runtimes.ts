import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { cloudRuntimeModels, type RuntimeName } from '@server/domain/runtime-catalog'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, type DepsEnv, ErrorResponseSchema } from '../openapi'

type RuntimeRoutes = OpenAPIHono<DepsEnv>

const RuntimeModelSchema = z
  .object({
    provider: z.string().openapi({ example: 'workers-ai' }),
    model: z.string().openapi({ example: '@cf/moonshotai/kimi-k2.6' }),
    displayName: z.string().optional().openapi({ example: 'Kimi K2.6 (Workers AI)' }),
  })
  .openapi('RuntimeModel')

const RuntimeModelListSchema = z
  .object({
    data: z.array(RuntimeModelSchema),
  })
  .openapi('RuntimeModelList')

// The catalog is a global constant, so the runtime path is validated loosely as
// a string: an unknown runtime yields an empty catalog (200), never a 404/500.
const RuntimeParamsSchema = z.object({
  runtime: z.string().openapi({ param: { name: 'runtime', in: 'path' }, example: 'ama' }),
})

const listModelsRoute = createRoute({
  method: 'get',
  path: '/{runtime}/models',
  operationId: 'listRuntimeModels',
  tags: ['Runtimes'],
  summary: "List a runtime's cloud models",
  ...AuthenticatedOperation,
  request: { params: RuntimeParamsSchema },
  responses: {
    200: {
      description: 'Runtime cloud models',
      content: { 'application/json': { schema: RuntimeModelListSchema } },
    },
    401: { description: 'Authentication required', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
})

// runtimes is a read-only derived resource: the cloud model catalog is a global
// domain constant, so any authenticated project may read it. The assembler in
// app.ts mounts this at the resource's chain position.
export function registerRuntimeRoutes(routes: RuntimeRoutes) {
  return routes.openapi(listModelsRoute, async (c) => {
    const { runtime } = c.req.valid('param')
    const auth = await requireAuth(c)
    if (auth instanceof Response) {
      return auth
    }
    return c.json({ data: cloudRuntimeModels(runtime as RuntimeName) }, 200)
  })
}
