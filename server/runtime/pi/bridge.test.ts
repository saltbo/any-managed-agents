import { describe, expect, it } from 'vitest'
import { safeRuntimeError } from './bridge'

describe('safeRuntimeError', () => {
  it('redacts sensitive runtime error messages', () => {
    expect(safeRuntimeError(new Error('provider failed with token=raw-secret-token'))).toMatchObject({
      type: 'runtime_error',
      message: '[REDACTED]',
      code: 'Error',
    })
  })

  it('preserves non-sensitive runtime diagnostics', () => {
    expect(safeRuntimeError(new TypeError('bridge process exited'))).toMatchObject({
      type: 'runtime_error',
      message: 'bridge process exited',
      code: 'TypeError',
    })
  })
})
