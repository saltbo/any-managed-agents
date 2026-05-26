import { describe, expect, it } from 'vitest'
import type { Env } from '../../env'
import { isProcessNotFoundError, piModelsConfig, safeRuntimeError } from './bridge'

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

describe('piModelsConfig', () => {
  it('routes Workers AI through the AMA runtime proxy', () => {
    expect(
      piModelsConfig(
        {
          AMA_ALLOWED_ORIGINS: 'https://ama.example.com',
          AMA_RUNTIME_AI_PROXY_TOKEN: 'proxy-token',
        } as Env,
        'cloudflare-workers-ai',
      ),
    ).toMatchObject({
      providers: {
        'cloudflare-workers-ai': {
          baseUrl: 'https://ama.example.com/api/runtime/workers-ai/v1',
          api: 'openai-completions',
          apiKey: 'AMA_RUNTIME_AI_PROXY_TOKEN',
          authHeader: true,
        },
      },
    })
  })

  it('requires a runtime proxy token for Workers AI', () => {
    expect(() =>
      piModelsConfig({ AMA_ALLOWED_ORIGINS: 'https://ama.example.com' } as Env, 'cloudflare-workers-ai'),
    ).toThrow('AMA_RUNTIME_AI_PROXY_TOKEN')
  })
})

describe('isProcessNotFoundError', () => {
  it('identifies Cloudflare sandbox process-not-found stop races', () => {
    const error = new Error('Process pi-session_x not found')
    error.name = 'ProcessNotFoundError'

    expect(isProcessNotFoundError(error)).toBe(true)
    expect(isProcessNotFoundError(new Error('permission denied'))).toBe(false)
  })
})
