import { describe, expect, it, vi } from 'vitest'

// The router records usage through the usage-write repo on the DO path; mock it
// so the unit suite needs no D1, while still asserting the "record exactly once"
// invariant fires for cloud-loop appends.
const recordProviderSignals = vi.fn()
vi.mock('../repos/usage-write', () => ({ createUsageWriteRepo: () => ({ recordProviderSignals }) }))

import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import { createCloudLoopChecker, createSessionEventStore } from './session-event-store'

function fakeStampDb(row: { metadata: string | null } | undefined) {
  const get = vi.fn().mockResolvedValue(row)
  const db = { select: vi.fn(() => ({ from: () => ({ where: () => ({ get }) }) })), _get: get }
  return db
}

describe('createCloudLoopChecker', () => {
  it('returns true for a session stamped session-do and caches the lookup', async () => {
    const db = fakeStampDb({ metadata: JSON.stringify({ eventStore: 'session-do' }) })
    const check = createCloudLoopChecker(db as never)
    expect(await check('sess_1')).toBe(true)
    expect(await check('sess_1')).toBe(true)
    expect(db._get).toHaveBeenCalledTimes(1)
  })

  it('returns false when the session is unstamped, missing, or has no metadata', async () => {
    expect(
      await createCloudLoopChecker(fakeStampDb({ metadata: JSON.stringify({ runtime: 'ama' }) }) as never)('s'),
    ).toBe(false)
    expect(await createCloudLoopChecker(fakeStampDb({ metadata: null }) as never)('s')).toBe(false)
    expect(await createCloudLoopChecker(fakeStampDb(undefined) as never)('s')).toBe(false)
  })
})

function fakeDoStore() {
  return {
    append: vi.fn().mockResolvedValue({ id: 'do_event', sequence: 1, record: { id: 'do_event' } }),
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'do_event' }], hasMore: false }),
    stream: vi.fn().mockResolvedValue([{ type: 'turn_end', payload: '{}' }]),
    count: vi.fn().mockResolvedValue(1),
    archive: vi.fn().mockResolvedValue(undefined),
  }
}

function fakeD1() {
  return {
    append: vi.fn().mockResolvedValue('d1_event'),
    queryEvents: vi.fn().mockResolvedValue({ rows: [{ id: 'd1_event' }], hasMore: false }),
    eventStream: vi.fn().mockResolvedValue([{ type: 'message_end', payload: '{}' }]),
  }
}

const scope = { organizationId: 'org_1', projectId: 'project_1', sessionId: 'sess_1' }
const canonical: CanonicalAmaSessionEvent = {
  type: 'turn_end',
  payload: {},
  visibility: 'runtime',
  role: null,
  metadata: {},
}
const query = { order: 'asc' as const, limit: 50 }

function makeStore(inDo: boolean) {
  const doStore = fakeDoStore()
  const d1 = fakeD1()
  const store = createSessionEventStore({} as never, async () => inDo, doStore as never, d1)
  return { store, doStore, d1 }
}

describe('createSessionEventStore — storage follows the loop', () => {
  it('cloud-loop append goes to the DO and records usage exactly once', async () => {
    recordProviderSignals.mockClear()
    const { store, doStore, d1 } = makeStore(true)
    const id = await store.appendCanonicalEvent(scope, canonical, { parentEventId: 'p', correlationId: 'c' })
    expect(id).toBe('do_event')
    expect(doStore.append).toHaveBeenCalledWith(scope, canonical, { parentEventId: 'p', correlationId: 'c' })
    expect(d1.append).not.toHaveBeenCalled()
    expect(recordProviderSignals).toHaveBeenCalledTimes(1)
  })

  it('non-cloud append goes to D1 (which records usage inline) — no double count', async () => {
    recordProviderSignals.mockClear()
    const { store, doStore, d1 } = makeStore(false)
    const id = await store.appendCanonicalEvent(scope, canonical)
    expect(id).toBe('d1_event')
    expect(d1.append).toHaveBeenCalledWith(scope, canonical, undefined)
    expect(doStore.append).not.toHaveBeenCalled()
    expect(recordProviderSignals).not.toHaveBeenCalled()
  })

  it('routes queryEvents to the DO for cloud-loop and to D1 otherwise', async () => {
    const cloud = makeStore(true)
    expect((await cloud.store.queryEvents('sess_1', query)).rows[0]).toEqual({ id: 'do_event' })
    expect(cloud.doStore.query).toHaveBeenCalledWith('sess_1', query)

    const local = makeStore(false)
    expect((await local.store.queryEvents('sess_1', query)).rows[0]).toEqual({ id: 'd1_event' })
    expect(local.d1.queryEvents).toHaveBeenCalledWith('sess_1', query)
  })

  it('routes eventStream to the DO for cloud-loop and to D1 otherwise', async () => {
    const cloud = makeStore(true)
    expect(await cloud.store.eventStream('sess_1')).toEqual([{ type: 'turn_end', payload: '{}' }])
    expect(cloud.doStore.stream).toHaveBeenCalledWith('sess_1')

    const local = makeStore(false)
    expect(await local.store.eventStream('sess_1')).toEqual([{ type: 'message_end', payload: '{}' }])
    expect(local.d1.eventStream).toHaveBeenCalledWith('sess_1')
  })

  it('archives only cloud-loop sessions (no-op on D1)', async () => {
    const cloud = makeStore(true)
    await cloud.store.archive(scope)
    expect(cloud.doStore.archive).toHaveBeenCalledWith(scope)

    const local = makeStore(false)
    await local.store.archive(scope)
    expect(local.doStore.archive).not.toHaveBeenCalled()
  })

  it('insertEvents canonicalises each event and routes it through append', async () => {
    const { store, doStore } = makeStore(true)
    const count = await store.insertEvents(scope, [
      { type: 'turn_end', payload: { ok: true }, metadata: { source: 'api' } },
      { type: 'runtime.error', payload: { message: 'x' }, metadata: { source: 'api' } },
    ])
    expect(count).toBe(2)
    expect(doStore.append).toHaveBeenCalledTimes(2)
  })
})
