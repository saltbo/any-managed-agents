import { expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: create a vault through the console UI and see it listed.
test('creates a vault through the UI and sees it listed [spec: web-console/resource-lists]', async ({
  page,
  token,
  runId,
}) => {
  await gotoAuthed(page, token, '/vaults')

  await page.getByRole('button', { name: 'Create vault' }).click()
  const name = `ui-vault-${runId}`
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Save vault' }).click()

  // Mutation writes D1, the list query refetches, the new vault appears.
  await expect(page.getByText(name)).toBeVisible()
})
