import { describe, expect, it } from 'vitest'
import { reasoning, turnEnd } from './ama'

describe('turnEnd', () => {
  it('emits the canonical empty end-of-turn payload', () => {
    const event = turnEnd()
    expect(event).toEqual({
      type: 'turn.completed',
      payload: {},
    })
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
