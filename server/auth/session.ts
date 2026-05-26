import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { getBearerClaims, OidcError, upsertProjectForClaims } from './flareauth'

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
  const token = bearerToken(c.req.raw.headers, c.req.url)
  if (!token) {
    return null
  }

  const claims = await getBearerClaims(c.env, token)
  const requestedProjectId = c.req.raw.headers.get('x-ama-project-id') ?? undefined
  const project = await upsertProjectForClaims(db, claims, new Date().toISOString(), requestedProjectId)
  return {
    user: {
      id: claims.sub,
      email: claims.email ?? '',
      name: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    },
    organization: {
      id: claims.org_id ?? claims.organization_id ?? `user:${claims.sub}`,
      name: claims.org_name ?? claims.organization_name ?? 'Personal workspace',
    },
    project,
    roles: claims.roles,
    permissions: claims.permissions,
  }
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
  return auth
}
