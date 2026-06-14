import { expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: create a provider through the console UI and see it listed.
test('creates a provider through the UI and sees it listed [spec: web-console/resource-lists]', async ({
  page,
  token,
  runId,
}) => {
  await gotoAuthed(page, token, '/providers')

  await page.getByRole('button', { name: 'Create provider' }).click()
  const name = `ui-provider-${runId}`
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Base URL').fill('https://models.example.test/v1')
  await page.getByRole('button', { name: 'Save provider' }).click()

  await expect(page.getByText(name)).toBeVisible()
})
