import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ErrorType =
  | 'validation_error'
  | 'authentication_required'
  | 'invalid_session'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'oidc_error'
  | 'internal_error'

export function errorResponse<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  type: ErrorType,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json(
    {
      error: {
        type,
        message,
        ...(details ? { details } : {}),
      },
    },
    status,
  )
}
