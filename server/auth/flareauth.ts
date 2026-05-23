import { and, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { memberships, organizations, projects, users } from '../db/schema'
import type { Env } from '../env'
import { base64UrlDecode, randomToken, sha256 } from './crypto'

interface OidcMetadata {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  issuer: string
}

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

export async function discoverOidcMetadata(env: Env): Promise<OidcMetadata> {
  const { issuer } = requireOidcConfig(env)
  const res = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!res.ok) {
    throw new OidcError('Unable to discover FlareAuth OIDC metadata')
  }

  const metadata = await readOidcJson<Partial<OidcMetadata>>(res)
  if (
    metadata.issuer !== issuer ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    !metadata.userinfo_endpoint
  ) {
    throw new OidcError('Invalid FlareAuth OIDC metadata')
  }

  return metadata as OidcMetadata
}

export async function createLoginAttempt(env: Env): Promise<OidcLoginAttempt> {
  const config = requireOidcConfig(env)
  const metadata = await discoverOidcMetadata(env)
  const verifier = randomToken()
  const state = randomToken()
  const nonce = randomToken()
  const url = new URL(metadata.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', await sha256(verifier))
  url.searchParams.set('code_challenge_method', 'S256')

  return {
    authorizationUrl: url.toString(),
    state,
    nonce,
    verifier,
  }
}

export async function exchangeCodeForUserInfo(env: Env, code: string, verifier: string, expectedNonce: string) {
  const config = requireOidcConfig(env)
  const metadata = await discoverOidcMetadata(env)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  })
  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret)
  }

  const tokenRes = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!tokenRes.ok) {
    throw new OidcError('FlareAuth token exchange failed')
  }

  const tokenBody = await readOidcJson<{ access_token?: string; id_token?: string }>(tokenRes)
  if (!tokenBody.access_token) {
    throw new OidcError('FlareAuth token response did not include an access token')
  }

  if (tokenBody.id_token) {
    const payload = decodeJwtPayload(tokenBody.id_token)
    if (payload.nonce && payload.nonce !== expectedNonce) {
      throw new OidcError('FlareAuth ID token nonce mismatch')
    }
  }

  const userinfoRes = await fetch(metadata.userinfo_endpoint, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
  })
  if (!userinfoRes.ok) {
    throw new OidcError('FlareAuth userinfo lookup failed')
  }

  const claims = await readOidcJson<Partial<UserInfoClaims>>(userinfoRes)
  if (!claims.sub || !claims.email) {
    throw new OidcError('FlareAuth userinfo did not include required user claims')
  }

  return claims as UserInfoClaims
}

function decodeJwtPayload(jwt: string) {
  const [, payload] = jwt.split('.')
  if (!payload) {
    throw new OidcError('Invalid FlareAuth ID token')
  }
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as { nonce?: string }
  } catch {
    throw new OidcError('Invalid FlareAuth ID token')
  }
}

async function readOidcJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new OidcError('FlareAuth response was not valid JSON')
  }
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
  const flareauthOrganizationId = claims.org_id ?? claims.organization_id
  if (!flareauthOrganizationId) {
    throw new OidcError('FlareAuth userinfo did not include an organization claim')
  }

  const organizationName = claims.org_name ?? claims.organization_name ?? 'Default organization'
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
