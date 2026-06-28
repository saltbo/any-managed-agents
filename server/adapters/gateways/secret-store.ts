import type { SecretReference } from '@server/domain/vault'
import type { SecretMaterial, SecretStoreGateway } from '@server/usecases/ports'
import type { Env } from '../../env'
import { encryptSecretValue } from '../../vault-crypto'

// Secret-store boundary: encrypts credential values before D1 persistence.
// Throws on invalid material; the usecase maps the error to a 400 validation
// error.
export function createSecretStoreGateway(env: Env): SecretStoreGateway {
  return {
    async store(reference: SecretReference, values: SecretMaterial) {
      if (!values.secretValue) {
        throw new Error(`secretValue is required for ${reference.provider} credentials`)
      }
      const encryptedSecretValue = await encryptSecretValue(env, values.secretValue)
      return { encryptedSecretValue }
    },
  }
}
