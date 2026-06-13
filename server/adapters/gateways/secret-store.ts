import type { SecretReference } from '@server/domain/vault'
import type { SecretMaterial, SecretStoreGateway } from '@server/usecases/ports'
import type { Env } from '../../env'
import { encryptSecretValue } from '../../vaultCrypto'

// External secret-store boundary: encrypts secret values and writes/deletes
// Cloudflare secrets. The only fetch caller for vault secret material. Throws on
// transport/HTTP failure or invalid material; the usecase maps the error to a
// 400 validation error.
export function createSecretStoreGateway(env: Env): SecretStoreGateway {
  return {
    async store(reference: SecretReference, values: SecretMaterial) {
      if (reference.provider === 'external-vault') {
        const prefixes = (env.AMA_APPROVED_EXTERNAL_VAULT_PREFIXES ?? '')
          .split(',')
          .map((prefix) => prefix.trim())
          .filter(Boolean)
        if (!prefixes.some((prefix) => reference.externalVaultPath?.startsWith(prefix))) {
          throw new Error('externalVaultPath is not approved for this deployment')
        }
        return undefined
      }

      if (!values.secretValue) {
        throw new Error(`secretValue is required for ${reference.provider} credentials`)
      }
      const encryptedSecretValue = await encryptSecretValue(env, values.secretValue)
      if (reference.provider === 'ama-managed') {
        return { encryptedSecretValue }
      }
      return {
        cloudflareSecretId: await storeCloudflareSecret(env, reference.referenceName, values.secretValue),
        encryptedSecretValue,
      }
    },

    async delete(version: { provider: string; hasSecret: boolean; metadata: Record<string, unknown> }) {
      if (version.provider !== 'cloudflare-secrets' || !version.hasSecret) {
        return
      }
      if (env.AMA_LOCAL_SECRET_STORE === 'test') {
        return
      }
      requireCloudflareSecretsEnv(env)
      const secretId = version.metadata.cloudflareSecretId
      if (typeof secretId !== 'string' || !secretId) {
        throw new Error('Cloudflare secret id is required to delete credential version')
      }
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.AMA_WORKERS_AI_ACCOUNT_ID}/secrets_store/stores/${env.AMA_CLOUDFLARE_SECRETS_STORE_ID}/secrets/${secretId}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${env.AMA_CLOUDFLARE_API_TOKEN}` },
        },
      )
      if (!response.ok) {
        throw new Error('Cloudflare secret deletion failed')
      }
    },
  }
}

function requireCloudflareSecretsEnv(env: Env) {
  if (!env.AMA_WORKERS_AI_ACCOUNT_ID) {
    throw new Error('AMA_WORKERS_AI_ACCOUNT_ID is required to store Cloudflare secrets')
  }
  if (!env.AMA_CLOUDFLARE_SECRETS_STORE_ID) {
    throw new Error('AMA_CLOUDFLARE_SECRETS_STORE_ID is required to store Cloudflare secrets')
  }
  if (!env.AMA_CLOUDFLARE_API_TOKEN) {
    throw new Error('AMA_CLOUDFLARE_API_TOKEN is required to store Cloudflare secrets')
  }
}

async function storeCloudflareSecret(env: Env, referenceName: string, secretValue: string) {
  if (env.AMA_LOCAL_SECRET_STORE === 'test') {
    return `test-cloudflare-secret:${referenceName}:${crypto.randomUUID()}`
  }
  requireCloudflareSecretsEnv(env)
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.AMA_WORKERS_AI_ACCOUNT_ID}/secrets_store/stores/${env.AMA_CLOUDFLARE_SECRETS_STORE_ID}/secrets`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.AMA_CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([{ name: referenceName, value: secretValue, scopes: ['workers'] }]),
    },
  )
  if (!response.ok) {
    throw new Error('Cloudflare secret storage failed')
  }
  const body = (await response.json()) as { result?: Array<{ id?: string }> }
  const secretId = body.result?.[0]?.id
  if (!secretId) {
    throw new Error('Cloudflare secret storage did not return a secret id')
  }
  return secretId
}
