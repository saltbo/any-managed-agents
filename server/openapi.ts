import { OpenAPIHono, z } from '@hono/zod-openapi'
import { SESSION_COOKIE_NAME } from './auth/session'
import type { Env } from './env'

export const ApiSecuritySchemes = {
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: SESSION_COOKIE_NAME,
    description: 'AMA browser session cookie issued after FlareAuth OIDC sign-in.',
  },
} as const

export const AuthenticatedOperation = {
  security: [{ cookieAuth: [] }],
}

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

export const PaginationSchema = z
  .object({
    limit: z.number().int().openapi({ example: 50 }),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9' }),
    hasMore: z.boolean().openapi({ example: false }),
    firstId: z.string().nullable().openapi({ example: 'agent_abc123' }),
    lastId: z.string().nullable().openapi({ example: 'agent_def456' }),
    firstSequence: z.number().int().nullable().optional().openapi({ example: 1 }),
    lastSequence: z.number().int().nullable().optional().openapi({ example: 50 }),
  })
  .openapi('ListPagination')

export function listResponseSchema<T extends z.ZodType>(name: string, itemSchema: T) {
  return z
    .object({
      data: z.array(itemSchema),
      pagination: PaginationSchema,
    })
    .openapi(name)
}

const limitQuery = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .openapi({
    param: { name: 'limit', in: 'query' },
    example: 50,
  })

const cursorQuery = z
  .string()
  .min(1)
  .max(512)
  .optional()
  .openapi({
    param: { name: 'cursor', in: 'query' },
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTIyVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFnZW50X2FiYzEyMyJ9',
  })

const searchQuery = z
  .string()
  .min(1)
  .max(120)
  .optional()
  .openapi({
    param: { name: 'search', in: 'query' },
    example: 'research',
  })

const createdFromQuery = z
  .string()
  .datetime()
  .optional()
  .openapi({
    param: { name: 'createdFrom', in: 'query' },
    example: '2026-05-01T00:00:00.000Z',
  })

const createdToQuery = z
  .string()
  .datetime()
  .optional()
  .openapi({
    param: { name: 'createdTo', in: 'query' },
    example: '2026-05-31T23:59:59.999Z',
  })

export function listQuerySchema<const T extends readonly [string, ...string[]]>(statuses: T) {
  const statusValues = statuses as unknown as [T[number], ...T[number][]]
  return z.object({
    includeArchived: z
      .enum(['true', 'false'])
      .optional()
      .openapi({ param: { name: 'includeArchived', in: 'query' }, example: 'false' }),
    status: z
      .enum(statusValues)
      .optional()
      .openapi({
        param: { name: 'status', in: 'query' },
        example: statuses[0],
      }),
    search: searchQuery,
    createdFrom: createdFromQuery,
    createdTo: createdToQuery,
    limit: limitQuery,
    cursor: cursorQuery,
  })
}

export function eventListQuerySchema() {
  return z
    .object({
      cursor: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({
          param: { name: 'cursor', in: 'query' },
          example: 42,
        }),
      order: z
        .enum(['asc', 'desc'])
        .optional()
        .openapi({
          param: { name: 'order', in: 'query' },
          example: 'asc',
        }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .openapi({
          param: { name: 'limit', in: 'query' },
          example: 100,
        }),
    })
    .strict()
}

export interface ListCursor {
  createdAt: string
  id: string
}

export function formatListCursor(row: ListCursor) {
  return btoa(JSON.stringify({ createdAt: row.createdAt, id: row.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export function parseListCursor(cursor: string): ListCursor {
  const padded = cursor
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(cursor.length / 4) * 4, '=')
  const parsed = JSON.parse(atob(padded)) as Partial<ListCursor>
  if (!parsed.createdAt || !parsed.id) {
    throw new Error('Invalid list cursor')
  }
  return { createdAt: parsed.createdAt, id: parsed.id }
}

export function paginateRows<T extends { id: string; createdAt: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit)
  const first = data.at(0)
  const last = data.at(-1)
  return {
    data,
    pagination: {
      limit,
      nextCursor: rows.length > limit && last ? formatListCursor(last) : null,
      hasMore: rows.length > limit,
      firstId: first?.id ?? null,
      lastId: last?.id ?? null,
    },
  }
}

export function paginateSequenceRows<T extends { sequence: number }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit)
  const first = data.at(0)
  const last = data.at(-1)
  return {
    data,
    pagination: {
      limit,
      nextCursor: rows.length > limit && last ? String(last.sequence) : null,
      hasMore: rows.length > limit,
      firstId: first ? String(first.sequence) : null,
      lastId: last ? String(last.sequence) : null,
      firstSequence: first?.sequence ?? null,
      lastSequence: last?.sequence ?? null,
    },
  }
}

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
