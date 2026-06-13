import { describe, expect, it } from 'vitest'
import { providerRuntimeEnv } from './provider-env'

describe('providerRuntimeEnv', () => {
  it('contributes nothing for the platform Workers AI provider', () => {
    expect(providerRuntimeEnv(null)).toEqual({ env: {}, secretEnv: [] })
    expect(
      providerRuntimeEnv({ id: 'provider_1', type: 'workers-ai', baseUrl: null, credentialSecretRef: 'vaultver_a' }),
    ).toEqual({ env: {}, secretEnv: [] })
  })

  it('maps anthropic providers onto the Anthropic SDK env contract', () => {
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'anthropic',
        baseUrl: 'https://anthropic.example.test/v1',
        credentialSecretRef: 'vaultver_abc',
      }),
    ).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://anthropic.example.test/v1' },
      secretEnv: [{ name: 'ANTHROPIC_API_KEY', ref: 'vaultver_abc' }],
    })
  })

  it('maps openai-compatible and unknown provider types onto the OpenAI env contract', () => {
    for (const type of ['openai', 'openai-compatible', 'other']) {
      expect(
        providerRuntimeEnv({
          id: 'provider_1',
          type,
          baseUrl: 'https://gateway.example.test/v1',
          credentialSecretRef: 'vaultver_abc',
        }),
      ).toEqual({
        env: { OPENAI_BASE_URL: 'https://gateway.example.test/v1' },
        secretEnv: [{ name: 'OPENAI_API_KEY', ref: 'vaultver_abc' }],
      })
    }
  })

  it('maps ollama base URLs onto OLLAMA_HOST', () => {
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        credentialSecretRef: null,
      }),
    ).toEqual({ env: { OLLAMA_HOST: 'http://127.0.0.1:11434' }, secretEnv: [] })
  })

  it('keeps non-vault credential references out of the secret env', () => {
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'openai',
        baseUrl: null,
        credentialSecretRef: 'secret://providers/openai',
      }),
    ).toEqual({ env: {}, secretEnv: [] })
  })
})
