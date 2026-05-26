import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { createSession } from '../auth/session'
import { memberships, organizations, projects, users } from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'

const app = new Hono<{ Bindings: Env }>()

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

app.post('/auth/session', async (c) => {
  if (c.env.AMA_E2E_TEST_AUTH !== 'true') {
    return errorResponse(c, 404, 'not_found', 'Not found')
  }

  const body: { runId?: string } = await c.req.json<{ runId?: string }>().catch(() => ({}))
  const runId = body.runId?.replaceAll(/[^A-Za-z0-9_-]/g, '_') || newId('run')
  const db = drizzle(c.env.DB)
  const now = new Date().toISOString()
  const userId = `user_e2e_${runId}`
  const organizationId = `org_e2e_${runId}`
  const projectId = `project_e2e_${runId}`
  const membershipId = `membership_e2e_${runId}`

  await db
    .insert(users)
    .values({
      id: userId,
      flareauthSubject: `e2e-user-${runId}`,
      email: `${runId}@e2e.example.com`,
      name: `E2E User ${runId}`,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: `${runId}@e2e.example.com`, name: `E2E User ${runId}`, updatedAt: now },
    })

  await db
    .insert(organizations)
    .values({
      id: organizationId,
      flareauthOrganizationId: `flareauth-org-e2e-${runId}`,
      name: `E2E Organization ${runId}`,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: { name: `E2E Organization ${runId}`, updatedAt: now },
    })

  await db
    .insert(projects)
    .values({
      id: projectId,
      organizationId,
      name: `E2E Project ${runId}`,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: { name: `E2E Project ${runId}`, updatedAt: now },
    })

  await db
    .insert(memberships)
    .values({
      id: membershipId,
      userId,
      organizationId,
      roles: JSON.stringify(['owner']),
      permissions: JSON.stringify(['agents:write', 'agents:read', 'environments:write', 'sessions:write']),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: memberships.id,
      set: {
        roles: JSON.stringify(['owner']),
        permissions: JSON.stringify(['agents:write', 'agents:read', 'environments:write', 'sessions:write']),
        updatedAt: now,
      },
    })

  await createSession(c, db, {
    id: newId('appsess'),
    userId,
    organizationId,
    projectId,
    now,
  })

  return c.json({ userId, organizationId, projectId }, 201)
})

app.get('/ready', (c) => {
  if (c.env.AMA_E2E_TEST_AUTH !== 'true') {
    return errorResponse(c, 404, 'not_found', 'Not found')
  }
  return c.json({ ok: true, runtimeMode: c.env.AMA_RUNTIME_MODE ?? null })
})

export default app
