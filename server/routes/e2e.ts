import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { getBearerClaims, upsertProjectForClaims } from '../auth/oidc'
import type { Env } from '../env'
import { errorResponse } from '../errors'

const app = new Hono<{ Bindings: Env }>()

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

const routes = app
  .post('/auth/token', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }

    const body: { runId?: string } = await c.req.json<{ runId?: string }>().catch(() => ({}))
    const runId = body.runId?.replaceAll(/[^A-Za-z0-9_-]/g, '_') || newId('run')
    const accessToken = `e2e:${runId}`
    const claims = await getBearerClaims(c.env, accessToken)
    const project = await upsertProjectForClaims(drizzle(c.env.DB), claims, new Date().toISOString())
    return c.json({ accessToken, userId: claims.sub, organizationId: claims.org_id, projectId: project.id }, 201)
  })
  .get('/ready', (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    return c.json({ ok: true, runtimeMode: c.env.AMA_RUNTIME_MODE ?? null })
  })

export default routes
