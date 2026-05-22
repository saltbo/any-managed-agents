import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { createApiRouter } from './openapi'
import agents from './routes/agents'
import health from './routes/health'

export function createApp() {
  const app = createApiRouter()

  app.use(
    '/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  )

  app.route('/api/health', health)
  app.route('/api/agents', agents)

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Any Managed Agents API',
      version: '0.1.0',
      description: 'Control-plane API for Any Managed Agents.',
    },
    servers: [{ url: '/api' }],
  })

  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }))

  app.all('/agents/*', async (c) => {
    const { routeAgentRequest } = await import('agents')
    const response = await routeAgentRequest(c.req.raw, c.env)
    return response ?? c.text('Agent not found', 404)
  })

  app.notFound((c) => c.json({ error: { type: 'not_found', message: 'Not found' } }, 404))

  app.onError((err, c) => {
    console.error(err)
    return c.json(
      {
        error: {
          type: 'internal_error',
          message: err instanceof Error ? err.message : 'Internal server error',
        },
      },
      500,
    )
  })

  return app
}
