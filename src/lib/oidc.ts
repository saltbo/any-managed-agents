import { type User, UserManager, WebStorageStateStore } from 'oidc-client-ts'

interface OidcConfigResponse {
  authority: string
  clientId: string
  scope: string
}

declare const __AMA_OIDC_CONFIG__: OidcConfigResponse

let managerPromise: Promise<UserManager> | undefined
let userPromise: Promise<User | null> | undefined

function oidcConfig() {
  if (!__AMA_OIDC_CONFIG__.authority || !__AMA_OIDC_CONFIG__.clientId) {
    throw new Error('OIDC browser configuration is missing')
  }
  const origin = window.location.origin
  return {
    ...__AMA_OIDC_CONFIG__,
    redirectUri: `${origin}/auth/callback`,
    postLogoutRedirectUri: `${origin}/`,
  }
}

export async function getOidcManager() {
  managerPromise ??= Promise.resolve(oidcConfig()).then(
    (config) =>
      new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        post_logout_redirect_uri: config.postLogoutRedirectUri,
        response_type: 'code',
        scope: config.scope,
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.localStorage }),
      }),
  )
  return managerPromise
}

export async function getAccessToken() {
  const storedToken = getStoredAccessToken()
  if (storedToken) {
    return storedToken
  }

  const manager = await getOidcManager()
  userPromise ??= manager.getUser()
  const user = await userPromise
  if (!user || user.expired) {
    return null
  }
  return user.access_token
}

export async function getCurrentUser() {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) {
    const runId = e2eToken.startsWith('e2e:') ? e2eToken.slice('e2e:'.length) : 'run'
    const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, '_') || 'run'
    return {
      expired: false,
      access_token: e2eToken,
      token_type: 'Bearer',
      scope: 'openid email profile',
      session_state: null,
      state: undefined,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      toStorageString: () => '',
      profile: {
        sub: `user_e2e_${safeRunId}`,
        email: `${safeRunId}@e2e.example.com`,
        name: `E2E User ${safeRunId}`,
        org_id: `org_e2e_${safeRunId}`,
        org_name: `org_e2e_${safeRunId}`,
      },
    } as unknown as User
  }

  const manager = await getOidcManager()
  userPromise ??= manager.getUser()
  const user = await userPromise
  return user && !user.expired ? user : null
}

export function getStoredAccessToken() {
  const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
  if (e2eToken) {
    return e2eToken
  }
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith('oidc.user:')) continue
    const raw = window.localStorage.getItem(key)
    if (!raw) continue
    try {
      const user = JSON.parse(raw) as { access_token?: string; expires_at?: number }
      if (user.access_token && (!user.expires_at || user.expires_at * 1000 > Date.now())) {
        return user.access_token
      }
    } catch {}
  }
  return null
}

export async function signIn(returnTo: string) {
  const manager = await getOidcManager()
  await manager.signinRedirect({ state: { returnTo } })
}

export async function completeSignIn() {
  const manager = await getOidcManager()
  const user = await manager.signinRedirectCallback()
  userPromise = Promise.resolve(user)

  // Create server-side httpOnly session cookie from the validated access token.
  const sessionResponse = await fetch('/api/v1/auth/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ accessToken: user.access_token }),
  })
  if (!sessionResponse.ok) {
    const body = (await sessionResponse.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? 'Failed to create session')
  }

  const state = user.state as { returnTo?: string } | undefined
  const returnTo = state?.returnTo
  return returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
}

export async function signOut() {
  window.localStorage.removeItem('ama:e2e-access-token')
  const manager = await getOidcManager()
  await manager.signoutRedirect()
}
