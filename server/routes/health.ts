import { createRoute, z } from '@hono/zod-openapi'
import { createApiRouter } from '../openapi'

const app = createApiRouter()

const HealthResponseSchema = z
  .object({
    status: z.literal('ok').openapi({ example: 'ok' }),
    name: z.string().openapi({ example: 'Any Managed Agents' }),
    runtime: z.literal('cloudflare-workers').openapi({ example: 'cloudflare-workers' }),
    timestamp: z.string().datetime().openapi({ example: '2026-05-22T00:00:00.000Z' }),
  })
  .openapi('HealthResponse')

const healthRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'getHealth',
  tags: ['System'],
  summary: 'Get Worker health',
  responses: {
    200: {
      description: 'Worker health status',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
})

const routes = app.openapi(healthRoute, (c) =>
  c.json({
    status: 'ok',
    name: 'Any Managed Agents',
    runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(),
  }),
)

export default routes
