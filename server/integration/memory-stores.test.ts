import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupOidcProvider, signIn } from './auth'

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

describe('[CF] /api/v1/memory-stores', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('creates stores and manages memory entries [spec: memory-stores/crud]', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Team memory', description: 'Review conventions' }),
    })
    expect(createRes.status).toBe(201)
    const store = (await createRes.json()) as { id: string; name: string; description: string }
    expect(store).toMatchObject({ name: 'Team memory', description: 'Review conventions' })

    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${store.id}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/review.md', content: 'Review for correctness first.' }),
    })
    expect(memoryRes.status).toBe(201)
    const memory = (await memoryRes.json()) as { id: string; path: string; content: string }
    expect(memory).toMatchObject({ path: 'guides/review.md', content: 'Review for correctness first.' })

    const duplicateRes = await jsonFetch(`/api/v1/memory-stores/${store.id}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/review.md', content: 'Duplicate' }),
    })
    expect(duplicateRes.status).toBe(409)

    const unsafeRes = await jsonFetch(`/api/v1/memory-stores/${store.id}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: '../escape.md', content: 'Invalid' }),
    })
    expect(unsafeRes.status).toBe(400)

    const updateRes = await jsonFetch(`/api/v1/memory-stores/${store.id}/memories/${memory.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ path: 'guides/updated.md', content: 'Updated content.' }),
    })
    expect(updateRes.status).toBe(200)
    await expect(updateRes.json()).resolves.toMatchObject({ path: 'guides/updated.md', content: 'Updated content.' })

    const listRes = await jsonFetch(`/api/v1/memory-stores/${store.id}/memories`, authorization)
    expect(listRes.status).toBe(200)
    await expect(listRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ path: 'guides/updated.md' })],
    })

    const archiveRes = await jsonFetch(`/api/v1/memory-stores/${store.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({ archivedAt: expect.any(String) })
  })
})
