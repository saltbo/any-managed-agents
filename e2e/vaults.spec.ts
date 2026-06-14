import { expect, test } from './fixtures'

type Json = Record<string, unknown>

// [spec: vaults/api-crud]
test('creates a vault and reads it back [spec: vaults/api-crud]', async ({ api, runId }) => {
  const createRes = await api.post('/api/v1/vaults', {
    data: {
      name: `${runId} provider credentials`,
      description: 'Runtime credential metadata',
      scope: 'project',
      metadata: { owner: 'platform' },
    },
  })
  expect(createRes.status(), 'POST /api/v1/vaults').toBe(201)
  const vault = (await createRes.json()) as Json
  expect(typeof vault.id).toBe('string')
  expect(vault.scope).toBe('project')
  expect(vault.archivedAt).toBeNull()
  expect((vault.metadata as Json).owner).toBe('platform')

  const readRes = await api.get(`/api/v1/vaults/${vault.id}`)
  expect(readRes.status(), `GET /api/v1/vaults/${vault.id}`).toBe(200)
  const read = (await readRes.json()) as Json
  expect(read.id).toBe(vault.id)
  expect(read.name).toBe(`${runId} provider credentials`)
})

// [spec: vaults/api-crud] credential sub-resource
test('adds a credential to a vault and reads it back without the secret [spec: vaults/api-crud]', async ({
  api,
  runId,
}) => {
  const vaultRes = await api.post('/api/v1/vaults', {
    data: { name: `${runId} token vault` },
  })
  expect(vaultRes.status(), 'POST /api/v1/vaults').toBe(201)
  const vault = (await vaultRes.json()) as Json

  const credRes = await api.post(`/api/v1/vaults/${vault.id}/credentials`, {
    data: {
      name: 'Workers AI token',
      type: 'api_key',
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-e2e-secret' },
    },
  })
  expect(credRes.status(), `POST /api/v1/vaults/${vault.id}/credentials`).toBe(201)
  const credential = (await credRes.json()) as Json
  expect(credential.state).toBe('active')
  const activeVersion = credential.activeVersion as Json
  expect(activeVersion.version).toBe(1)
  expect(activeVersion.state).toBe('active')
  expect(activeVersion.hasSecret).toBe(true)
  // Secret must never be returned.
  expect(JSON.stringify(credential)).not.toContain('raw-e2e-secret')

  const readCredRes = await api.get(`/api/v1/vaults/${vault.id}/credentials/${credential.id}`)
  expect(readCredRes.status(), `GET /api/v1/vaults/${vault.id}/credentials/${credential.id}`).toBe(200)
  const readCred = (await readCredRes.json()) as Json
  expect(readCred.id).toBe(credential.id)
  expect(JSON.stringify(readCred)).not.toContain('raw-e2e-secret')
})
