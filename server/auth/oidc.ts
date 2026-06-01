import { and, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as client from 'openid-client'
import { projects } from '../db/schema'
import type { Env } from '../env'

export interface UserInfoClaims {
  sub: string
  email?: string
  name?: string
  picture?: string
  client_id?: string
  azp?: string
  scope?: string
  org_id?: string
  organization_id?: string
  org_name?: string
  organization_name?: string
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
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) {
    throw new Error('OIDC_ISSUER and OIDC_CLIENT_ID are required')
  }

  return {
    issuer: env.OIDC_ISSUER.replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
  }
}

async function createOidcClient(env: Env) {
  const config = requireOidcConfig(env)
  const clientMetadata: Partial<client.ClientMetadata> = {
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
          const issuerUrl = new URL(config.issuer)
          if (
            requestUrl.origin === issuerUrl.origin &&
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
              token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
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
          const useServiceBinding = env.OIDC_USE_SERVICE_BINDING !== 'false'
          return useServiceBinding && requestUrl.origin === issuerUrl.origin && env.OIDC_PROVIDER
            ? await env.OIDC_PROVIDER.fetch(request.url, requestInit)
            : await fetch(request.url, requestInit)
        },
      },
    )
  } catch (err) {
    throw toOidcError(err)
  }
}

export async function getBearerClaims(env: Env, accessToken: string): Promise<UserInfoClaims> {
  if (env.AMA_E2E_TEST_AUTH === 'true' && accessToken.startsWith('e2e:')) {
    return e2eClaims(env, accessToken.slice('e2e:'.length), env.OIDC_CLIENT_ID, false)
  }
  if (env.AMA_E2E_TEST_AUTH === 'true' && accessToken.startsWith('e2e-runner:')) {
    if (!env.OIDC_RUNNER_CLIENT_ID) {
      throw new OidcError('OIDC_RUNNER_CLIENT_ID is required for runner e2e tokens')
    }
    return e2eClaims(env, accessToken.slice('e2e-runner:'.length), env.OIDC_RUNNER_CLIENT_ID, true)
  }

  const oidcClient = await createOidcClient(env)
  const claims = await runOidc(() => client.fetchUserInfo(oidcClient, accessToken, client.skipSubjectCheck))
  if (!claims.sub) {
    throw new OidcError('OIDC provider userinfo did not include required subject')
  }
  return normalizeClaims(env, claims as Record<string, unknown> & { sub: string })
}

export async function upsertProjectForClaims(
  db: DrizzleD1Database,
  claims: UserInfoClaims,
  timestamp: string,
  requestedProjectId?: string,
) {
  const organizationId = organizationIdForClaims(claims)
  const projectName = 'Default project'
  let project = await db.select().from(projects).where(eq(projects.organizationId, organizationId)).get()
  if (!project) {
    project = {
      id: newId('project'),
      organizationId,
      name: projectName,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.insert(projects).values(project)
  }
  if (requestedProjectId) {
    const requestedProject = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, requestedProjectId), eq(projects.organizationId, organizationId)))
      .get()
    if (requestedProject) {
      return { id: requestedProject.id, name: requestedProject.name }
    }
  }
  return { id: project.id, name: project.name }
}

export function organizationIdForClaims(claims: UserInfoClaims) {
  return claims.org_id ?? claims.organization_id ?? `user:${claims.sub}`
}

function normalizeClaims(env: Env, claims: Record<string, unknown> & { sub: string }): UserInfoClaims {
  const roles = stringArray(claims.roles)
  const permissions = stringArray(claims.permissions)
  const clientId = stringClaim(claims.client_id) ?? stringClaim(claims.azp)
  const scope = stringClaim(claims.scope)
  const runnerScoped = isRunnerTokenClaim(env, clientId, scope)
  return {
    sub: claims.sub,
    ...optionalClaim('email', claims.email),
    ...optionalClaim('name', claims.name),
    ...optionalClaim('picture', claims.picture),
    ...optionalClaim('client_id', claims.client_id),
    ...optionalClaim('azp', claims.azp),
    ...optionalClaim('scope', claims.scope),
    ...optionalClaim('org_id', claims.org_id),
    ...optionalClaim('organization_id', claims.organization_id),
    ...optionalClaim('org_name', claims.org_name),
    ...optionalClaim('organization_name', claims.organization_name),
    roles: roles.length ? roles : runnerScoped ? ['runner'] : ['owner'],
    permissions: permissions.length ? permissions : runnerScoped ? [] : ['*'],
  }
}

function e2eClaims(env: Env, runId: string, clientId: string | undefined, runnerScope: boolean): UserInfoClaims {
  const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, '_') || newId('run')
  const scope = runnerScope ? 'openid profile email offline_access ama:runner' : 'openid profile email offline_access'
  const runnerScoped = isRunnerTokenClaim(env, clientId, scope)
  return {
    sub: `user_e2e_${safeRunId}`,
    email: `${safeRunId}@e2e.example.com`,
    name: `E2E User ${safeRunId}`,
    ...(clientId ? { client_id: clientId, azp: clientId } : {}),
    scope,
    org_id: `org_e2e_${safeRunId}`,
    org_name: `E2E Organization ${safeRunId}`,
    roles: runnerScoped ? ['runner'] : ['owner'],
    permissions: runnerScoped ? [] : ['*'],
  }
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
  return new OidcError('OIDC operation failed')
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function stringClaim(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalClaim<Key extends keyof UserInfoClaims>(key: Key, value: unknown) {
  const claim = stringClaim(value)
  return claim ? ({ [key]: claim } as Pick<UserInfoClaims, Key>) : {}
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function isRunnerTokenClaim(env: Env, clientId: string | undefined, scope: string | undefined) {
  return (
    !!env.OIDC_RUNNER_CLIENT_ID &&
    clientId === env.OIDC_RUNNER_CLIENT_ID &&
    scope?.split(/\s+/).includes('ama:runner') === true
  )
}
