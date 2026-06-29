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
      const stringData = values.stringData ?? {}
      const entries = Object.entries(stringData)
      if (entries.length === 0) {
        throw new Error(`stringData is required for ${reference.provider} credentials`)
      }
      const encryptedSecretData: Record<string, unknown> = {}
      for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
        encryptedSecretData[key] = await encryptSecretValue(env, value)
      }
      return { encryptedSecretData }
    },
  }
}
