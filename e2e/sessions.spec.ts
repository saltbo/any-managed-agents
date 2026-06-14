import type { AmaClient } from '../sdk/typescript/src/index'
import { expect, test } from './fixtures'

type Json = Record<string, unknown>
type SdkList = { data: Json[]; pagination: { limit: number; hasMore: boolean; nextCursor: string | null } }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForIdleSession(ama: AmaClient, sessionId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await ama.request<Json>('readSession', { path: { sessionId } })
    if (session.state === 'idle') return session
    if (session.state === 'error') throw new Error(`Session startup failed: ${session.stateReason ?? 'unknown'}`)
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not become idle before timeout`)
}

// [spec: sessions/create] Create a session from an active agent and environment.
test('creates a session and polls it to idle, then reads events [spec: sessions/create]', async ({ ama, runId }) => {
  // Create the agent dependency
  const agent = await ama.request<Json>('createAgent', {
    body: {
      name: `${runId} session agent`,
      instructions: 'Work through AMA runtime.',
      model: '@cf/moonshotai/kimi-k2.6',
    },
  })
  expect(typeof agent.id).toBe('string')
  expect((agent.id as string).length).toBeGreaterThan(0)

  // Create the environment dependency
  const environment = await ama.request<Json>('createEnvironment', {
    body: {
      name: `${runId} session env`,
      runtimeConfig: { image: 'ama-pi-runtime' },
    },
  })
  expect(typeof environment.id).toBe('string')
  expect((environment.id as string).length).toBeGreaterThan(0)

  // Create the session
  const created = await ama.request<Json>('createSession', {
    body: {
      agentId: agent.id,
      environmentId: environment.id,
      runtime: 'ama',
      title: `${runId} happy-path session`,
      metadata: { ticket: `e2e-${runId}` },
    },
  })
  expect(typeof created.id).toBe('string')
  expect((created.id as string).length).toBeGreaterThan(0)

  const sessionId = created.id as string

  // Poll until idle
  const session = await waitForIdleSession(ama, sessionId)

  // Assert stable id, state, and runtimeMetadata
  expect(session.id).toBe(sessionId)
  expect(session.state).toBe('idle')
  expect('stateReason' in session).toBe(true)

  const runtimeMetadata = session.runtimeMetadata as Json
  expect(runtimeMetadata.runtime).toBe('ama')
  expect(runtimeMetadata.hostingMode).toBe('cloud')
  expect(runtimeMetadata.provider).toBeTruthy()

  // Re-read and verify id is stable
  const fetched = await ama.request<Json>('readSession', { path: { sessionId } })
  expect(fetched.id).toBe(sessionId)
  expect(fetched.state).toBe('idle')

  // GET events returns a data array
  const events = await ama.request<SdkList>('listSessionEvents', {
    path: { sessionId },
    query: { limit: 100 },
  })
  expect(Array.isArray(events.data)).toBe(true)
  expect(typeof events.pagination.hasMore).toBe('boolean')
  expect('nextCursor' in events.pagination).toBe(true)
})
