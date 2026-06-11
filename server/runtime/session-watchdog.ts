import { and, eq, inArray, isNotNull, isNull, lt, notLike, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { sessions } from '../db/schema'
import type { Env } from '../env'
import { stopSessionRuntime } from './session-runtime'

// A queue-consumer invocation owns at most ~15 minutes of wall clock; a cloud
// session still "running" (turn) or "pending" (startup) past this window lost
// its consumer and would otherwise stay stuck forever. Marking it as error
// lets clients (and AK's reconcile sweep) recover the work.
const STALLED_THRESHOLD_MS = 20 * 60_000

const TERMINAL_STATUSES = ['stopped', 'error', 'archived']

export async function markStalledCloudSessions(env: Env): Promise<void> {
  const db = drizzle(env.DB)
  const threshold = new Date(Date.now() - STALLED_THRESHOLD_MS).toISOString()
  await db
    .update(sessions)
    .set({
      status: 'error',
      statusReason: 'Cloud session stalled: no completion within the wall-clock budget',
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        or(
          // a cloud turn lost its consumer mid-run
          and(eq(sessions.status, 'running'), isNotNull(sessions.sandboxId)),
          // a cloud startup died before assigning a sandbox; self-hosted
          // sessions waiting for a runner carry a statusReason and may wait
          // indefinitely, so they are excluded
          and(eq(sessions.status, 'pending'), isNull(sessions.statusReason)),
        ),
        lt(sessions.updatedAt, threshold),
      ),
    )
  await destroyLeakedSandboxes(env, db)
}

// Sandboxes of ended sessions occupy container instances (max_instances is a
// hard cap) when teardown was skipped — e.g. a stop while an exec was hung.
// Destroy them and stamp the session so each sandbox is cleaned exactly once.
async function destroyLeakedSandboxes(env: Env, db: ReturnType<typeof drizzle>): Promise<void> {
  const rows = await db
    .select({ id: sessions.id, sandboxId: sessions.sandboxId, metadata: sessions.metadata })
    .from(sessions)
    .where(
      and(
        inArray(sessions.status, TERMINAL_STATUSES),
        isNotNull(sessions.sandboxId),
        notLike(sessions.metadata, '%"sandboxDestroyedAt"%'),
      ),
    )
    .limit(20)
  for (const row of rows) {
    if (!row.sandboxId) continue
    try {
      await stopSessionRuntime(env, row.sandboxId)
    } catch {
      // instance may already be gone; stamping below prevents retry loops
    }
    const metadata = parseMetadata(row.metadata)
    metadata.sandboxDestroyedAt = new Date().toISOString()
    await db
      .update(sessions)
      .set({ metadata: JSON.stringify(metadata), updatedAt: sql`updated_at` })
      .where(eq(sessions.id, row.id))
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
