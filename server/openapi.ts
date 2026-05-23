import { OpenAPIHono, z } from '@hono/zod-openapi'
import type { Env } from './env'

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      type: z.string().openapi({ example: 'validation_error' }),
      message: z.string().openapi({ example: 'Invalid request' }),
      issues: z.array(z.unknown()).optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .openapi('ErrorResponse')

export function createApiRouter() {
  return new OpenAPIHono<{ Bindings: Env }>({
    defaultHook: (result, c) => {
      if (result.success) {
        return
      }

      return c.json(
        {
          error: {
            type: 'validation_error',
            message: 'Invalid request',
            issues: result.error.issues,
          },
        },
        400,
      )
    },
  })
}
