import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudflareSecretRequests, defaultClaims, setupOidcProvider, signIn } from '../test/auth'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

describe('[CF] /api/v1/vaults', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication before creating vault metadata', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/vaults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Provider credentials' }),
    })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('creates, lists, reads, updates, and archives project-scoped vaults', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Provider credentials',
        description: 'Runtime credential metadata',
        scope: 'project',
        metadata: { owner: 'platform' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      scope: string
      archivedAt: string | null
      metadata: unknown
    }
    expect(created).toMatchObject({ scope: 'project', archivedAt: null, metadata: { owner: 'platform' } })
    expect(created).not.toHaveProperty('status')
    expect(created).not.toHaveProperty('organizationId')

    const readRes = await jsonFetch(`/api/v1/vaults/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, name: 'Provider credentials' })

    const updateRes = await jsonFetch(`/api/v1/vaults/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated credentials' }),
    })
    expect(updateRes.status).toBe(200)
    await expect(updateRes.json()).resolves.toMatchObject({ id: created.id, name: 'Updated credentials' })

    const archiveRes = await jsonFetch(`/api/v1/vaults/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({ id: created.id, archivedAt: expect.any(String) })

    const deleteRes = await jsonFetch(`/api/v1/vaults/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(404)

    const defaultListRes = await jsonFetch('/api/v1/vaults', authorization)
    const defaultList = (await defaultListRes.json()) as { data: Array<{ id: string }> }
    expect(defaultList.data).not.toContainEqual(expect.objectContaining({ id: created.id }))

    const archivedListRes = await jsonFetch('/api/v1/vaults?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; archivedAt: string | null }> }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({ id: created.id, archivedAt: expect.any(String) }),
    )

    const createCredentialRes = await jsonFetch(`/api/v1/vaults/${created.id}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Archived vault token',
        type: 'api_key',
        secret: { provider: 'cloudflare-secrets', secretValue: 'raw-secret-for-archived-vault' },
      }),
    })
    expect(createCredentialRes.status).toBe(409)
    await expect(createCredentialRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Vault is archived' },
    })

    const restoreRes = await jsonFetch(`/api/v1/vaults/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(restoreRes.status).toBe(200)
    await expect(restoreRes.json()).resolves.toMatchObject({ id: created.id, archivedAt: null })
  })

  it('stores credential secret references only, redacts every response, rotates, revokes, and hard-deletes versions', async () => {
    const rawSecret = 'raw-secret-material'
    const rotatedSecret = 'rotated-secret-material'
    const thirdSecret = 'third-secret-material'
    const authorization = await signIn()
    const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Provider credentials' }),
    })
    const vault = (await vaultRes.json()) as { id: string }

    const createCredentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Workers AI token',
        type: 'api_key',
        connectorBinding: { connectorId: 'workers-ai', name: 'apiKey' },
        secret: { provider: 'cloudflare-secrets', secretValue: rawSecret },
      }),
    })
    expect(createCredentialRes.status).toBe(201)
    const credential = (await createCredentialRes.json()) as {
      id: string
      state: string
      activeVersionId: string
      activeVersion: { id: string; version: number; secretRef: string; hasSecret: boolean; state: string }
    }
    expect(credential.state).toBe('active')
    expect(credential.activeVersion.version).toBe(1)
    expect(credential.activeVersion.state).toBe('active')
    expect(credential.activeVersion.hasSecret).toBe(true)
    expect(credential).not.toHaveProperty('status')
    expect(credential.activeVersion).not.toHaveProperty('status')
    expect(credential.activeVersion).not.toHaveProperty('deletedAt')
    expect(JSON.stringify(credential)).not.toContain(rawSecret)
    expect(cloudflareSecretRequests().writes).toHaveLength(1)
    expect(JSON.stringify(cloudflareSecretRequests().writes[0])).toContain(rawSecret)

    const readCredentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials/${credential.id}`, authorization)
    expect(readCredentialRes.status).toBe(200)
    expect(JSON.stringify(await readCredentialRes.clone().json())).not.toContain(rawSecret)

    const listCredentialsRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization)
    expect(listCredentialsRes.status).toBe(200)
    expect(JSON.stringify(await listCredentialsRes.clone().json())).not.toContain(rawSecret)

    const scopeChangeRes = await jsonFetch(`/api/v1/vaults/${vault.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ scope: 'organization' }),
    })
    expect(scopeChangeRes.status).toBe(409)
    await expect(scopeChangeRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Vault scope cannot change after credentials exist' },
    })

    const dbRows = await env.DB.prepare(
      'SELECT vault_credentials.id, vault_credentials.connector_binding, vault_credentials.metadata, vault_credential_versions.secret_ref, vault_credential_versions.external_vault_path, vault_credential_versions.reference_name, vault_credential_versions.metadata AS version_metadata FROM vault_credentials JOIN vault_credential_versions ON vault_credentials.id = vault_credential_versions.credential_id',
    ).all()
    expect(JSON.stringify(dbRows.results)).not.toContain(rawSecret)

    const invalidCredentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid token',
        type: 'api_key',
        secret: { provider: 'external-vault' },
      }),
    })
    expect(invalidCredentialRes.status).toBe(400)
    const credentialCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM vault_credentials WHERE vault_id = ?')
      .bind(vault.id)
      .first<{ count: number }>()
    expect(credentialCount?.count).toBe(1)

    const mixedProviderRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Mixed token',
        type: 'api_key',
        secret: {
          provider: 'external-vault',
          secretValue: 'raw-secret-that-must-be-rejected',
          externalVaultPath: 'vault://team/mixed/token',
        },
      }),
    })
    expect(mixedProviderRes.status).toBe(400)

    const rotateRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ provider: 'cloudflare-secrets', secretValue: rotatedSecret }),
      },
    )
    expect(rotateRes.status).toBe(201)
    const rotated = (await rotateRes.json()) as {
      activeVersionId: string
      activeVersion: { id: string; version: number; state: string }
    }
    expect(rotated.activeVersion.version).toBe(2)
    expect(JSON.stringify(rotated)).not.toContain(rotatedSecret)
    expect(cloudflareSecretRequests().writes).toHaveLength(2)
    expect(JSON.stringify(cloudflareSecretRequests().writes[1])).toContain(rotatedSecret)

    const versionsAfterRotateRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
      authorization,
    )
    const versionsAfterRotate = (await versionsAfterRotateRes.json()) as {
      data: Array<{ id: string; state: string; supersededAt: string | null }>
    }
    expect(versionsAfterRotate.data).toContainEqual(
      expect.objectContaining({
        id: credential.activeVersion.id,
        state: 'superseded',
        supersededAt: expect.any(String),
      }),
    )

    const versionItemRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions/${credential.activeVersion.id}`,
      authorization,
    )
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      id: credential.activeVersion.id,
      credentialId: credential.id,
      state: 'superseded',
    })

    const environmentRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runtime with pinned credential',
        credentialRefs: [{ credentialId: credential.id, versionId: credential.activeVersion.id }],
      }),
    })
    expect(environmentRes.status).toBe(201)

    const deleteReferencedRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions/${credential.activeVersion.id}`,
      authorization,
      { method: 'DELETE' },
    )
    expect(deleteReferencedRes.status).toBe(409)
    await expect(deleteReferencedRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Credential version is referenced by active runtime metadata' },
    })

    const secondVersionId = rotated.activeVersion.id
    const thirdRotateRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ provider: 'cloudflare-secrets', secretValue: thirdSecret }),
      },
    )
    expect(thirdRotateRes.status).toBe(201)
    const thirdRotated = (await thirdRotateRes.json()) as { activeVersion: { id: string } }
    expect(JSON.stringify(thirdRotated)).not.toContain(thirdSecret)

    const deleteActiveRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions/${thirdRotated.activeVersion.id}`,
      authorization,
      { method: 'DELETE' },
    )
    expect(deleteActiveRes.status).toBe(409)
    await expect(deleteActiveRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Active credential version cannot be deleted' },
    })

    const deleteUnusedRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions/${secondVersionId}`,
      authorization,
      { method: 'DELETE' },
    )
    expect(deleteUnusedRes.status).toBe(204)
    expect(cloudflareSecretRequests().deletes).toContain(`secret_AMA_${credential.id.toUpperCase()}_V2`)

    const deletedVersionRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions/${secondVersionId}`,
      authorization,
    )
    expect(deletedVersionRes.status).toBe(404)

    const deletedVersionRow = await env.DB.prepare('SELECT id FROM vault_credential_versions WHERE id = ?')
      .bind(secondVersionId)
      .first()
    expect(deletedVersionRow).toBeNull()

    const versionsRes = await SELF.fetch(
      `https://example.com/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
    )
    expect(versionsRes.status).toBe(401)
    const authenticatedVersionsRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
      authorization,
    )
    const versions = (await authenticatedVersionsRes.json()) as {
      data: Array<{ id: string; state: string }>
    }
    expect(versions.data).not.toContainEqual(expect.objectContaining({ id: secondVersionId }))
    expect(JSON.stringify(versions)).not.toContain(rawSecret)
    expect(JSON.stringify(versions)).not.toContain(rotatedSecret)
    expect(JSON.stringify(versions)).not.toContain(thirdSecret)

    const rotatedDbRows = await env.DB.prepare(
      'SELECT secret_ref, external_vault_path, reference_name, metadata FROM vault_credential_versions',
    ).all()
    expect(JSON.stringify(rotatedDbRows.results)).not.toContain(rawSecret)
    expect(JSON.stringify(rotatedDbRows.results)).not.toContain(rotatedSecret)
    expect(JSON.stringify(rotatedDbRows.results)).not.toContain(thirdSecret)

    const revokeRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials/${credential.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'revoked', revokeReason: 'Replaced by provider binding' }),
    })
    expect(revokeRes.status).toBe(200)
    await expect(revokeRes.json()).resolves.toMatchObject({
      id: credential.id,
      state: 'revoked',
      activeVersionId: null,
      activeVersion: null,
      revokeReason: 'Replaced by provider binding',
    })
    const versionsAfterRevokeRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
      authorization,
    )
    const versionsAfterRevoke = (await versionsAfterRevokeRes.json()) as {
      data: Array<{ id: string; state: string; revokedAt: string | null }>
    }
    expect(versionsAfterRevoke.data).toContainEqual(
      expect.objectContaining({ id: thirdRotated.activeVersion.id, state: 'revoked', revokedAt: expect.any(String) }),
    )

    const revokedListRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials?state=revoked`, authorization)
    expect(revokedListRes.status).toBe(200)
    await expect(revokedListRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: credential.id, state: 'revoked' })],
    })

    const rotateRevokedRes = await jsonFetch(
      `/api/v1/vaults/${vault.id}/credentials/${credential.id}/versions`,
      authorization,
      {
        method: 'POST',
        body: JSON.stringify({ provider: 'cloudflare-secrets', secretValue: 'after-revoke' }),
      },
    )
    expect(rotateRevokedRes.status).toBe(409)
    await expect(rotateRevokedRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Credential is not active' },
    })
  })

  it('supports approved external vault paths without exposing cross-project metadata', async () => {
    const authorization = await signIn()
    const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'External vault' }),
    })
    const vault = (await vaultRes.json()) as { id: string }
    const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'GitHub token',
        type: 'oauth_token',
        secret: { provider: 'external-vault', externalVaultPath: 'vault://team/github/token' },
      }),
    })
    expect(credentialRes.status).toBe(201)
    await expect(credentialRes.json()).resolves.toMatchObject({
      activeVersion: {
        provider: 'external-vault',
        secretRef: 'vault://team/github/token',
        externalVaultPath: 'vault://team/github/token',
        hasSecret: true,
      },
    })

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })
    const crossProjectRead = await jsonFetch(`/api/v1/vaults/${vault.id}`, otherCookie)
    expect(crossProjectRead.status).toBe(404)

    const crossProjectCredentialRead = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, otherCookie)
    expect(crossProjectCredentialRead.status).toBe(404)
  })

  it('isolates project vaults inside the same organization and shares organization-scoped vaults', async () => {
    const authorization = await signIn()
    const projectVaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Project vault', scope: 'project' }),
    })
    const projectVault = (await projectVaultRes.json()) as { id: string }
    const orgVaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Organization vault', scope: 'organization' }),
    })
    const orgVault = (await orgVaultRes.json()) as { id: string }

    const vaultRow = await env.DB.prepare('SELECT organization_id FROM vaults WHERE id = ?')
      .bind(projectVault.id)
      .first<{ organization_id: string }>()
    expect(vaultRow?.organization_id).toBeTruthy()

    const alternateProjectId = `project_${crypto.randomUUID().replaceAll('-', '')}`
    await env.DB.prepare(
      'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        alternateProjectId,
        vaultRow?.organization_id,
        'Alternate Project',
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run()
    const projectReadRes = await jsonFetch(`/api/v1/vaults/${projectVault.id}`, authorization, {
      headers: { 'x-ama-project-id': alternateProjectId },
    })
    expect(projectReadRes.status).toBe(404)

    const orgReadRes = await jsonFetch(`/api/v1/vaults/${orgVault.id}`, authorization, {
      headers: { 'x-ama-project-id': alternateProjectId },
    })
    expect(orgReadRes.status).toBe(200)
    await expect(orgReadRes.json()).resolves.toMatchObject({ id: orgVault.id, scope: 'organization' })
  })
})
