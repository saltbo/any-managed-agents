import { createRoute, z } from '@hono/zod-openapi'
import { createApiRouter } from '../openapi'

const app = createApiRouter()

const HealthResponseSchema = z
  .object({
    status: z.literal('ok').openapi({ example: 'ok' }),
    name: z.string().openapi({ example: 'Any Managed Agents' }),
    runtime: z.literal('cloudflare-workers').openapi({ example: 'cloudflare-workers' }),
    oidcIssuer: z.string().nullable().openapi({ example: 'https://id.example.com/api/auth' }),
    runnerClientId: z.string().nullable().openapi({ example: 'ama-runner' }),
    runnerScopes: z.string().nullable().openapi({ example: 'openid profile email offline_access' }),
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

export function healthResponse(env: {
  OIDC_ISSUER?: string
  OIDC_RUNNER_CLIENT_ID?: string
  OIDC_RUNNER_SCOPES?: string
}) {
  const runnerClientId = env.OIDC_RUNNER_CLIENT_ID ?? null
  return {
    status: 'ok',
    name: 'Any Managed Agents',
    runtime: 'cloudflare-workers',
    oidcIssuer: env.OIDC_ISSUER?.replace(/\/$/, '') ?? null,
    runnerClientId,
    runnerScopes: runnerClientId ? (env.OIDC_RUNNER_SCOPES ?? 'openid profile email offline_access') : null,
    timestamp: new Date().toISOString(),
  } as const
}

const routes = app.openapi(healthRoute, (c) => c.json(healthResponse(c.env)))

export default routes
