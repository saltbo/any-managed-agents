import type { AuditEntry, AuditPort, AuthScope } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import { recordAudit } from '../../audit'
import type { AuthContext } from '../../auth/session'

type Db = ReturnType<typeof drizzle>

// AuthScope is the usecase-facing subset of the http AuthContext. recordAudit
// reads only organization/project/user from it, so the cast is sound.
export function createAuditPort(db: Db): AuditPort {
  return {
    async record(auth: AuthScope, entry: AuditEntry) {
      await recordAudit(db, {
        auth: auth as AuthContext,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        outcome: entry.outcome,
        requestId: entry.requestId ?? null,
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
        ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      })
    },
  }
}
