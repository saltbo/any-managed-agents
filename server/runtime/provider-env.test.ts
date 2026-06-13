import { describe, expect, it } from 'vitest'
import { providerRuntimeEnv } from './provider-env'

describe('providerRuntimeEnv', () => {
  it('contributes nothing for the platform Workers AI provider', () => {
    expect(providerRuntimeEnv(null)).toEqual({ env: {}, secretEnv: [] })
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'workers-ai',
        baseUrl: null,
        credentialId: 'cred_a',
        credentialVersionId: null,
      }),
    ).toEqual({ env: {}, secretEnv: [] })
  })

  it('maps anthropic providers onto the Anthropic SDK env contract', () => {
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'anthropic',
        baseUrl: 'https://anthropic.example.test/v1',
        credentialId: 'cred_abc',
        credentialVersionId: null,
      }),
    ).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://anthropic.example.test/v1' },
      secretEnv: [{ name: 'ANTHROPIC_API_KEY', credentialRef: { credentialId: 'cred_abc' } }],
    })
  })

  it('maps openai-compatible and unknown provider types onto the OpenAI env contract', () => {
    for (const type of ['openai', 'openai-compatible', 'other']) {
      expect(
        providerRuntimeEnv({
          id: 'provider_1',
          type,
          baseUrl: 'https://gateway.example.test/v1',
          credentialId: 'cred_abc',
          credentialVersionId: null,
        }),
      ).toEqual({
        env: { OPENAI_BASE_URL: 'https://gateway.example.test/v1' },
        secretEnv: [{ name: 'OPENAI_API_KEY', credentialRef: { credentialId: 'cred_abc' } }],
      })
    }
  })

  it('maps ollama base URLs onto OLLAMA_HOST', () => {
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        credentialId: null,
        credentialVersionId: null,
      }),
    ).toEqual({ env: { OLLAMA_HOST: 'http://127.0.0.1:11434' }, secretEnv: [] })
  })

  it('pins the credential version when the provider references a specific one', () => {
    expect(
      providerRuntimeEnv({
        id: 'provider_1',
        type: 'openai',
        baseUrl: null,
        credentialId: 'cred_abc',
        credentialVersionId: 'credver_abc',
      }),
    ).toEqual({
      env: {},
      secretEnv: [{ name: 'OPENAI_API_KEY', credentialRef: { credentialId: 'cred_abc', versionId: 'credver_abc' } }],
    })
  })
})
