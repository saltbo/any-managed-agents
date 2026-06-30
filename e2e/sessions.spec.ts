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
  // Agents must pin a provider+model from the global catalog; seed it first.
  await api.post('/api/v1/e2e/catalog/seed', { data: {} })
  const agentRes = await api.post('/api/v1/agents', {
    data: {
      name: `s-agent-${runId}`,
      systemPrompt: 'x',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
    },
  })
  expect(agentRes.status(), 'seed session agent').toBe(201)
  const agent = (await agentRes.json()) as { metadata: { uid: string } }
  const environmentRes = await api.post('/api/v1/environments', {
    data: { name: `s-env-${runId}` },
  })
  expect(environmentRes.status(), 'seed session environment').toBe(201)
  const environment = (await environmentRes.json()) as { metadata: { uid: string } }
  const title = `ui-session-${runId}`
  const res = await api.post('/api/v1/sessions', {
    data: {
      agentId: agent.metadata.uid,
      environmentId: environment.metadata.uid,
      runtime: 'ama',
      name: title,
      prompt: `Open seeded session ${runId}`,
    },
  })
  expect(res.status(), 'seed session').toBe(201)
  const session = (await res.json()) as { metadata: { uid: string } }

  await gotoAuthed(page, token, '/sessions')
  await expect(page.getByText(title)).toBeVisible()

  await page.goto(`/sessions/${session.metadata.uid}`)
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.metadata.uid}$`))
})
