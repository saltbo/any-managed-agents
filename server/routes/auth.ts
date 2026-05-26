import { createRoute, z } from '@hono/zod-openapi'
import { drizzle } from 'drizzle-orm/d1'
import { publicOidcConfig } from '../auth/flareauth'
import { requireAuth } from '../auth/session'
import { AuthenticatedOperation, createApiRouter, ErrorResponseSchema } from '../openapi'

const app = createApiRouter()

const AuthContextSchema = z
  .object({
    user: z.object({
      id: z.string(),
      email: z.string(),
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

const OidcClientConfigSchema = z
  .object({
    authority: z.string().url(),
    clientId: z.string(),
    redirectUri: z.string().url(),
    postLogoutRedirectUri: z.string().url(),
    scope: z.string(),
  })
  .openapi('OidcClientConfig')

const configRoute = createRoute({
  method: 'get',
  path: '/config',
  operationId: 'getOidcClientConfig',
  tags: ['Auth'],
  summary: 'Return the FlareAuth OIDC client configuration for the browser',
  responses: {
    200: {
      description: 'OIDC client configuration',
      content: { 'application/json': { schema: OidcClientConfigSchema } },
    },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  operationId: 'getAuthContext',
  tags: ['Auth'],
  summary: 'Return the current FlareAuth-backed AMA auth context',
  ...AuthenticatedOperation,
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

const routes = app
  .openapi(configRoute, (c) => c.json(publicOidcConfig(c.env, new URL(c.req.url).origin), 200))
  .openapi(meRoute, async (c) => {
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

export default routes
