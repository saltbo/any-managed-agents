import type { Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, openLocalPage } from './local-app'
import type { AmaWorld } from './world'

export type Json = Record<string, unknown>

export interface ListResponse<T> {
  data: T[]
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
}

export interface E2EState {
  page: Page
  auth?: Json
  runId: string
  agent?: Json
  list?: ListResponse<Json>
  accessToken?: string
}

export type StepsWorld = AmaWorld & { e2e?: E2EState }

export async function ensureSignedIn(world: StepsWorld): Promise<E2EState> {
  if (world.e2e) return world.e2e
  const page = await openLocalPage()
  const auth = (await authenticateE2EPage(page)) as Json
  const accessToken = (await page.evaluate(() => window.localStorage.getItem('ama:e2e-access-token') ?? undefined)) as
    | string
    | undefined
  const state: E2EState = {
    page,
    auth,
    runId: `e2e-shared-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }
  if (accessToken !== undefined) state.accessToken = accessToken
  world.e2e = state
  return state
}

export async function createAgent(state: E2EState, data: Json = {}) {
  return await apiJson<Json>(state.page.request, '/api/v1/agents', {
    method: 'POST',
    data: {
      name: `${state.runId} agent`,
      instructions: 'E2E shared agent',
      ...data,
    },
  })
}
