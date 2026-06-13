import type { AuditEntry, AuditPort, AuthScope } from '@server/usecases/ports'
import type { drizzle } from 'drizzle-orm/d1'
import { createAuditWriteRepo } from '../repos/audit-write'

type Db = ReturnType<typeof drizzle>

// Audit write boundary. Delegates to the shared audit-write repo so the
// audit_records insert lives in exactly one place; the gateway always records
// the authenticated actor derived from the auth scope.
export function createAuditPort(db: Db): AuditPort {
  const repo = createAuditWriteRepo(db)
  return {
    async record(auth: AuthScope, entry: AuditEntry) {
      await repo.record(auth, entry)
    },
  }
}
