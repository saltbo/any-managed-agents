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

  const db = drizzle(c.env.DB)
  const now = new Date().toISOString()
  const userId = 'user_e2e'
  const organizationId = 'org_e2e'
  const projectId = 'project_e2e'

  await db
    .insert(users)
    .values({
      id: userId,
      flareauthSubject: 'e2e-user',
      email: 'e2e@example.com',
      name: 'E2E User',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: 'e2e@example.com', name: 'E2E User', updatedAt: now },
    })

  await db
    .insert(organizations)
    .values({
      id: organizationId,
      flareauthOrganizationId: 'flareauth-org-e2e',
      name: 'E2E Organization',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: { name: 'E2E Organization', updatedAt: now },
    })

  await db
    .insert(projects)
    .values({
      id: projectId,
      organizationId,
      name: 'E2E Project',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: { name: 'E2E Project', updatedAt: now },
    })

  await db
    .insert(memberships)
    .values({
      id: 'membership_e2e',
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
