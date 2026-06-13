import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies a non-Error value (the fallback the api client never triggers)', () => {
    expect(errorMessage('plain string')).toBe('plain string')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
    expect(errorMessage({ toString: () => 'custom' })).toBe('custom')
  })
})
