import { expect, vi } from 'vitest'

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

export async function setupFlareAuth() {
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
