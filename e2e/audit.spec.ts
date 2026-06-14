import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: audit/auto-record] [spec: audit/records-api]
test('creating a provider produces an audit record with expected fields [spec: audit/auto-record] [spec: audit/records-api]', async ({
  api,
  runId,
}) => {
  // Resource creation that the control plane audits (agent.create is not audited;
  // provider.create is). The handler awaits the audit write before responding, so
  // the record is queryable immediately.
  const createRes = await api.post('/api/v1/providers', {
    data: {
      type: 'openai-compatible',
      displayName: `${runId} audited provider`,
      baseUrl: 'https://models.example.test/v1',
      isDefault: false,
    },
  })
  expect(createRes.status()).toBe(201)
  const provider = (await createRes.json()) as { id: string }

  const listRes = await api.get('/api/v1/audit-records?action=provider.create')
  expect(listRes.status()).toBe(200)
  const list = (await listRes.json()) as { data: Json[] }
  expect(list.data).toContainEqual(
    expect.objectContaining({
      action: 'provider.create',
      resourceType: 'provider',
      resourceId: provider.id,
      outcome: 'success',
    }),
  )
  expect(JSON.stringify(list)).not.toContain('organizationId')
})

// [spec: audit/records-api]
test('reads a single audit record by id [spec: audit/records-api]', async ({ api, runId }) => {
  const createRes = await api.post('/api/v1/access-rules', {
    data: { effect: 'deny', reason: `E2E audit read test ${runId}` },
  })
  expect(createRes.status()).toBe(201)
  const rule = (await createRes.json()) as { id: string }

  const listRes = await api.get('/api/v1/audit-records?action=access_rule.create')
  expect(listRes.status()).toBe(200)
  const list = (await listRes.json()) as { data: Array<{ id: string; resourceId: string }> }
  const record = list.data.find((r) => r.resourceId === rule.id)
  expect(record).toBeTruthy()
  const recordId = record?.id as string

  const readRes = await api.get(`/api/v1/audit-records/${recordId}`)
  expect(readRes.status()).toBe(200)
  const fetched = (await readRes.json()) as Json
  expect(fetched.id).toBe(recordId)
  expect(fetched.action).toBe('access_rule.create')
  expect(fetched.outcome).toBe('success')
})
