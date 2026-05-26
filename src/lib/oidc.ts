import { type User, UserManager, WebStorageStateStore } from 'oidc-client-ts'

interface OidcConfigResponse {
  authority: string
  clientId: string
  redirectUri: string
  postLogoutRedirectUri: string
  scope: string
}

let managerPromise: Promise<UserManager> | undefined
let userPromise: Promise<User | null> | undefined

async function loadConfig() {
  const response = await fetch('/api/auth/config', { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error('Unable to load FlareAuth OIDC configuration')
  }
  return (await response.json()) as OidcConfigResponse
}

export async function getOidcManager() {
  managerPromise ??= loadConfig().then(
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
  const state = user.state as { returnTo?: string } | undefined
  const returnTo = state?.returnTo
  return returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
}

export async function signOut() {
  window.localStorage.removeItem('ama:e2e-access-token')
  const manager = await getOidcManager()
  await manager.signoutRedirect()
}
