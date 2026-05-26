import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { getBearerClaims, upsertProjectForClaims } from '../auth/oidc'
import { requireAuth } from '../auth/session'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { dispatchDueScheduledTriggers } from '../schedules/dispatcher'

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
  .post('/scheduled-agent-triggers/dispatch', async (c) => {
    if (c.env.AMA_E2E_TEST_AUTH !== 'true' || c.env.AMA_RUNTIME_MODE !== 'test') {
      return errorResponse(c, 404, 'not_found', 'Not found')
    }
    const db = drizzle(c.env.DB)
    const auth = await requireAuth(c, db)
    if (auth instanceof Response) {
      return auth
    }
    const body: { heartbeatAt?: string } = await c.req.json<{ heartbeatAt?: string }>().catch(() => ({}))
    const result = await dispatchDueScheduledTriggers(c.env, c.executionCtx, {
      ...(body.heartbeatAt !== undefined ? { heartbeatAt: body.heartbeatAt } : {}),
      projectId: auth.project.id,
    })
    return c.json(result, 200)
  })

export default routes
