import { expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: a seeded session renders in the console list and its
// routed detail page opens (session create drives the runtime + auto-selects the
// active agent/env — that flow is covered by web component tests + integration).
test('lists a seeded session and opens its detail page [spec: web-console/routed-pages]', async ({
  page,
  token,
  api,
  runId,
}) => {
  const agent = (await (
    await api.post('/api/v1/agents', { data: { name: `s-agent-${runId}`, instructions: 'x' } })
  ).json()) as { id: string }
  const environment = (await (
    await api.post('/api/v1/environments', {
      data: { name: `s-env-${runId}`, runtimeConfig: { image: 'ama-pi-runtime' } },
    })
  ).json()) as { id: string }
  const title = `ui-session-${runId}`
  const res = await api.post('/api/v1/sessions', {
    data: { agentId: agent.id, environmentId: environment.id, runtime: 'ama', title },
  })
  expect(res.status(), 'seed session').toBe(201)
  const session = (await res.json()) as { id: string }

  await gotoAuthed(page, token, '/sessions')
  await expect(page.getByText(title)).toBeVisible()

  await page.goto(`/sessions/${session.id}`)
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`))
})
