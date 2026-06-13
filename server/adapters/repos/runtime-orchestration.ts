import type { CanonicalAmaSessionEvent } from '@shared/session-events'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, notLike, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  agentMemories,
  agents,
  agentVersions,
  connections,
  connectionTools,
  environments,
  environmentVersions,
  leases,
  providers as providersTable,
  runners,
  sessionApprovals,
  sessionChannels,
  sessionEvents,
  sessions,
  vaultCredentials,
  vaultCredentialVersions,
  workItems,
} from '../../db/schema'
import { insertCanonicalSessionEvent } from '../../db/session-event-store'

type Db = ReturnType<typeof drizzle>

export type SessionRow = typeof sessions.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type AgentVersionRow = typeof agentVersions.$inferSelect
export type EnvironmentRow = typeof environments.$inferSelect
export type EnvironmentVersionRow = typeof environmentVersions.$inferSelect
export type WorkItemRow = typeof workItems.$inferSelect
export type ConnectionRow = typeof connections.$inferSelect
export type ConnectionToolRow = typeof connectionTools.$inferSelect

type SessionInsert = typeof sessions.$inferInsert
type WorkItemInsert = typeof workItems.$inferInsert
type SessionApprovalInsert = typeof sessionApprovals.$inferInsert
type SessionUpdate = Partial<typeof sessions.$inferInsert>

// Runtime-internal persistence boundary. The env-bound session execution engine
// (server/runtime/*) routes every drizzle read/write here so the runtime layer
// itself stays drizzle-free. This repo is intentionally runtime-shaped (raw
// session rows, work-item/lease/channel mechanics, snapshot reads) — distinct
// from the REST-facing SessionRepo, which serializes DTOs. Both are the only
// places these tables are touched.
export function createRuntimeOrchestrationRepo(db: Db) {
  return {
    // The persistence handle the runtime forwards to the cross-cutting policy
    // engine (server/policy.ts), which routes its own reads through repos. The
    // handle never leaves this object for direct drizzle use in runtime/.
    db,

    // ── session reads ─────────────────────────────────────────────────────
    async findSession(projectId: string, sessionId: string): Promise<SessionRow | null> {
      return (
        (await db
          .select()
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    async sessionState(projectId: string, sessionId: string): Promise<{ state: string } | null> {
      return (
        (await db
          .select({ state: sessions.state })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    async sessionMetadata(projectId: string, sessionId: string): Promise<{ metadata: string | null } | null> {
      return (
        (await db
          .select({ metadata: sessions.metadata })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    // ── session writes ────────────────────────────────────────────────────
    async insertSession(row: SessionInsert): Promise<void> {
      await db.insert(sessions).values(row)
    },

    async updateSession(projectId: string, sessionId: string, fields: SessionUpdate): Promise<void> {
      await db
        .update(sessions)
        .set(fields)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
    },

    // Conditional state transition; returns true when the guarded row matched.
    async updateSessionWhenState(
      projectId: string,
      sessionId: string,
      expected: string | string[],
      fields: SessionUpdate,
    ): Promise<boolean> {
      const stateGuard = Array.isArray(expected)
        ? or(...expected.map((state) => eq(sessions.state, state)))
        : eq(sessions.state, expected)
      const updated = await db
        .update(sessions)
        .set(fields)
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId), stateGuard))
        .returning({ id: sessions.id })
        .get()
      return Boolean(updated)
    },

    // ── snapshot reads (create-session orchestration) ─────────────────────
    async findAgent(projectId: string, agentId: string): Promise<AgentRow | null> {
      return (
        (await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, agentId), eq(agents.projectId, projectId)))
          .get()) ?? null
      )
    },

    async findAgentVersion(agentId: string, versionId: string): Promise<AgentVersionRow | null> {
      return (
        (await db
          .select()
          .from(agentVersions)
          .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId)))
          .get()) ?? null
      )
    },

    async agentMemoryContent(projectId: string, agentId: string): Promise<string | null> {
      const memory = await db
        .select({ content: agentMemories.content })
        .from(agentMemories)
        .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.projectId, projectId)))
        .get()
      return memory?.content ?? null
    },

    async findEnvironment(projectId: string, environmentId: string): Promise<EnvironmentRow | null> {
      return (
        (await db
          .select()
          .from(environments)
          .where(
            and(
              eq(environments.id, environmentId),
              eq(environments.projectId, projectId),
              isNull(environments.archivedAt),
            ),
          )
          .get()) ?? null
      )
    },

    async findEnvironmentVersion(projectId: string, versionId: string): Promise<EnvironmentVersionRow | null> {
      return (
        (await db
          .select()
          .from(environmentVersions)
          .where(and(eq(environmentVersions.id, versionId), eq(environmentVersions.projectId, projectId)))
          .get()) ?? null
      )
    },

    // ── provider resolution ───────────────────────────────────────────────
    async configuredDefaultProvider(projectId: string): Promise<{ id: string; type: string } | null> {
      return (
        (await db
          .select({ id: providersTable.id, type: providersTable.type })
          .from(providersTable)
          .where(
            and(
              eq(providersTable.projectId, projectId),
              eq(providersTable.isDefault, true),
              eq(providersTable.enabled, true),
            ),
          )
          .get()) ?? null
      )
    },

    async providerType(projectId: string, providerId: string): Promise<{ type: string } | null> {
      return (
        (await db
          .select({ type: providersTable.type })
          .from(providersTable)
          .where(and(eq(providersTable.id, providerId), eq(providersTable.projectId, projectId)))
          .get()) ?? null
      )
    },

    // The default-or-named provider connection projection for runtime dispatch.
    async defaultProviderConfig(projectId: string): Promise<ProviderConfigRow | null> {
      return (
        (await db
          .select(providerConfigSelection)
          .from(providersTable)
          .where(and(eq(providersTable.projectId, projectId), eq(providersTable.isDefault, true)))
          .orderBy(desc(providersTable.updatedAt))
          .get()) ?? null
      )
    },

    async namedProviderConfig(projectId: string, providerId: string): Promise<ProviderConfigRow | null> {
      return (
        (await db
          .select(providerConfigSelection)
          .from(providersTable)
          .where(and(eq(providersTable.id, providerId), eq(providersTable.projectId, projectId)))
          .get()) ?? null
      )
    },

    // ── runtime/runner capability validation ──────────────────────────────
    async activeRunnerCapabilities(projectId: string, environmentId: string): Promise<string[]> {
      const activeRunners = await db
        .select({ capabilities: runners.capabilities })
        .from(runners)
        .where(
          and(eq(runners.projectId, projectId), eq(runners.environmentId, environmentId), eq(runners.state, 'active')),
        )
      return activeRunners.map((runner) => runner.capabilities)
    },

    // ── MCP snapshot resolution ────────────────────────────────────────────
    async connectedConnections(projectId: string): Promise<ConnectionRow[]> {
      return db
        .select()
        .from(connections)
        .where(and(eq(connections.projectId, projectId), eq(connections.state, 'connected')))
    },

    async availableConnectionTools(connectionId: string): Promise<ConnectionToolRow[]> {
      return db
        .select()
        .from(connectionTools)
        .where(and(eq(connectionTools.connectionId, connectionId), eq(connectionTools.availability, 'available')))
    },

    // ── credential validation (resource refs + secret env) ─────────────────
    async activeCredentialVersionExists(
      organizationId: string,
      projectId: string,
      versionId: string,
    ): Promise<boolean> {
      const version = await db
        .select({ id: vaultCredentialVersions.id })
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, versionId),
            eq(vaultCredentialVersions.organizationId, organizationId),
            or(eq(vaultCredentialVersions.projectId, projectId), isNull(vaultCredentialVersions.projectId)),
            eq(vaultCredentialVersions.state, 'active'),
          ),
        )
        .get()
      return Boolean(version)
    },

    async activeCredentialExists(organizationId: string, projectId: string, credentialId: string): Promise<boolean> {
      const credential = await db
        .select({ id: vaultCredentials.id })
        .from(vaultCredentials)
        .where(
          and(
            eq(vaultCredentials.id, credentialId),
            eq(vaultCredentials.organizationId, organizationId),
            or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
            eq(vaultCredentials.state, 'active'),
          ),
        )
        .get()
      return Boolean(credential)
    },

    async activeCredentialForSecretEnv(
      organizationId: string,
      projectId: string,
      credentialId: string,
    ): Promise<{ id: string; activeVersionId: string | null } | null> {
      return (
        (await db
          .select({ id: vaultCredentials.id, activeVersionId: vaultCredentials.activeVersionId })
          .from(vaultCredentials)
          .where(
            and(
              eq(vaultCredentials.id, credentialId),
              eq(vaultCredentials.organizationId, organizationId),
              or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
              eq(vaultCredentials.state, 'active'),
            ),
          )
          .get()) ?? null
      )
    },

    async activeVersionForCredentialExists(credentialId: string, versionId: string): Promise<boolean> {
      const version = await db
        .select({ id: vaultCredentialVersions.id })
        .from(vaultCredentialVersions)
        .where(
          and(
            eq(vaultCredentialVersions.id, versionId),
            eq(vaultCredentialVersions.credentialId, credentialId),
            eq(vaultCredentialVersions.state, 'active'),
          ),
        )
        .get()
      return Boolean(version)
    },

    // ── secret-env resolution (runtime dispatch) ───────────────────────────
    async credentialForResolution(
      organizationId: string,
      projectId: string,
      credentialId: string,
    ): Promise<{ state: string; activeVersionId: string | null } | null> {
      return (
        (await db
          .select({ state: vaultCredentials.state, activeVersionId: vaultCredentials.activeVersionId })
          .from(vaultCredentials)
          .where(
            and(
              eq(vaultCredentials.id, credentialId),
              eq(vaultCredentials.organizationId, organizationId),
              or(eq(vaultCredentials.projectId, projectId), isNull(vaultCredentials.projectId)),
            ),
          )
          .get()) ?? null
      )
    },

    async credentialVersionForResolution(
      organizationId: string,
      projectId: string,
      credentialId: string,
      versionId: string,
    ): Promise<{
      state: string
      metadata: string
      externalVaultPath: string | null
      secretRef: string
    } | null> {
      return (
        (await db
          .select({
            state: vaultCredentialVersions.state,
            metadata: vaultCredentialVersions.metadata,
            externalVaultPath: vaultCredentialVersions.externalVaultPath,
            secretRef: vaultCredentialVersions.secretRef,
          })
          .from(vaultCredentialVersions)
          .where(
            and(
              eq(vaultCredentialVersions.id, versionId),
              eq(vaultCredentialVersions.credentialId, credentialId),
              eq(vaultCredentialVersions.organizationId, organizationId),
              or(eq(vaultCredentialVersions.projectId, projectId), isNull(vaultCredentialVersions.projectId)),
            ),
          )
          .get()) ?? null
      )
    },

    // ── work-item enqueue + resume ──────────────────────────────────────────
    async insertWorkItem(row: WorkItemInsert): Promise<void> {
      await db.insert(workItems).values(row)
    },

    async recentSessionWorkItems(
      projectId: string,
      sessionId: string,
      limit: number,
    ): Promise<{ state: string; payload: string; result: string | null }[]> {
      return db
        .select({ state: workItems.state, payload: workItems.payload, result: workItems.result })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), eq(workItems.sessionId, sessionId)))
        .orderBy(desc(workItems.updatedAt))
        .limit(limit)
    },

    // ── self-hosted stop: active work items + lease/runner accounting ───────
    async activeSessionWorkItems(
      projectId: string,
      sessionId: string,
    ): Promise<{ id: string; runnerId: string | null; leaseId: string | null }[]> {
      return db
        .select({ id: workItems.id, runnerId: workItems.runnerId, leaseId: workItems.leaseId })
        .from(workItems)
        .where(
          and(
            eq(workItems.projectId, projectId),
            eq(workItems.sessionId, sessionId),
            inArray(workItems.state, ['available', 'leased']),
          ),
        )
    },

    async cancelWorkItems(
      projectId: string,
      workItemIds: string[],
      errorJson: string,
      timestamp: string,
    ): Promise<void> {
      await db
        .update(workItems)
        .set({ state: 'cancelled', leaseExpiresAt: null, error: errorJson, updatedAt: timestamp })
        .where(and(eq(workItems.projectId, projectId), inArray(workItems.id, workItemIds)))
    },

    async cancelLeases(projectId: string, leaseIds: string[], timestamp: string): Promise<void> {
      await db
        .update(leases)
        .set({ state: 'cancelled', updatedAt: timestamp })
        .where(and(eq(leases.projectId, projectId), inArray(leases.id, leaseIds)))
    },

    async decrementRunnerLoad(projectId: string, runnerId: string, timestamp: string): Promise<void> {
      await db
        .update(runners)
        .set({
          currentLoad: sql`case when ${runners.currentLoad} > 0 then ${runners.currentLoad} - 1 else 0 end`,
          updatedAt: timestamp,
        })
        .where(and(eq(runners.id, runnerId), eq(runners.projectId, projectId)))
    },

    // ── turn execution reads ────────────────────────────────────────────────
    async sessionEventStream(sessionId: string): Promise<{ type: string; payload: string }[]> {
      return db
        .select({ type: sessionEvents.type, payload: sessionEvents.payload })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.sequence))
        .all()
    },

    // ── pending session sweep ────────────────────────────────────────────────
    async markExpiredPendingSessions(projectId: string, expiredBefore: string, timestamp: string): Promise<void> {
      await db
        .update(sessions)
        .set({ state: 'error', stateReason: 'Session runtime startup timed out', updatedAt: timestamp })
        .where(
          and(
            eq(sessions.projectId, projectId),
            eq(sessions.state, 'pending'),
            or(
              isNull(sessions.stateReason),
              and(ne(sessions.stateReason, 'requires-runner'), ne(sessions.stateReason, 'waiting-for-runner')),
            ),
            sql`${sessions.createdAt} < ${expiredBefore}`,
          ),
        )
    },

    // ── approval decision ────────────────────────────────────────────────────
    async findApproval(projectId: string, sessionId: string, approvalId: string): Promise<unknown> {
      return await db
        .select()
        .from(sessionApprovals)
        .where(
          and(
            eq(sessionApprovals.id, approvalId),
            eq(sessionApprovals.sessionId, sessionId),
            eq(sessionApprovals.projectId, projectId),
          ),
        )
        .get()
    },

    async upsertApproval(row: SessionApprovalInsert, decidedAt: string): Promise<void> {
      await db
        .insert(sessionApprovals)
        .values(row)
        .onConflictDoUpdate({
          target: [sessionApprovals.sessionId, sessionApprovals.toolCallId],
          set: {
            state: row.state,
            reason: row.reason,
            result: row.result,
            decidedByUserId: row.decidedByUserId,
            decidedAt,
            updatedAt: decidedAt,
          },
        })
    },

    // ── watchdog: stalled cloud sessions + leaked sandboxes ──────────────────
    async markStalledCloudSessions(threshold: string, timestamp: string): Promise<void> {
      await db
        .update(sessions)
        .set({
          state: 'error',
          stateReason: 'Cloud session stalled: no completion within the wall-clock budget',
          updatedAt: timestamp,
        })
        .where(
          and(
            or(
              and(eq(sessions.state, 'running'), isNotNull(sessions.sandboxId)),
              and(eq(sessions.state, 'pending'), isNull(sessions.stateReason)),
            ),
            lt(sessions.updatedAt, threshold),
          ),
        )
    },

    async leakedSandboxSessions(
      terminalStates: string[],
      limit: number,
    ): Promise<{ id: string; sandboxId: string | null; metadata: string | null }[]> {
      return db
        .select({ id: sessions.id, sandboxId: sessions.sandboxId, metadata: sessions.metadata })
        .from(sessions)
        .where(
          and(
            or(inArray(sessions.state, terminalStates), isNotNull(sessions.archivedAt)),
            isNotNull(sessions.sandboxId),
            notLike(sessions.metadata, '%"sandboxDestroyedAt"%'),
          ),
        )
        .limit(limit)
    },

    async stampSandboxDestroyed(sessionId: string, metadataJson: string): Promise<void> {
      await db
        .update(sessions)
        .set({ metadata: metadataJson, updatedAt: sql`updated_at` })
        .where(eq(sessions.id, sessionId))
    },

    // ── runner session channel (durable object) ──────────────────────────────
    async channelSession(
      projectId: string,
      sessionId: string,
    ): Promise<{ id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null> {
      return (
        (await db
          .select({
            id: sessions.id,
            agentSnapshot: sessions.agentSnapshot,
            environmentSnapshot: sessions.environmentSnapshot,
          })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    async channelSessionState(
      projectId: string,
      sessionId: string,
    ): Promise<{ state: string; stateReason: string | null } | null> {
      return (
        (await db
          .select({ state: sessions.state, stateReason: sessions.stateReason })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
          .get()) ?? null
      )
    },

    async channelWorkItem(projectId: string, workItemId: string): Promise<WorkItemRow | null> {
      return (
        (await db
          .select()
          .from(workItems)
          .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
          .get()) ?? null
      )
    },

    async channelActiveLease(state: {
      leaseId: string
      workItemId: string
      runnerId: string
      projectId: string
    }): Promise<{ expiresAt: string } | null> {
      return (
        (await db
          .select({ expiresAt: leases.expiresAt })
          .from(leases)
          .where(
            and(
              eq(leases.id, state.leaseId),
              eq(leases.workItemId, state.workItemId),
              eq(leases.runnerId, state.runnerId),
              eq(leases.projectId, state.projectId),
              eq(leases.state, 'active'),
            ),
          )
          .get()) ?? null
      )
    },

    async channelActiveChannel(state: {
      channelId: string
      sessionId: string
      workItemId: string
      leaseId: string
      runnerId: string
      projectId: string
    }): Promise<{ id: string } | null> {
      return (
        (await db
          .select({ id: sessionChannels.id })
          .from(sessionChannels)
          .where(
            and(
              eq(sessionChannels.id, state.channelId),
              eq(sessionChannels.sessionId, state.sessionId),
              eq(sessionChannels.workItemId, state.workItemId),
              eq(sessionChannels.leaseId, state.leaseId),
              eq(sessionChannels.runnerId, state.runnerId),
              eq(sessionChannels.projectId, state.projectId),
              eq(sessionChannels.state, 'active'),
            ),
          )
          .get()) ?? null
      )
    },

    async touchChannel(channelId: string, timestamp: string): Promise<void> {
      await db
        .update(sessionChannels)
        .set({ lastSeenAt: timestamp, updatedAt: timestamp })
        .where(and(eq(sessionChannels.id, channelId), eq(sessionChannels.state, 'active')))
    },

    async closeChannel(
      channelId: string,
      channelState: 'closed' | 'stale',
      reason: string,
      timestamp: string,
    ): Promise<void> {
      await db
        .update(sessionChannels)
        .set({ state: channelState, closedAt: timestamp, closeReason: reason, updatedAt: timestamp })
        .where(and(eq(sessionChannels.id, channelId), eq(sessionChannels.state, 'active')))
    },

    async requeueSessionForRunnerRecovery(projectId: string, sessionId: string, timestamp: string): Promise<void> {
      await db
        .update(sessions)
        .set({ state: 'pending', stateReason: 'waiting-for-runner-recovery', updatedAt: timestamp })
        .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
    },

    // ── canonical event append (runtime + channel ingest) ───────────────────
    async appendCanonicalEvent(
      scope: { organizationId: string; projectId: string; sessionId: string },
      canonicalEvent: CanonicalAmaSessionEvent,
    ): Promise<string> {
      return insertCanonicalSessionEvent(db, scope, canonicalEvent)
    },
  }
}

export type RuntimeOrchestrationRepo = ReturnType<typeof createRuntimeOrchestrationRepo>

// The runtime queue consumer, scheduled watchdog, and the runner-session DO bind
// their own D1 handle (they run outside the per-request composition root). The
// drizzle construction stays here in adapters so those runtime entrypoints take
// the raw `D1Database` binding and never import drizzle themselves.
export function createRuntimeOrchestrationRepoFromBinding(binding: D1Database): RuntimeOrchestrationRepo {
  return createRuntimeOrchestrationRepo(drizzle(binding))
}

const providerConfigSelection = {
  id: providersTable.id,
  type: providersTable.type,
  baseUrl: providersTable.baseUrl,
  enabled: providersTable.enabled,
  credentialId: providersTable.credentialId,
  credentialVersionId: providersTable.credentialVersionId,
}

export interface ProviderConfigRow {
  id: string
  type: string
  baseUrl: string | null
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
}
