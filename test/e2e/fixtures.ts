import { type APIRequestContext, test as base, expect, request } from '@playwright/test'
import { AmaClient } from '../../sdk/typescript/src/index'

const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5173}`

export type E2eToken = {
  accessToken: string
  projectId: string
  userId: string
  organizationId: string
}

type Fixtures = {
  // A per-test run id, unique enough to isolate the rows each crown creates.
  runId: string
  // The local e2e bearer token (minted via the AMA_E2E_TEST_AUTH harness route).
  token: E2eToken
  // An authenticated APIRequestContext for raw control-plane calls.
  api: APIRequestContext
  // The generated SDK client — how an external product drives AMA.
  ama: AmaClient
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture deps from the destructured arg; this fixture has none.
  runId: async ({}, use) => {
    await use(`e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  },
  token: async ({ runId }, use) => {
    const res = await fetch(`${BASE}/api/v1/e2e/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    })
    if (res.status !== 201) {
      throw new Error(`POST /api/v1/e2e/auth/token returned ${res.status}: ${await res.text()}`)
    }
    await use((await res.json()) as E2eToken)
  },
  api: async ({ token }, use) => {
    const ctx = await request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: {
        authorization: `Bearer ${token.accessToken}`,
        'x-ama-project-id': token.projectId,
      },
    })
    await use(ctx)
    await ctx.dispose()
  },
  ama: async ({ token }, use) => {
    await use(new AmaClient({ origin: BASE, accessToken: token.accessToken, projectId: token.projectId }))
  },
})

export { expect }
