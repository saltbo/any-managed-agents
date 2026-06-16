import { env } from 'cloudflare:workers'
import { expect, vi } from 'vitest'

// Providers are a global vendor catalog (no org/project). Tests that pin an
// agent to a provider/model need the row to exist so the agent.providerId FK
// and the provider/model availability checks resolve. Provider rows use the
// vendor slug as their id (id === slug; discovery upserts id: slug). The cloud
// runtime ('ama') dispatches every model through the Workers AI binding, which
// only recognizes the 'workers-ai' provider, so this seeds that vendor plus the
// default model the test agents pin. Call from a beforeEach: isolated storage
// resets writes between tests.
export const PLATFORM_PROVIDER_ID = 'workers-ai'
export const PLATFORM_MODEL_ID = '@cf/moonshotai/kimi-k2.6'

export async function seedPlatformProvider(
  options: { providerId?: string; slug?: string; displayName?: string; modelId?: string; enabled?: boolean } = {},
) {
  const providerId = options.providerId ?? PLATFORM_PROVIDER_ID
  const slug = options.slug ?? PLATFORM_PROVIDER_ID
  const displayName = options.displayName ?? 'Workers AI'
  const modelId = options.modelId ?? PLATFORM_MODEL_ID
  const enabled = options.enabled ?? true
  const timestamp = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO providers (id, slug, display_name, enabled, metadata, model_catalog_state, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', 'ready', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  )
    .bind(providerId, slug, displayName, enabled ? 1 : 0, timestamp, timestamp)
    .run()
  await env.DB.prepare(
    `INSERT INTO provider_models (id, provider_id, model_id, display_name, capabilities, context_window, pricing, availability, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '["text"]', NULL, '{}', 'available', '{}', ?, ?)
     ON CONFLICT(provider_id, model_id) DO NOTHING`,
  )
    .bind(
      `${providerId}_${modelId}`.replaceAll(/[^A-Za-z0-9_-]/g, '_'),
      providerId,
      modelId,
      modelId,
      timestamp,
      timestamp,
    )
    .run()
  return { providerId, modelId }
}

interface TestClaims {
  sub: string
  email: string
  name: string
  org_id: string
  org_name: string
  roles: string[]
  permissions: string[]
}

const cloudflareSecretWrites: unknown[] = []
const cloudflareSecretDeletes: string[] = []
let counter = 0

export function defaultClaims(): TestClaims {
  return {
    sub: 'user_123',
    email: 'user@example.com',
    name: 'Ada Lovelace',
    org_id: 'org_flare_123',
    org_name: 'Example Org',
    roles: ['owner'],
    permissions: ['agents:write', 'agents:read'],
  }
}

export async function setupOidcProvider() {
  cloudflareSecretWrites.length = 0
  cloudflareSecretDeletes.length = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.hostname === 'api.cloudflare.com' && url.pathname.includes('/secrets_store/stores/')) {
        if (init?.method === 'POST') {
          const secrets = JSON.parse(String(init.body)) as Array<{ name: string }>
          cloudflareSecretWrites.push(secrets)
          return Response.json({ success: true, result: secrets.map((secret) => ({ id: `secret_${secret.name}` })) })
        }

        if (init?.method === 'DELETE') {
          cloudflareSecretDeletes.push(url.pathname.split('/').at(-1) ?? '')
          return Response.json({ success: true, result: null })
        }
      }

      return new Response('not found', { status: 404 })
    }),
  )
}

export function cloudflareSecretRequests() {
  return {
    writes: [...cloudflareSecretWrites],
    deletes: [...cloudflareSecretDeletes],
  }
}

export async function signIn(claims = defaultClaims()) {
  counter += 1
  const runId = `${claims.sub}_${counter}`.replaceAll(/[^A-Za-z0-9_-]/g, '_')
  return `Bearer e2e:${runId}`
}

export async function signInRunner(claims = defaultClaims()) {
  counter += 1
  const runId = `${claims.sub}_${counter}`.replaceAll(/[^A-Za-z0-9_-]/g, '_')
  return `Bearer e2e-runner:${runId}`
}

export function signInFederatedRunner(externalTenantId: string, runnerId: string, environmentId?: string) {
  return `Bearer e2e-federated-runner:${externalTenantId}:${runnerId}${environmentId ? `:${environmentId}` : ''}`
}

export async function signInUser(suffix: string) {
  return signIn({
    ...defaultClaims(),
    sub: `user_${suffix}`,
    email: `${suffix}@example.com`,
    org_id: `org_${suffix}`,
    org_name: `Org ${suffix}`,
  })
}

export function expectAuthRequired(body: unknown) {
  expect(body).toEqual({
    error: {
      type: 'authentication_required',
      message: 'Authentication required',
      details: { reason: 'missing_or_invalid_bearer_token' },
    },
  })
}
