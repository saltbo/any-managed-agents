import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: governance/policy-api]
test('creates a policy and reads the effective policy reflecting the change [spec: governance/policy-api]', async ({
  api,
}) => {
  const createRes = await api.post('/api/v1/policies', {
    data: { scope: { level: 'project' }, toolPolicy: { blockedTools: ['sandbox.exec'] }, metadata: { source: 'e2e' } },
  })
  expect(createRes.status()).toBe(201)
  const created = (await createRes.json()) as Json
  expect(created.scope).toEqual({ level: 'project' })
  expect((created.toolPolicy as Json).blockedTools).toEqual(['sandbox.exec'])

  const effectiveRes = await api.get('/api/v1/effective-policy')
  expect(effectiveRes.status()).toBe(200)
  const effective = (await effectiveRes.json()) as { toolPolicy: Json }
  expect(effective.toolPolicy.blockedTools).toEqual(['sandbox.exec'])
})

// [spec: governance/policy-api] [spec: governance/policy-replace]
test('replaces a policy document and effective policy reflects the replacement [spec: governance/policy-api]', async ({
  api,
}) => {
  const createRes = await api.post('/api/v1/policies', {
    data: { scope: { level: 'project' }, toolPolicy: { blockedTools: ['sandbox.exec'] } },
  })
  expect(createRes.status()).toBe(201)
  const created = (await createRes.json()) as { id: string }

  const replaceRes = await api.put(`/api/v1/policies/${created.id}`, {
    data: { mcpPolicy: { defaultEffect: 'deny' } },
  })
  expect(replaceRes.status()).toBe(200)
  const replaced = (await replaceRes.json()) as Json
  expect(replaced.id).toBe(created.id)
  expect(replaced.toolPolicy).toEqual({})
  expect((replaced.mcpPolicy as Json).defaultEffect).toBe('deny')
})

// [spec: governance/budget-api]
test('creates a project-scoped budget defaulting to enabled [spec: governance/budget-api]', async ({ api }) => {
  const createRes = await api.post('/api/v1/budgets', {
    data: { scope: 'project', limitType: 'tokens', limitValue: 1_000_000, window: 'month' },
  })
  expect(createRes.status()).toBe(201)
  const created = (await createRes.json()) as Json
  expect(created.scope).toBe('project')
  expect(created.limitType).toBe('tokens')
  expect(created.limitValue).toBe(1_000_000)
  expect(created.window).toBe('month')
  expect(created.enabled).toBe(true)
  expect(created.providerId).toBeNull()
  expect(created.modelId).toBeNull()
  expect(JSON.stringify(created)).not.toContain('"status"')
  expect(JSON.stringify(created)).not.toContain('organizationId')
})

// [spec: governance/access-rule-api]
test('creates a wildcard access rule and it appears in the list [spec: governance/access-rule-api]', async ({
  api,
}) => {
  const createRes = await api.post('/api/v1/access-rules', {
    data: { effect: 'deny', reason: 'E2E project-wide pause.' },
  })
  expect(createRes.status()).toBe(201)
  const created = (await createRes.json()) as Json
  expect(created.providerId).toBe('*')
  expect(created.modelId).toBe('*')
  expect(created.teamId).toBeNull()
  expect(created.effect).toBe('deny')
  expect(created.reason).toBe('E2E project-wide pause.')
  expect(JSON.stringify(created)).not.toContain('organizationId')

  const listRes = await api.get('/api/v1/access-rules')
  expect(listRes.status()).toBe(200)
  const list = (await listRes.json()) as { data: Json[] }
  expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))
})
