import { and, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as client from 'openid-client'
import { memberships, organizations, projects, users } from '../db/schema'
import type { Env } from '../env'

export interface OidcLoginAttempt {
  authorizationUrl: string
  state: string
  nonce: string
  verifier: string
}

interface UserInfoClaims {
  sub: string
  email?: string
  name?: string
  picture?: string
  org_id?: string
  organization_id?: string
  org_name?: string
  organization_name?: string
  roles?: unknown
  permissions?: unknown
}

export interface LocalAuthPrincipal {
  userId: string
  organizationId: string
  projectId: string
  roles: string[]
  permissions: string[]
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcError'
  }
}

export function requireOidcConfig(env: Env) {
  if (!env.FLAREAUTH_ISSUER || !env.FLAREAUTH_CLIENT_ID || !env.FLAREAUTH_REDIRECT_URI) {
    throw new Error('FLAREAUTH_ISSUER, FLAREAUTH_CLIENT_ID, and FLAREAUTH_REDIRECT_URI are required')
  }

  return {
    issuer: env.FLAREAUTH_ISSUER.replace(/\/$/, ''),
    clientId: env.FLAREAUTH_CLIENT_ID,
    clientSecret: env.FLAREAUTH_CLIENT_SECRET,
    redirectUri: env.FLAREAUTH_REDIRECT_URI,
  }
}

async function createOidcClient(env: Env) {
  const config = requireOidcConfig(env)
  const clientMetadata: Partial<client.ClientMetadata> = {
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
    token_endpoint_auth_method: config.clientSecret ? 'client_secret_post' : 'none',
  }
  if (config.clientSecret) {
    clientMetadata.client_secret = config.clientSecret
  }

  try {
    return await client.discovery(
      new URL(config.issuer),
      config.clientId,
      clientMetadata,
      config.clientSecret ? client.ClientSecretPost(config.clientSecret) : client.None(),
      {
        [client.customFetch]: async (input, init) => {
          const request = new Request(input, init as RequestInit)
          const requestUrl = new URL(request.url)
          if (
            requestUrl.origin === new URL(config.issuer).origin &&
            (requestUrl.pathname === '/api/auth/.well-known/openid-configuration' ||
              requestUrl.pathname === '/.well-known/openid-configuration/api/auth')
          ) {
            return Response.json({
              issuer: config.issuer,
              authorization_endpoint: `${config.issuer}/oauth2/authorize`,
              token_endpoint: `${config.issuer}/oauth2/token`,
              jwks_uri: `${config.issuer}/jwks`,
              userinfo_endpoint: `${config.issuer}/oauth2/userinfo`,
              end_session_endpoint: `${config.issuer}/oauth2/end-session`,
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code', 'refresh_token'],
              token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
              code_challenge_methods_supported: ['S256'],
              scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['EdDSA'],
            })
          }
          const requestInit: RequestInit = {
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            redirect: request.redirect,
            signal: request.signal,
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            requestInit.body = (init?.body as BodyInit | undefined) ?? (await request.clone().arrayBuffer())
          }
          const useServiceBinding = env.FLAREAUTH_USE_SERVICE_BINDING !== 'false'
          const response =
            useServiceBinding && requestUrl.origin === new URL(config.issuer).origin && env.FLAREAUTH
              ? await env.FLAREAUTH.fetch(request.url, requestInit)
              : await fetch(request.url, requestInit)
          return response
        },
      },
    )
  } catch (err) {
    throw toOidcError(err)
  }
}

export async function createLoginAttempt(env: Env): Promise<OidcLoginAttempt> {
  const config = requireOidcConfig(env)
  const oidcClient = await createOidcClient(env)
  const verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = client.randomNonce()
  const url = client.buildAuthorizationUrl(oidcClient, {
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  })

  return {
    authorizationUrl: url.toString(),
    state,
    nonce,
    verifier,
  }
}

export async function exchangeCallbackForUserInfo(
  env: Env,
  callbackUrl: URL,
  verifier: string,
  expectedState: string,
  expectedNonce: string,
) {
  const oidcClient = await createOidcClient(env)
  const tokenResponse = await runOidc(() =>
    client.authorizationCodeGrant(oidcClient, callbackUrl, {
      expectedNonce,
      expectedState,
      pkceCodeVerifier: verifier,
    }),
  )
  const idTokenClaims = tokenResponse.claims()
  if (!idTokenClaims?.sub) {
    throw new OidcError('FlareAuth token response did not include validated ID token claims')
  }

  const claims = await runOidc(() => client.fetchUserInfo(oidcClient, tokenResponse.access_token, idTokenClaims.sub))
  if (!claims.email) {
    throw new OidcError('FlareAuth userinfo did not include required user claims')
  }

  return claims as UserInfoClaims
}

async function runOidc<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (err) {
    throw toOidcError(err)
  }
}

function toOidcError(err: unknown) {
  if (err instanceof OidcError) {
    return err
  }
  if (err instanceof Error) {
    return new OidcError(err.message)
  }
  return new OidcError('FlareAuth OIDC operation failed')
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export async function upsertLocalPrincipal(
  db: DrizzleD1Database,
  claims: UserInfoClaims,
  timestamp: string,
): Promise<LocalAuthPrincipal> {
  const flareauthOrganizationId = claims.org_id ?? claims.organization_id ?? `user:${claims.sub}`
  const organizationName = claims.org_name ?? claims.organization_name ?? 'Personal workspace'
  const roles = asStringArray(claims.roles)
  const permissions = asStringArray(claims.permissions)
  const normalizedRoles = roles.length > 0 ? roles : ['owner']
  const normalizedPermissions = permissions.length > 0 ? permissions : ['*']

  let user = await db.select().from(users).where(eq(users.flareauthSubject, claims.sub)).get()
  if (!user) {
    user = {
      id: newId('user'),
      flareauthSubject: claims.sub,
      email: claims.email ?? '',
      name: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(users).values(user)
  } else {
    await db
      .update(users)
      .set({
        email: claims.email ?? user.email,
        name: claims.name ?? user.name,
        avatarUrl: claims.picture ?? user.avatarUrl,
        updatedAt: timestamp,
      })
      .where(eq(users.id, user.id))
  }

  let organization = await db
    .select()
    .from(organizations)
    .where(eq(organizations.flareauthOrganizationId, flareauthOrganizationId))
    .get()
  if (!organization) {
    organization = {
      id: newId('org'),
      flareauthOrganizationId,
      name: organizationName,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(organizations).values(organization)
  } else {
    await db
      .update(organizations)
      .set({ name: organizationName, updatedAt: timestamp })
      .where(eq(organizations.id, organization.id))
  }

  let project = await db.select().from(projects).where(eq(projects.organizationId, organization.id)).get()
  if (!project) {
    project = {
      id: newId('project'),
      organizationId: organization.id,
      name: 'Default project',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(projects).values(project)
  }

  const membership = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.organizationId, organization.id)))
    .get()
  const membershipValues = {
    roles: JSON.stringify(normalizedRoles),
    permissions: JSON.stringify(normalizedPermissions),
    updatedAt: timestamp,
  }
  if (!membership) {
    await db.insert(memberships).values({
      id: newId('membership'),
      userId: user.id,
      organizationId: organization.id,
      ...membershipValues,
      createdAt: timestamp,
    })
  } else {
    await db.update(memberships).set(membershipValues).where(eq(memberships.id, membership.id))
  }

  return {
    userId: user.id,
    organizationId: organization.id,
    projectId: project.id,
    roles: normalizedRoles,
    permissions: normalizedPermissions,
  }
}
