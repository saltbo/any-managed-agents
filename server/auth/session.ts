import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { base64UrlDecode, base64UrlEncode, constantTimeEqual, hmacSha256 } from './crypto'
import {
  getBearerClaims,
  OidcError,
  organizationIdForClaims,
  type UserInfoClaims,
  upsertProjectForClaims,
} from './oidc'

export const SESSION_COOKIE_NAME = 'ama_session'
const SESSION_EXPIRY_SECONDS = 24 * 60 * 60 // 24 hours

interface SessionPayload {
  sub: string
  email?: string
  name?: string
  picture?: string
  org_id?: string
  org_name?: string
  roles: string[]
  permissions: string[]
  teams?: string[]
  iat: number
  exp: number
}

export async function createSessionCookie(env: Env, claims: UserInfoClaims): Promise<string | null> {
  if (!env.AMA_SESSION_SECRET) {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    sub: claims.sub,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.name ? { name: claims.name } : {}),
    ...(claims.picture ? { picture: claims.picture } : {}),
    ...(claims.org_id ? { org_id: claims.org_id } : {}),
    ...(claims.org_name ? { org_name: claims.org_name } : {}),
    roles: claims.roles,
    permissions: claims.permissions,
    teams: claims.teams,
    iat: now,
    exp: now + SESSION_EXPIRY_SECONDS,
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = await hmacSha256(env.AMA_SESSION_SECRET, encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  const secureFlag = secure ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/${secureFlag}; Max-Age=${SESSION_EXPIRY_SECONDS}`
}

export async function resolveSessionClaims(c: Context<{ Bindings: Env }>): Promise<UserInfoClaims | null> {
  if (!c.env.AMA_SESSION_SECRET) {
    return null
  }
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME)
  if (!cookieValue) {
    return null
  }
  const dotIndex = cookieValue.lastIndexOf('.')
  if (dotIndex < 0) {
    return null
  }
  const encodedPayload = cookieValue.slice(0, dotIndex)
  const providedSignature = cookieValue.slice(dotIndex + 1)
  const expectedSignature = await hmacSha256(c.env.AMA_SESSION_SECRET, encodedPayload)
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    return null
  }
  let payload: SessionPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as SessionPayload
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (!payload.sub || !payload.exp || payload.exp < now) {
    return null
  }
  return {
    sub: payload.sub,
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.picture ? { picture: payload.picture } : {}),
    ...(payload.org_id ? { org_id: payload.org_id } : {}),
    ...(payload.org_name ? { org_name: payload.org_name } : {}),
    roles: payload.roles,
    permissions: payload.permissions,
    teams: payload.teams ?? [],
  }
}

export interface AuthContext {
  user: {
    id: string
    email: string
    name: string | null
    avatarUrl: string | null
  }
  organization: {
    id: string
    name: string
  }
  project: {
    id: string
    name: string
    organizationId?: string
  }
  roles: string[]
  permissions: string[]
  // OIDC-asserted team memberships; optional because system-synthesized auth
  // contexts (queue consumers, schedulers) carry no identity claims.
  teams?: string[]
  oidc: {
    subject: string
    clientId: string | null
    scope: string | null
    issuer: string | null
    externalTenantId: string | null
    runnerId: string | null
    runnerProjectId: string | null
    runnerEnvironmentId: string | null
  }
}

export interface AuthIdentity {
  user: AuthContext['user']
  organization: AuthContext['organization']
  roles: string[]
  permissions: string[]
  teams?: string[]
  oidc: AuthContext['oidc']
}

export function isRunnerOidcAuth(env: Env, auth: Pick<AuthContext, 'oidc'>) {
  return (
    (!!env.OIDC_RUNNER_CLIENT_ID && auth.oidc.clientId === env.OIDC_RUNNER_CLIENT_ID) ||
    !!auth.oidc.runnerId ||
    !!auth.oidc.runnerProjectId ||
    !!auth.oidc.runnerEnvironmentId
  )
}

// Runner tokens are scoped to the runner work loop: registration/heartbeat,
// the work queue, and leases. Session event upload is gated separately by lease
// ownership (see requireSessionEventsAuth).
const RUNNER_TOKEN_PATH_PREFIXES = ['/api/v1/runners', '/api/v1/work-items', '/api/v1/leases']

function isRunnerTokenPath(pathname: string) {
  return RUNNER_TOKEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function bearerToken(headers: Headers, url: string) {
  const value = headers.get('authorization')
  if (value) {
    const match = /^Bearer\s+(.+)$/i.exec(value.trim())
    return match?.[1] ?? null
  }
  const token = new URL(url).searchParams.get('access_token')
  return token && token.length > 0 ? token : null
}

export async function resolveAuthContext(
  c: Context<{ Bindings: Env }>,
  db: DrizzleD1Database,
): Promise<AuthContext | null> {
  const requestedProjectId = c.req.raw.headers.get('x-ama-project-id') ?? undefined

  const token = bearerToken(c.req.raw.headers, c.req.url)
  if (token) {
    const claims = await getBearerClaims(c.env, token)
    const identity = authIdentityFromClaims(claims)
    const project = await upsertProjectForClaims(db, claims, new Date().toISOString(), requestedProjectId)
    return {
      ...identity,
      organization: {
        ...identity.organization,
        id: project.organizationId ?? identity.organization.id,
      },
      project,
    }
  }

  const sessionClaims = await resolveSessionClaims(c)
  if (sessionClaims) {
    const identity = authIdentityFromClaims(sessionClaims)
    const project = await upsertProjectForClaims(db, sessionClaims, new Date().toISOString(), requestedProjectId)
    return {
      ...identity,
      organization: {
        ...identity.organization,
        id: project.organizationId ?? identity.organization.id,
      },
      project,
    }
  }

  return null
}

export async function resolveAuthIdentity(c: Context<{ Bindings: Env }>): Promise<AuthIdentity | null> {
  const token = bearerToken(c.req.raw.headers, c.req.url)
  if (token) {
    const claims = await getBearerClaims(c.env, token)
    return authIdentityFromClaims(claims)
  }

  const sessionClaims = await resolveSessionClaims(c)
  if (sessionClaims) {
    return authIdentityFromClaims(sessionClaims)
  }

  return null
}

function authIdentityFromClaims(claims: Awaited<ReturnType<typeof getBearerClaims>>): AuthIdentity {
  return {
    user: {
      id: claims.sub,
      email: claims.email ?? '',
      name: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    },
    organization: {
      id: organizationIdForClaims(claims),
      name: claims.org_name ?? claims.organization_name ?? 'Personal workspace',
    },
    roles: claims.roles,
    permissions: claims.permissions,
    teams: claims.teams,
    oidc: {
      subject: claims.sub,
      clientId: claims.client_id ?? claims.azp ?? null,
      scope: claims.scope ?? null,
      issuer: claims.iss ?? null,
      externalTenantId: claims.external_tenant_id ?? claims.tenant_id ?? null,
      runnerId: null,
      runnerProjectId: claims.ama_project_id ?? null,
      runnerEnvironmentId: claims.ama_environment_id ?? null,
    },
  }
}

export async function requireAuthIdentity(c: Context<{ Bindings: Env }>) {
  let auth: AuthIdentity | null
  try {
    auth = await resolveAuthIdentity(c)
  } catch (err) {
    if (err instanceof OidcError) {
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_bearer_token',
      })
    }
    throw err
  }
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_bearer_token',
    })
  }
  if (isRunnerOidcAuth(c.env, auth) && !isRunnerTokenPath(new URL(c.req.url).pathname)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
  return auth
}

export async function requireAuth(c: Context<{ Bindings: Env }>, db: DrizzleD1Database) {
  let auth: AuthContext | null
  try {
    auth = await resolveAuthContext(c, db)
  } catch (err) {
    if (err instanceof OidcError) {
      return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
        reason: 'missing_or_invalid_bearer_token',
      })
    }
    throw err
  }
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_bearer_token',
    })
  }
  if (isRunnerOidcAuth(c.env, auth) && !isRunnerTokenPath(new URL(c.req.url).pathname)) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
  return auth
}
