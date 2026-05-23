import { and, eq, gt, isNull } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { appSessions, memberships, organizations, projects, users } from '../db/schema'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { constantTimeEqual, hmacSha256, randomToken } from './crypto'

export const SESSION_COOKIE_NAME = '__Host-ama_session'
const LOGIN_STATE_COOKIE_NAME = '__Host-ama_oidc'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8
const LOGIN_STATE_MAX_AGE_SECONDS = 10 * 60

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
  }
  roles: string[]
  permissions: string[]
  sessionId: string
}

interface LoginState {
  state: string
  nonce: string
  verifier: string
  returnTo: string
  expiresAt: string
}

type SameSite = 'Lax' | 'Strict' | 'None'

function requiredSecret(env: Env) {
  if (!env.AMA_SESSION_SECRET) {
    throw new Error('AMA_SESSION_SECRET is required')
  }
  return env.AMA_SESSION_SECRET
}

function cookieOptions(env: Env, maxAge: number) {
  return {
    httpOnly: true,
    secure: env.AMA_COOKIE_SECURE !== 'false',
    sameSite: (env.AMA_COOKIE_SAME_SITE ?? 'Lax') as SameSite,
    path: '/',
    maxAge,
  }
}

async function signValue(env: Env, value: string) {
  return `${value}.${await hmacSha256(requiredSecret(env), value)}`
}

async function verifyValue(env: Env, signed: string | undefined) {
  if (!signed) {
    return null
  }

  const separator = signed.lastIndexOf('.')
  if (separator === -1) {
    return null
  }

  const value = signed.slice(0, separator)
  const signature = signed.slice(separator + 1)
  const expected = await hmacSha256(requiredSecret(env), value)
  return constantTimeEqual(signature, expected) ? value : null
}

export function safeReturnTo(returnTo: string | null) {
  if (!returnTo?.startsWith('/') || returnTo.startsWith('//')) {
    return '/'
  }
  return returnTo
}

export async function setLoginStateCookie(c: Context<{ Bindings: Env }>, state: LoginState) {
  setCookie(
    c,
    LOGIN_STATE_COOKIE_NAME,
    await signValue(c.env, JSON.stringify(state)),
    cookieOptions(c.env, LOGIN_STATE_MAX_AGE_SECONDS),
  )
}

export async function readLoginState(c: Context<{ Bindings: Env }>) {
  const value = await verifyValue(c.env, getCookie(c, LOGIN_STATE_COOKIE_NAME))
  if (!value) {
    return null
  }

  const state = JSON.parse(value) as LoginState
  if (new Date(state.expiresAt).getTime() <= Date.now()) {
    return null
  }
  return state
}

export function clearLoginStateCookie(c: Context<{ Bindings: Env }>) {
  setCookie(c, LOGIN_STATE_COOKIE_NAME, '', cookieOptions(c.env, 0))
}

export async function createSession(
  c: Context<{ Bindings: Env }>,
  db: DrizzleD1Database,
  values: { id: string; userId: string; organizationId: string; projectId: string; now: string },
) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  await db.insert(appSessions).values({
    id: values.id,
    tokenHash: await hmacSha256(requiredSecret(c.env), token),
    userId: values.userId,
    organizationId: values.organizationId,
    projectId: values.projectId,
    expiresAt,
    revokedAt: null,
    createdAt: values.now,
  })
  setCookie(
    c,
    SESSION_COOKIE_NAME,
    await signValue(c.env, `${values.id}.${token}`),
    cookieOptions(c.env, SESSION_MAX_AGE_SECONDS),
  )
}

export async function clearSessionCookie(c: Context<{ Bindings: Env }>) {
  setCookie(c, SESSION_COOKIE_NAME, '', cookieOptions(c.env, 0))
}

export async function resolveAuthContext(
  c: Context<{ Bindings: Env }>,
  db: DrizzleD1Database,
): Promise<AuthContext | null> {
  const signedCookie = getCookie(c, SESSION_COOKIE_NAME)
  const sessionToken = await verifyValue(c.env, signedCookie)
  if (!sessionToken) {
    return null
  }

  const separator = sessionToken.indexOf('.')
  if (separator === -1) {
    return null
  }

  const sessionId = sessionToken.slice(0, separator)
  const token = sessionToken.slice(separator + 1)
  const tokenHash = await hmacSha256(requiredSecret(c.env), token)
  const now = new Date().toISOString()
  const rows = await db
    .select({
      sessionId: appSessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      organizationId: organizations.id,
      organizationName: organizations.name,
      projectId: projects.id,
      projectName: projects.name,
      roles: memberships.roles,
      permissions: memberships.permissions,
    })
    .from(appSessions)
    .innerJoin(users, eq(appSessions.userId, users.id))
    .innerJoin(organizations, eq(appSessions.organizationId, organizations.id))
    .innerJoin(projects, eq(appSessions.projectId, projects.id))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizations.id)))
    .where(
      and(
        eq(appSessions.id, sessionId),
        eq(appSessions.tokenHash, tokenHash),
        gt(appSessions.expiresAt, now),
        isNull(appSessions.revokedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl,
    },
    organization: {
      id: row.organizationId,
      name: row.organizationName,
    },
    project: {
      id: row.projectId,
      name: row.projectName,
    },
    roles: JSON.parse(row.roles) as string[],
    permissions: JSON.parse(row.permissions) as string[],
  }
}

export async function requireAuth(c: Context<{ Bindings: Env }>, db: DrizzleD1Database) {
  const auth = await resolveAuthContext(c, db)
  if (!auth) {
    return errorResponse(c, 401, 'authentication_required', 'Authentication required', {
      reason: 'missing_or_invalid_session',
    })
  }
  return auth
}
