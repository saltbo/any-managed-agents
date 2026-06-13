import type { AuditEntry, AuditPort, AuthScope } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import { auditRecords } from '../../db/schema'
import { redactSensitiveValue } from '../../redaction'

type Db = ReturnType<typeof drizzle>

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

// The scheduler actor is recorded as a system actor with no user id; every
// other caller is the authenticated user.
function defaultActor(auth: AuthScope) {
  if (auth.user.id === 'system:scheduler') {
    return { actorType: 'system' as const, actorUserId: null }
  }
  return { actorType: 'user' as const, actorUserId: auth.user.id }
}

// Audit write boundary. Owns the audit_records insert directly (it already holds
// the db handle); secret material is redacted from the JSON blobs before they
// land in the row.
export function createAuditPort(db: Db): AuditPort {
  return {
    async record(auth: AuthScope, entry: AuditEntry) {
      const actor = defaultActor(auth)
      await db.insert(auditRecords).values({
        id: newId('audit'),
        organizationId: auth.organization.id,
        projectId: auth.project.id,
        actorUserId: actor.actorUserId,
        actorType: actor.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        outcome: entry.outcome,
        requestId: entry.requestId ?? null,
        correlationId: entry.correlationId ?? null,
        sessionId: entry.sessionId ?? null,
        policyCategory: entry.policyCategory ?? null,
        metadata: JSON.stringify(redactSensitiveValue(entry.metadata ?? {})),
        before: JSON.stringify(redactSensitiveValue(entry.before ?? {})),
        after: JSON.stringify(redactSensitiveValue(entry.after ?? {})),
        createdAt: new Date().toISOString(),
      })
    },
  }
}
