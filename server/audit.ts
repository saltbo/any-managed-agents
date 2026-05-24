import type { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import type { AuthContext } from './auth/session'
import { auditRecords } from './db/schema'
import type { Env } from './env'

type AuditDb = ReturnType<typeof drizzle>

const SECRET_KEYS = ['secret', 'credential', 'token', 'apiKey', 'api_key', 'password', 'authorization']

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const sensitive = SECRET_KEYS.some((secretKey) => key.toLowerCase().includes(secretKey.toLowerCase()))
      return [key, sensitive ? '[REDACTED]' : redactSecrets(entry)]
    }),
  )
}

export function requestId(c: Context<{ Bindings: Env }>) {
  return c.req.header('x-request-id') ?? c.req.header('cf-ray') ?? newId('req')
}

export async function recordAudit(
  db: AuditDb,
  values: {
    auth: AuthContext
    action: string
    resourceType: string
    resourceId?: string | null
    outcome: 'success' | 'failure' | 'denied'
    requestId?: string | null
    correlationId?: string | null
    sessionId?: string | null
    policyCategory?: string | null
    metadata?: Record<string, unknown>
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  },
) {
  await db.insert(auditRecords).values({
    id: newId('audit'),
    organizationId: values.auth.organization.id,
    projectId: values.auth.project.id,
    actorUserId: values.auth.user.id,
    actorType: 'user',
    action: values.action,
    resourceType: values.resourceType,
    resourceId: values.resourceId ?? null,
    outcome: values.outcome,
    requestId: values.requestId ?? null,
    correlationId: values.correlationId ?? null,
    sessionId: values.sessionId ?? null,
    policyCategory: values.policyCategory ?? null,
    metadata: JSON.stringify(redactSecrets(values.metadata ?? {})),
    before: JSON.stringify(redactSecrets(values.before ?? {})),
    after: JSON.stringify(redactSecrets(values.after ?? {})),
    createdAt: now(),
  })
}
