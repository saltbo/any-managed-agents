import { describe, expect, it } from 'vitest'
import type { CredentialType } from '@/lib/amarpc'
import {
  credentialSecretData,
  credentialTypes,
  defaultCredentialData,
  emptyCredential,
  hasValidCredentialSecretData,
} from './credential-form-model'

describe('credential form model', () => {
  it('defines default secret fields for every credential type', () => {
    const expected: Record<CredentialType, Record<string, string>> = {
      opaque: { value: '' },
      'ama.dev/basic-auth': { username: '', password: '' },
      'ama.dev/ssh-auth': { 'ssh-privatekey': '' },
      'ama.dev/tls': { 'tls.crt': '', 'tls.key': '' },
      'ama.dev/private-key-jwk': { jwk: '' },
      'ama.dev/oauth-token': {
        'access-token': '',
        'refresh-token': '',
        'token-type': '',
        'expires-at': '',
        scopes: '',
      },
    }

    expect(Object.fromEntries(credentialTypes.map(({ type }) => [type, defaultCredentialData(type)]))).toEqual(expected)
  })

  it('filters blank values and trims keys before submitting secret data', () => {
    expect(
      credentialSecretData({
        ...emptyCredential,
        data: { ' token ': 'sk-secret', empty: '', '   ': 'ignored' },
      }),
    ).toEqual({ token: 'sk-secret' })
  })

  it('validates required fields according to credential type', () => {
    expect(hasValidCredentialSecretData({ ...emptyCredential, data: { value: 'secret' } })).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/basic-auth',
        data: { username: 'user', password: '' },
      }),
    ).toBe(false)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/basic-auth',
        data: { username: 'user', password: 'pass' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/ssh-auth',
        data: { 'ssh-privatekey': 'key' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/tls',
        data: { 'tls.crt': 'cert', 'tls.key': 'key' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/private-key-jwk',
        data: { jwk: '{"kty":"OKP"}' },
      }),
    ).toBe(true)
    expect(
      hasValidCredentialSecretData({
        ...emptyCredential,
        type: 'ama.dev/oauth-token',
        data: { 'access-token': 'token' },
      }),
    ).toBe(true)
  })
})
