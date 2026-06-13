import { expect, gotoAuthed, test } from './fixtures'

// The browser dimension of the e2e crown: drives the real SPA + Worker + D1 + auth
// through Chromium. Reserved for hermetic console journeys (sign-in, routing, admin
// CRUD that only writes D1) per the skill — a handful, not one-per-feature.
test.describe('console (real browser)', () => {
  test('signs in and navigates the console shell [spec: web-console/shell]', async ({ page, token }) => {
    await gotoAuthed(page, token, '/agents')

    // The authenticated shell rendered (the e2e identity resolved client-side).
    await expect(page.getByText('Any Managed Agents').first()).toBeVisible()

    // Navigate to Environments through the primary nav — real client-side routing.
    await page.getByRole('link', { name: 'Environments' }).first().click()
    await expect(page).toHaveURL(/\/environments$/)
    await expect(page.getByRole('button', { name: 'Create environment' })).toBeVisible()
  })

  test('creates an environment through the UI and sees it listed [spec: web-console/resource-lists]', async ({
    page,
    token,
    runId,
  }) => {
    await gotoAuthed(page, token, '/environments')

    await page.getByRole('button', { name: 'Create environment' }).click()
    const name = `ui-env-${runId}`
    const nameField = page.getByLabel('Name')
    await nameField.fill(name)
    await page.getByRole('button', { name: 'Save environment' }).click()

    // The form's mutation writes D1, the list query invalidates + refetches from the
    // real backend, and the new row appears — the full SPA→Worker→D1 round-trip.
    await expect(page.getByText(name)).toBeVisible()
  })
})
