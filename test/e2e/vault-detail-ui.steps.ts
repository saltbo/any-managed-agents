import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, apiResponse, authenticateE2EPage, openLocalPage } from './local-app'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

// Shares the `e2e` world slot with product-api.steps.ts so the existing
// "Given a vault exists" setup feeds these browser flows.
interface SharedE2EState {
  page: Page
  runId: string
  vault?: Json
  credential?: Json
}

interface VaultDetailUiState {
  releaseDetailResponse?: () => void
  initialSecretValue?: string
  rotatedSecretValue?: string
  addedCredentialName?: string
}

type VaultDetailWorld = AmaWorld & { e2e?: SharedE2EState; vaultUi?: VaultDetailUiState }

function uiState(world: VaultDetailWorld): VaultDetailUiState {
  world.vaultUi ??= {}
  return world.vaultUi
}

async function ensureVaultPage(world: VaultDetailWorld): Promise<SharedE2EState> {
  if (!world.e2e) {
    const page = await openLocalPage()
    await authenticateE2EPage(page)
    world.e2e = { page, runId: `vault-detail-ui-${Date.now()}-${Math.random().toString(16).slice(2)}` }
  }
  const state = world.e2e
  state.vault ??= await apiJson<Json>(state.page.request, '/api/v1/vaults', {
    method: 'POST',
    data: { name: `${state.runId} vault`, description: 'Vault detail UI e2e vault', scope: 'project' },
  })
  return state
}

async function createManagedCredential(state: SharedE2EState, name: string, secretValue: string) {
  return await apiJson<Json>(state.page.request, `/api/v1/vaults/${state.vault?.id}/credentials`, {
    method: 'POST',
    data: {
      name,
      type: 'api_key',
      connectorBinding: { connectorId: 'workers-ai', name: 'apiKey' },
      metadata: { purpose: 'vault-detail-ui-e2e' },
      secret: { provider: 'ama-managed', secretValue },
    },
  })
}

async function openVaultDetail(state: SharedE2EState) {
  await state.page.goto(`/vaults/${state.vault?.id}`)
  await expect(state.page.getByText('Vault profile')).toBeVisible({ timeout: 15_000 })
}

// ─── Scenario: View vault detail ───

When('the user opens vault detail', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  if (!state.credential) {
    scenario.initialSecretValue = `vault-material-view-${state.runId}`
    state.credential = await createManagedCredential(
      state,
      `${state.runId} view credential`,
      scenario.initialSecretValue,
    )
  }
  await openVaultDetail(state)
})

Then(
  'credential names, versions, usage references, and audit history are visible without raw secret values',
  async function (this: VaultDetailWorld) {
    const state = await ensureVaultPage(this)
    const page = state.page
    const credentialName = String(state.credential?.name)
    const referenceName = String((state.credential?.activeVersion as Json)?.referenceName)
    await expect(page.getByText(credentialName)).toBeVisible()
    await expect(page.getByText('v1', { exact: true })).toBeVisible()
    await expect(page.getByText(referenceName)).toBeVisible()
    await expect(page.getByText('Audit history')).toBeVisible()
    await expect(page.getByText('vault_credential.create').first()).toBeVisible()
    const content = await page.content()
    if (uiState(this).initialSecretValue) {
      assert.equal(content.includes(String(uiState(this).initialSecretValue)), false)
    }
    assert.equal(content.includes('encryptedSecretValue'), false, 'ciphertext metadata must not reach the UI')
  },
)

// ─── Scenario: Render vault loading, empty, and archived states ───

Given('the vault detail request is loading', { timeout: 120_000 }, async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  const gate = new Promise<void>((resolve) => {
    scenario.releaseDetailResponse = resolve
  })
  await state.page.route(`**/api/v1/vaults/${state.vault?.id}`, async (route) => {
    await gate
    await route.fallback()
  })
  await state.page.goto(`/vaults/${state.vault?.id}`)
})

Then('the page shows a loading state using shared UI primitives', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  await expect(state.page.getByRole('status', { name: 'Loading vault detail' })).toBeVisible()
  await expect(state.page.locator('[data-slot="skeleton"]').first()).toBeVisible()
  scenario.releaseDetailResponse?.()
  await state.page.unroute(`**/api/v1/vaults/${state.vault?.id}`)
})

When('the vault has no credentials', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await openVaultDetail(state)
})

Then('the credential table shows an empty state and a create action', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await expect(state.page.getByText('No credentials')).toBeVisible()
  await expect(state.page.getByRole('button', { name: 'Add credential' }).first()).toBeVisible()
})

When('the vault is archived', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  // Store one credential before archiving so the archived view still has
  // credential metadata to keep readable.
  scenario.initialSecretValue = `vault-material-archived-${state.runId}`
  state.credential = await createManagedCredential(
    state,
    `${state.runId} archived credential`,
    scenario.initialSecretValue,
  )
  await apiJson<void>(state.page.request, `/api/v1/vaults/${state.vault?.id}`, {
    method: 'PATCH',
    data: { archived: true },
  })
  await openVaultDetail(state)
  await expect(state.page.getByText('archived').first()).toBeVisible()
})

Then('destructive and create actions are hidden or disabled', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await expect(state.page.getByRole('button', { name: 'Add credential' })).toHaveCount(0)
  await expect(state.page.getByRole('button', { name: 'Rotate credential' })).toHaveCount(0)
  await expect(state.page.getByRole('button', { name: 'Revoke credential' })).toHaveCount(0)
})

Then('credential metadata remains readable for audit', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await expect(state.page.getByText(String(state.credential?.name))).toBeVisible()
  await expect(state.page.getByText('v1', { exact: true })).toBeVisible()
  const content = await state.page.content()
  assert.equal(content.includes(String(uiState(this).initialSecretValue)), false)
})

// ─── Scenario: Add a credential from vault detail ───

Given('the vault is active', { timeout: 120_000 }, async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await openVaultDetail(state)
  await expect(state.page.getByText('active').first()).toBeVisible()
})

When('the user opens the add credential dialog', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await state.page.getByRole('button', { name: 'Add credential' }).first().click()
  await expect(state.page.getByRole('dialog')).toBeVisible()
})

Then(
  'name, type, connector binding, secret value, and metadata inputs are shown',
  async function (this: VaultDetailWorld) {
    const dialog = (await ensureVaultPage(this)).page.getByRole('dialog')
    await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Type', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Connector id', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Secret value', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Metadata', { exact: true })).toBeVisible()
  },
)

Then('the secret input uses a password-style control', async function (this: VaultDetailWorld) {
  const dialog = (await ensureVaultPage(this)).page.getByRole('dialog')
  await expect(dialog.getByLabel('Secret value', { exact: true })).toHaveAttribute('type', 'password')
})

Then('save is disabled until required fields are valid', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  const dialog = state.page.getByRole('dialog')
  const save = dialog.getByRole('button', { name: 'Save credential' })
  await expect(save).toBeDisabled()
  scenario.addedCredentialName = `${state.runId} console credential`
  scenario.initialSecretValue = `vault-material-console-${state.runId}`
  await dialog.getByLabel('Name', { exact: true }).fill(scenario.addedCredentialName)
  await expect(save).toBeDisabled()
  await dialog.getByLabel('Type', { exact: true }).fill('api_key')
  await expect(save).toBeDisabled()
  await dialog.getByLabel('Secret value', { exact: true }).fill(scenario.initialSecretValue)
  await expect(save).toBeEnabled()
})

When('the user saves', async function (this: VaultDetailWorld) {
  const dialog = (await ensureVaultPage(this)).page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Save credential' }).click()
})

Then(
  'the dialog closes, the credential list refetches, and the secret value is not rendered',
  async function (this: VaultDetailWorld) {
    const state = await ensureVaultPage(this)
    const scenario = uiState(this)
    await expect(state.page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })
    await expect(state.page.getByText(String(scenario.addedCredentialName))).toBeVisible({ timeout: 10_000 })
    const content = await state.page.content()
    assert.equal(content.includes(String(scenario.initialSecretValue)), false)
  },
)

// ─── Scenario: Rotate and revoke credentials from vault detail ───

Given('a credential exists', { timeout: 120_000 }, async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  scenario.initialSecretValue = `vault-material-rotate-${state.runId}`
  state.credential = await createManagedCredential(
    state,
    `${state.runId} lifecycle credential`,
    scenario.initialSecretValue,
  )
  await openVaultDetail(state)
  await expect(state.page.getByText(String(state.credential.name))).toBeVisible()
})

When('the user rotates it', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  scenario.rotatedSecretValue = `vault-material-rotated-${state.runId}`
  await state.page.getByRole('button', { name: 'Rotate credential' }).first().click()
  const dialog = state.page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const rotate = dialog.getByRole('button', { name: 'Rotate credential' })
  await expect(rotate).toBeDisabled()
  await dialog.getByLabel('New secret value').fill(scenario.rotatedSecretValue)
  await rotate.click()
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
})

Then('a new credential version appears in metadata', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await expect(state.page.getByText('v2', { exact: true })).toBeVisible({ timeout: 10_000 })
})

Then('the old secret value is not displayed', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  const scenario = uiState(this)
  const content = await state.page.content()
  assert.equal(content.includes(String(scenario.initialSecretValue)), false)
  assert.equal(content.includes(String(scenario.rotatedSecretValue)), false)
})

When('the user revokes it and confirms', async function (this: VaultDetailWorld) {
  const state = await ensureVaultPage(this)
  await state.page.getByRole('button', { name: 'Revoke credential' }).first().click()
  const confirm = state.page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Revoke credential' }).click()
  await expect(confirm).not.toBeVisible({ timeout: 10_000 })
})

Then(
  'the credential status becomes revoked and future runtime resolution is blocked',
  async function (this: VaultDetailWorld) {
    const state = await ensureVaultPage(this)
    await expect(state.page.getByText('revoked').first()).toBeVisible({ timeout: 10_000 })

    // Future runtime resolution is blocked: a new session referencing the
    // revoked credential version is rejected at admission.
    const credentialId = String(state.credential?.id)
    const versionId = String(state.credential?.activeVersionId)
    const agent = await apiJson<Json>(state.page.request, '/api/v1/agents', {
      method: 'POST',
      data: { name: `${state.runId} post-revoke agent`, instructions: 'Vault detail UI revoke check' },
    })
    const environment = await apiJson<Json>(state.page.request, '/api/v1/environments', {
      method: 'POST',
      data: { name: `${state.runId} post-revoke env`, runtimeConfig: { image: 'ama-pi-runtime' } },
    })
    const sessionAttempt = await apiResponse(state.page.request, '/api/v1/sessions', {
      method: 'POST',
      data: {
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        title: `${state.runId} post-revoke session`,
        secretEnv: [{ name: 'REVOKED_UI_KEY', credentialRef: { credentialId, versionId } }],
      },
    })
    assert.equal(sessionAttempt.status(), 400, 'revoked credential references must be rejected at admission')
    assert.match(await sessionAttempt.text(), /be active/)
  },
)
