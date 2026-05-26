import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('shared API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes list options through the shared authenticated client', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
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
      expect.objectContaining({
        body: undefined,
        credentials: 'include',
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('accept')).toBe('application/json')
    expect((headers as Headers).get('x-ama-client')).toBe('web-rpc')
  })

  it('uses explicit list options for archived resources', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 50, nextCursor: null, hasMore: false, firstId: null, lastId: null },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listSessions({ includeArchived: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions?includeArchived=true',
      expect.objectContaining({
        body: undefined,
        credentials: 'include',
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('x-ama-client')).toBe('web-rpc')
  })
})
