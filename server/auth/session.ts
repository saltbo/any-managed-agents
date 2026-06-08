import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import type { Env } from '../env'
import { errorResponse } from '../errors'
import { getBearerClaims, OidcError, organizationIdForClaims, upsertProjectForClaims } from './oidc'

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
  const identity = authIdentityFromClaims(claims)
  const requestedProjectId = c.req.raw.headers.get('x-ama-project-id') ?? undefined
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

export async function resolveAuthIdentity(c: Context<{ Bindings: Env }>): Promise<AuthIdentity | null> {
  const token = bearerToken(c.req.raw.headers, c.req.url)
  if (!token) {
    return null
  }

  const claims = await getBearerClaims(c.env, token)
  return authIdentityFromClaims(claims)
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
  if (isRunnerOidcAuth(c.env, auth) && !new URL(c.req.url).pathname.startsWith('/api/runners')) {
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
  if (isRunnerOidcAuth(c.env, auth) && !new URL(c.req.url).pathname.startsWith('/api/runners')) {
    return errorResponse(c, 403, 'forbidden', 'Runner token is not authorized for this resource') as never
  }
  return auth
}
