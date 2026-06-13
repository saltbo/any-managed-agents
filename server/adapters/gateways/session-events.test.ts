import { describe, expect, it, vi } from 'vitest'
import { createSessionEventPort } from './session-events'

// ── fake DB builder ───────────────────────────────────────────────────────────
// The port calls: db.select({...}).from(...).where(...).get()  → sequence query
//                 db.insert(...).values({...})                 → insert attempt
//
// We build a minimal fluent stub that captures the sequence of calls and lets
// each test control what they return / throw.

function fakeDb(options: { sequenceResult?: { sequence: number | null } | null; insertError?: unknown }) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue(options.sequenceResult ?? null),
  }
  const insertChain = {
    values: vi.fn().mockImplementation(() => {
      if (options.insertError !== undefined) {
        return Promise.reject(options.insertError)
      }
      return Promise.resolve()
    }),
  }
  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
  }
}

const auth = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

// ── happy path ────────────────────────────────────────────────────────────────

describe('createSessionEventPort — append', () => {
  it('returns an event id string on first successful insert', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    const eventId = await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: { toolName: 'sandbox.exec' },
    })

    expect(typeof eventId).toBe('string')
    expect(eventId).toMatch(/^event_/)
  })

  it('uses sequence + 1 when a previous event exists for the session', async () => {
    const db = fakeDb({ sequenceResult: { sequence: 5 } })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_end',
      payload: {},
    })

    // insert().values() should have been called with sequence 6
    const insertedValues = db._insertChain.values.mock.calls[0]![0]
    expect(insertedValues.sequence).toBe(6)
  })

  it('starts sequence at 1 when no prior events exist (null from db)', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'policy.decision',
      payload: {},
    })

    const insertedValues = db._insertChain.values.mock.calls[0]![0]
    expect(insertedValues.sequence).toBe(1)
  })

  it('stamps the correct sessionId, organizationId, projectId, type onto the row', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_42',
      type: 'tool_execution_start',
      payload: {},
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    expect(row.sessionId).toBe('sess_42')
    expect(row.organizationId).toBe('org_1')
    expect(row.projectId).toBe('project_1')
    expect(row.type).toBe('tool_execution_start')
  })

  it('sets parentEventId from values.parentEventId when provided', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_end',
      payload: {},
      parentEventId: 'event_parent',
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    expect(row.parentEventId).toBe('event_parent')
  })

  it('sets correlationId from values.correlationId when provided', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'policy.decision',
      payload: {},
      correlationId: 'tool:call_123',
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    expect(row.correlationId).toBe('tool:call_123')
  })

  it('sets parentEventId and correlationId to null when not provided', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: {},
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    expect(row.parentEventId).toBeNull()
    expect(row.correlationId).toBeNull()
  })

  it('redacts sensitive values in the persisted payload JSON', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: { api_key: 'super-secret', safe: 'ok' },
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    const parsed = JSON.parse(row.payload)
    expect(parsed.api_key).toBe('[REDACTED]')
    expect(parsed.safe).toBe('ok')
  })

  it('serializes metadata as JSON with source=mcp-client', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: {},
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    const metadata = JSON.parse(row.metadata)
    expect(metadata.source).toBe('mcp-client')
  })

  it('sets visibility to runtime on every appended event', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: {},
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    expect(row.visibility).toBe('runtime')
  })

  it('sets role to null on every appended event', async () => {
    const db = fakeDb({ sequenceResult: null })
    const port = createSessionEventPort(db as never)

    await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: {},
    })

    const row = db._insertChain.values.mock.calls[0]![0]
    expect(row.role).toBeNull()
  })
})

// ── retry on UNIQUE collision ─────────────────────────────────────────────────

describe('createSessionEventPort — sequence collision retry', () => {
  it('retries on UNIQUE constraint error and succeeds on the second attempt', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(null),
    }
    let insertCallCount = 0
    const insertChain = {
      values: vi.fn().mockImplementation(() => {
        insertCallCount++
        if (insertCallCount === 1) {
          return Promise.reject(new Error('UNIQUE constraint failed: session_events.sequence'))
        }
        return Promise.resolve()
      }),
    }
    const db = {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(insertChain),
    }

    const port = createSessionEventPort(db as never)
    const eventId = await port.append({
      auth,
      sessionId: 'sess_1',
      type: 'tool_execution_start',
      payload: {},
    })

    expect(insertCallCount).toBe(2)
    expect(typeof eventId).toBe('string')
  })

  it('throws immediately when the insert error is not a UNIQUE violation', async () => {
    const db = fakeDb({ insertError: new Error('Connection lost') })
    const port = createSessionEventPort(db as never)

    await expect(
      port.append({
        auth,
        sessionId: 'sess_1',
        type: 'tool_execution_start',
        payload: {},
      }),
    ).rejects.toThrow('Connection lost')
  })

  it('throws after 5 UNIQUE collisions', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(null),
    }
    const insertChain = {
      values: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed: session_events.sequence')),
    }
    const db = {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(insertChain),
    }

    const port = createSessionEventPort(db as never)

    await expect(
      port.append({
        auth,
        sessionId: 'sess_1',
        type: 'tool_execution_start',
        payload: {},
      }),
    ).rejects.toThrow('UNIQUE constraint failed: session_events.sequence')
  })
})
