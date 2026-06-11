import { and, eq, isNotNull, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { sessions } from '../db/schema'
import type { Env } from '../env'

// A queue-consumer turn owns at most ~15 minutes of wall clock; a cloud
// session still "running" past this window lost its turn (consumer killed,
// worker evicted) and would otherwise stay running forever. Marking it as
// error lets clients (and AK's reconcile sweep) recover the work.
const STALLED_RUNNING_THRESHOLD_MS = 20 * 60_000

export async function markStalledCloudSessions(env: Env): Promise<void> {
  const db = drizzle(env.DB)
  const threshold = new Date(Date.now() - STALLED_RUNNING_THRESHOLD_MS).toISOString()
  await db
    .update(sessions)
    .set({
      status: 'error',
      statusReason: 'Cloud session turn stalled: no completion within the turn wall-clock budget',
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(sessions.status, 'running'), isNotNull(sessions.sandboxId), lt(sessions.updatedAt, threshold)))
}
