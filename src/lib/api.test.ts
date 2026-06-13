import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('shared API client', () => {
  beforeEach(() => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:api-test')
    window.localStorage.setItem('ama:selected-project-id', 'project_test')
  })

  function headerValue(headers: HeadersInit | undefined, name: string) {
    if (headers instanceof Headers) {
      return headers.get(name)
    }
    if (Array.isArray(headers)) {
      return new Headers(headers).get(name)
    }
    return headers?.[name]
  }

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('serializes list options through the shared authenticated client', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 25, nextCursor: null, hasMore: false },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listAgents({
      archived: true,
      search: 'research',
      createdFrom: '2026-05-01T00:00:00.000Z',
      createdTo: '2026-05-31T23:59:59.999Z',
      limit: 25,
      cursor: 'cursor_value',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/agents?archived=true&search=research&createdFrom=2026-05-01T00%3A00%3A00.000Z&createdTo=2026-05-31T23%3A59%3A59.999Z&limit=25&cursor=cursor_value',
      expect.objectContaining({
        body: undefined,
        credentials: 'include',
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headerValue(headers, 'accept')).toBe('application/json')
    expect(headerValue(headers, 'authorization')).toBe('Bearer e2e:api-test')
    expect(headerValue(headers, 'x-ama-project-id')).toBe('project_test')
    expect(headerValue(headers, 'x-ama-client')).toBe('web-rpc')
  })

  it('uses explicit list options for archived resources', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 50, nextCursor: null, hasMore: false },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listSessions({ archived: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions?archived=true',
      expect.objectContaining({
        body: undefined,
        credentials: 'include',
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headerValue(headers, 'authorization')).toBe('Bearer e2e:api-test')
    expect(headerValue(headers, 'x-ama-client')).toBe('web-rpc')
  })
})
