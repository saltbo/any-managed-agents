import { type AuditWriteEntry, createAuditWriteRepo } from './adapters/repos/audit-write'
import type { AuthScope } from './usecases/ports'

// The drizzle handle is typed off the repo factory so the audit writer never
// imports drizzle directly — the repos remain the only drizzle holders.
type AuditDb = Parameters<typeof createAuditWriteRepo>[0]

// Env-bound audit writer still consumed by app.ts and the runtime/ data plane,
// which thread a db handle rather than the Deps object. A thin wrapper over the
// shared audit-write repo so the audit_records insert lives in exactly one place.
export async function recordAudit(db: AuditDb, values: { auth: AuthScope } & AuditWriteEntry) {
  const { auth, ...entry } = values
  await createAuditWriteRepo(db).record(auth, entry)
}
