import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import agents from './routes/agents'
import health from './routes/health'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

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
