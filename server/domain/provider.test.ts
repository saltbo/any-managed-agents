import { describe, expect, it } from 'vitest'
import { providerCredentialStatus, validateProviderBaseUrl } from './provider'

describe('[spec: providers/credential-status] providerCredentialStatus', () => {
  it('treats workers-ai and ollama as credential-optional', () => {
    expect(providerCredentialStatus({ type: 'workers-ai', credentialId: null })).toBe('not_required')
    expect(providerCredentialStatus({ type: 'ollama', credentialId: null })).toBe('not_required')
    expect(providerCredentialStatus({ type: 'workers-ai', credentialId: 'cred_1' })).toBe('configured')
  })

  it('requires a credential for external providers', () => {
    expect(providerCredentialStatus({ type: 'openai', credentialId: null })).toBe('missing')
    expect(providerCredentialStatus({ type: 'anthropic', credentialId: null })).toBe('missing')
    expect(providerCredentialStatus({ type: 'openai-compatible', credentialId: 'cred_1' })).toBe('configured')
  })
})

describe('[spec: providers/base-url] validateProviderBaseUrl', () => {
  it('requires a base URL for openai-compatible providers', () => {
    expect(validateProviderBaseUrl('openai-compatible', null)).toEqual({ baseUrl: expect.any(String) })
    expect(validateProviderBaseUrl('openai-compatible', 'https://x/v1')).toBeNull()
  })

  it('allows other provider types without a base URL', () => {
    expect(validateProviderBaseUrl('workers-ai', null)).toBeNull()
    expect(validateProviderBaseUrl('openai', null)).toBeNull()
  })
})
