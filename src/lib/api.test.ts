import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('shared API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes list options through the shared authenticated client', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 25, nextCursor: null, hasMore: false, firstId: null, lastId: null },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listAgents({
      includeArchived: true,
      search: 'research',
      status: 'active',
      createdFrom: '2026-05-01T00:00:00.000Z',
      createdTo: '2026-05-31T23:59:59.999Z',
      limit: 25,
      cursor: 'cursor_value',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agents?includeArchived=true&search=research&status=active&createdFrom=2026-05-01T00%3A00%3A00.000Z&createdTo=2026-05-31T23%3A59%3A59.999Z&limit=25&cursor=cursor_value',
      {
        credentials: 'include',
        headers: { accept: 'application/json' },
      },
    )
  })

  it('keeps legacy boolean list calls on the shared query builder', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 50, nextCursor: null, hasMore: false, firstId: null, lastId: null },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listSessions(true)

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions?includeArchived=true', {
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
  })
})
