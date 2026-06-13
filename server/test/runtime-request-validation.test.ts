import { describe, expect, it } from 'vitest'
import { runtimeRequestHasTestOnlyFields } from '../runtime/runtime-proxy'

describe('runtime request validation', () => {
  it('identifies client-supplied runtime fixture fields that are rejected outside test mode', () => {
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello' })).toBe(false)
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello', toolCalls: [] })).toBe(true)
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello', simulateError: true })).toBe(true)
    expect(runtimeRequestHasTestOnlyFields({ type: 'prompt', message: 'hello', response: 'canned' })).toBe(true)
  })
})
