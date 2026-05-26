import type { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import type { AuthContext } from './auth/session'
import { auditRecords } from './db/schema'
import type { Env } from './env'
import { redactSensitiveValue } from './redaction'

type AuditDb = ReturnType<typeof drizzle>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function now() {
  return new Date().toISOString()
}

export function redactSecrets(value: unknown): unknown {
  return redactSensitiveValue(value)
}

export function requestId(c: Context<{ Bindings: Env }>) {
  return c.req.header('x-request-id') ?? c.req.header('cf-ray') ?? newId('req')
}

function defaultActor(auth: AuthContext) {
  if (auth.user.id === 'system:scheduler') {
    return { actorType: 'system' as const, actorUserId: null }
  }
  return { actorType: 'user' as const, actorUserId: auth.user.id }
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
    actorType?: 'user' | 'system'
    actorUserId?: string | null
  },
) {
  const actor = defaultActor(values.auth)
  await db.insert(auditRecords).values({
    id: newId('audit'),
    organizationId: values.auth.organization.id,
    projectId: values.auth.project.id,
    actorUserId: values.actorUserId === undefined ? actor.actorUserId : values.actorUserId,
    actorType: values.actorType ?? actor.actorType,
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
