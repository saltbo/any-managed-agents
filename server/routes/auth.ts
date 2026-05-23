import { createRoute, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { createLoginAttempt, exchangeCodeForUserInfo, OidcError, upsertLocalPrincipal } from '../auth/flareauth'
import {
  clearLoginStateCookie,
  clearSessionCookie,
  createSession,
  readLoginState,
  requireAuth,
  safeReturnTo,
  setLoginStateCookie,
} from '../auth/session'
import { appSessions } from '../db/schema'
import { errorResponse } from '../errors'
import { createApiRouter, ErrorResponseSchema } from '../openapi'

const app = createApiRouter()

const AuthContextSchema = z
  .object({
    user: z.object({
      id: z.string(),
      email: z.string().email(),
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    }),
    organization: z.object({
      id: z.string(),
      name: z.string(),
    }),
    project: z.object({
      id: z.string(),
      name: z.string(),
    }),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  })
  .openapi('AuthContext')

const loginRoute = createRoute({
  method: 'get',
  path: '/login',
  tags: ['Auth'],
  summary: 'Start FlareAuth OIDC login',
  responses: {
    302: {
      description: 'Redirect to FlareAuth authorization endpoint',
    },
    500: {
      description: 'OIDC configuration error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const callbackRoute = createRoute({
  method: 'get',
  path: '/callback',
  tags: ['Auth'],
  summary: 'Complete FlareAuth OIDC login',
  responses: {
    302: {
      description: 'Session created and browser redirected',
    },
    400: {
      description: 'Invalid OIDC callback',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: 'Clear the AMA session',
  responses: {
    204: {
      description: 'Logged out',
    },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Auth'],
  summary: 'Return the current AMA auth context',
  responses: {
    200: {
      description: 'Current auth context',
      content: { 'application/json': { schema: AuthContextSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

app.openapi(loginRoute, async (c) => {
  const returnTo = safeReturnTo(c.req.query('returnTo') ?? null)
  const attempt = await createLoginAttempt(c.env)
  await setLoginStateCookie(c, {
    state: attempt.state,
    nonce: attempt.nonce,
    verifier: attempt.verifier,
    returnTo,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  return c.redirect(attempt.authorizationUrl)
})

app.openapi(callbackRoute, async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const loginState = await readLoginState(c)
  clearLoginStateCookie(c)

  if (!code || !state || !loginState || loginState.state !== state) {
    return errorResponse(c, 400, 'oidc_error', 'Invalid OIDC callback', { reason: 'invalid_state' })
  }

  try {
    const timestamp = new Date().toISOString()
    const db = drizzle(c.env.DB)
    const claims = await exchangeCodeForUserInfo(c.env, code, loginState.verifier, loginState.nonce)
    const principal = await upsertLocalPrincipal(db, claims, timestamp)
    await createSession(c, db, {
      id: newId('auth_session'),
      userId: principal.userId,
      organizationId: principal.organizationId,
      projectId: principal.projectId,
      now: timestamp,
    })
  } catch (err) {
    if (err instanceof OidcError) {
      return errorResponse(c, 400, 'oidc_error', 'Invalid OIDC callback', { reason: err.message })
    }
    throw err
  }

  return c.redirect(loginState.returnTo)
})

app.openapi(logoutRoute, async (c) => {
  const db = drizzle(c.env.DB)
  const auth = await requireAuth(c, db)
  if (!(auth instanceof Response)) {
    await db.update(appSessions).set({ revokedAt: new Date().toISOString() }).where(eq(appSessions.id, auth.sessionId))
  }
  await clearSessionCookie(c)
  return c.body(null, 204)
})

app.openapi(meRoute, async (c) => {
  const auth = await requireAuth(c, drizzle(c.env.DB))
  if (auth instanceof Response) {
    return auth
  }

  return c.json(
    {
      user: auth.user,
      organization: auth.organization,
      project: auth.project,
      roles: auth.roles,
      permissions: auth.permissions,
    },
    200,
  )
})

export default app
