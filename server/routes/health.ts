import { Hono } from 'hono'
import type { Env } from '../env'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) =>
  c.json({
    status: 'ok',
    name: 'Any Managed Agents',
    runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(),
  }),
)

export default app
