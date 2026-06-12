import { createRoute, z } from '@hono/zod-openapi'
import { drizzle } from 'drizzle-orm/d1'
import {
  getBearerClaims,
  OidcError,
  organizationIdForClaims,
  requireOidcConfig,
  upsertProjectForClaims,
} from '../auth/oidc'
import { createSessionCookie, sessionCookieHeader } from '../auth/session'
import { errorResponse } from '../errors'
import { createApiRouter, ErrorResponseSchema } from '../openapi'

const app = createApiRouter()

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

const CreateSessionRequestSchema = z
  .object({
    accessToken: z.string().min(1).openapi({ example: 'eyJhbGciOiJFZERTQSJ9...' }),
  })
  .openapi('CreateAuthSessionRequest')

const AuthUserSchema = z
  .object({
    id: z.string().openapi({ example: 'user_abc123' }),
    email: z.string().openapi({ example: 'user@example.com' }),
    name: z.string().nullable().openapi({ example: 'Ada Lovelace' }),
  })
  .openapi('AuthUser')

const AuthOrganizationSchema = z
  .object({
    id: z.string().openapi({ example: 'org_abc123' }),
    name: z.string().openapi({ example: 'Example Org' }),
  })
  .openapi('AuthOrganization')

const AuthProjectSchema = z
  .object({
    id: z.string().openapi({ example: 'project_abc123' }),
    name: z.string().openapi({ example: 'Default project' }),
  })
  .openapi('AuthProject')

const CreateSessionResponseSchema = z
  .object({
    user: AuthUserSchema,
    organization: AuthOrganizationSchema,
    project: AuthProjectSchema,
  })
  .openapi('AuthSession')

const LoginOptionSchema = z
  .object({
    type: z.literal('oidc').openapi({ example: 'oidc' }),
    issuer: z.string().url().openapi({ example: 'https://id.example.com/api/auth' }),
    clientId: z.string().openapi({ example: 'client_abc123' }),
  })
  .openapi('LoginOption')

const LoginOptionsResponseSchema = z
  .object({
    methods: z.array(LoginOptionSchema),
  })
  .openapi('LoginOptionsResponse')

const LoginOptionsQuerySchema = z.object({
  organization: z
    .string()
    .min(1)
    .max(240)
    .optional()
    .openapi({
      param: { name: 'organization', in: 'query' },
      example: 'example-org',
    }),
})

// ──────────────────────────────────────────────────────────────────────────────
// Route definitions
// ──────────────────────────────────────────────────────────────────────────────

const createSessionRoute = createRoute({
  method: 'post',
  path: '/session',
  operationId: 'createAuthSession',
  tags: ['Auth'],
  summary: 'Complete OIDC sign-in and create an httpOnly session cookie',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateSessionRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Session created. Sets an httpOnly session cookie.',
      content: { 'application/json': { schema: CreateSessionResponseSchema } },
    },
    401: {
      description: 'Invalid or expired OIDC token',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    403: {
      description: 'Request origin is not in the allowed origins list',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const getLoginOptionsRoute = createRoute({
  method: 'get',
  path: '/login-options',
  operationId: 'getLoginOptions',
  tags: ['Auth'],
  summary: 'Discover available login methods for an organization',
  request: {
    query: LoginOptionsQuerySchema,
  },
  responses: {
    200: {
      description: 'Available login methods for the organization',
      content: { 'application/json': { schema: LoginOptionsResponseSchema } },
    },
  },
})

// ──────────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────────

const routes = app
  .openapi(createSessionRoute, async (c) => {
    // Reject cross-origin token submissions when an origin allowlist is configured.
    const requestOrigin = c.req.header('origin')
    const allowedOrigins = c.env.AMA_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? []
    if (requestOrigin && allowedOrigins.length > 0 && !allowedOrigins.includes(requestOrigin)) {
      return errorResponse(c, 403, 'forbidden', 'Request origin is not allowed') as never
    }

    const { accessToken } = c.req.valid('json')

    let claims: Awaited<ReturnType<typeof getBearerClaims>>
    try {
      claims = await getBearerClaims(c.env, accessToken)
    } catch (err) {
      if (err instanceof OidcError) {
        return errorResponse(c, 401, 'oidc_error', 'OIDC token validation failed', {
          reason: err.message,
        }) as never
      }
      throw err
    }

    const db = drizzle(c.env.DB)
    const project = await upsertProjectForClaims(db, claims, new Date().toISOString())
    const organizationId = project.organizationId ?? organizationIdForClaims(claims)

    const cookieValue = await createSessionCookie(c.env, claims)
    if (cookieValue) {
      const isSecure = new URL(c.req.url).protocol === 'https:'
      c.header('Set-Cookie', sessionCookieHeader(cookieValue, isSecure))
    }

    return c.json(
      {
        user: {
          id: claims.sub,
          email: claims.email ?? '',
          name: claims.name ?? null,
        },
        organization: {
          id: organizationId,
          name: claims.org_name ?? claims.organization_name ?? 'Personal workspace',
        },
        project: {
          id: project.id,
          name: project.name,
        },
      },
      200,
    )
  })
  .openapi(getLoginOptionsRoute, (c) => {
    let methods: Array<{ type: 'oidc'; issuer: string; clientId: string }> = []
    try {
      const { issuer, clientId } = requireOidcConfig(c.env)
      methods = [{ type: 'oidc' as const, issuer, clientId }]
    } catch {
      methods = []
    }
    return c.json({ methods }, 200)
  })

export default routes
