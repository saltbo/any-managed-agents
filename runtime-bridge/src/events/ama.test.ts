import { describe, expect, it, vi } from 'vitest'
import { reasoning, turnEnd } from './ama'

describe('turnEnd', () => {
  it('emits the canonical empty end-of-turn payload', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const event = turnEnd()
    expect(event).toEqual({
      type: 'turn_end',
      payload: { message: { role: 'assistant', content: [], timestamp: 1234 }, toolResults: [] },
    })
    vi.restoreAllMocks()
  })
})

describe('reasoning', () => {
  it('emits a runtime.output reasoning stream event', () => {
    expect(reasoning('thinking...')).toEqual({
      type: 'runtime.output',
      payload: { stream: 'reasoning', content: 'thinking...' },
    })
  })
})
