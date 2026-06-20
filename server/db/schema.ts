import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// API v1 schema. Conventions (docs/api-v1-design.md):
// - `state` = operational state machine; `archivedAt` = lifecycle (null = live).
// - `enabled` boolean = operational toggle. Enum values never contain
//   archived/deleted/paused.
// - Credentials are always vault references (credential_id + optional
//   credential_version_id); no raw secret ref strings.
// - organization_id stays in the DB for tenancy but is never exposed in API
//   payloads.

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const federatedTenants = sqliteTable(
  'federated_tenants',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    externalTenantId: text('external_tenant_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Optional default environment for sessions started by this tenant; null =
    // resolve at session start. Intentionally NOT a FK: the usecase accepts any
    // environmentId and validates existence at session-create time (not at write),
    // and D1 enforces FKs at runtime, so a FK would surface a stale id as a raw 500
    // instead of a clean error. Documented soft pointer.
    environmentId: text('environment_id'),
    // JSON array of granted scope strings (e.g. 'session:poll','session:claim');
    // a mutable value-object list, not a relation.
    capabilities: text('capabilities').notNull().default('[]'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_federated_tenants_issuer_tenant').on(table.issuer, table.externalTenantId),
    index('idx_federated_tenants_project').on(table.projectId),
  ],
)

// Global vendor catalog. NOT per-tenant: the platform serves one shared model
// universe (cloud runs everything through the Workers AI binding + AI Gateway),
// so a provider is just the model VENDOR (anthropic, openai, moonshotai, …).
// BYOK connection columns (base_url, credential refs, rate limits, budgets) were
// removed — they only ever mattered for the dropped per-tenant BYOK path.
export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    // Vendor identity, derivable from a model id's vendor segment so discovery
    // resolves rows by slug.
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    // Last discovery refresh health for this vendor. Mirrors MODEL_CATALOG_STATES.
    modelCatalogState: text('model_catalog_state', { enum: ['ready', 'error'] })
      .notNull()
      .default('ready'),
    // JSON-encoded error object (nullable).
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_providers_slug').on(table.slug)],
)

// Global model catalog. One row per (vendor provider, model); populated by the
// scheduled discovery refresh (CF Workers AI search API + models.dev), not by
// per-tenant discovery.
export const providerModels = sqliteTable(
  'provider_models',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    contextWindow: integer('context_window'),
    pricing: text('pricing').notNull().default('{}'),
    // Mirrors MODEL_AVAILABILITY (server/domain/provider.ts).
    availability: text('availability', { enum: ['available', 'unavailable', 'disabled'] })
      .notNull()
      .default('available'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_provider_models_unique_model').on(table.providerId, table.modelId)],
)

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    instructions: text('instructions'),
    // null = resolve the project default provider at session start.
    providerId: text('provider_id').references(() => providers.id),
    model: text('model'),
    skills: text('skills').notNull().default('[]'),
    // JSON value-object array of { username?, role? } handoff sub-agent descriptors.
    subagents: text('subagents').notNull().default('[]'),
    role: text('role'),
    capabilityTags: text('capability_tags').notNull().default('[]'),
    handoffPolicy: text('handoff_policy').notNull().default('{}'),
    memoryPolicy: text('memory_policy').notNull().default('{"enabled":false}'),
    // JSON array of AgentToolAttachment value objects (name/approvalMode/policyMetadata).
    // Not a join table: validated + snapshotted atomically per version.
    tools: text('tools').notNull().default('[]'),
    // JSON array of connector slugs. Resolved against connections at session start,
    // not FK'd (slugs are stable connector ids).
    mcpConnectors: text('mcp_connectors').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    archivedAt: text('archived_at'),
    // Intentionally NOT a FK to agent_versions: agents<->agent_versions is a
    // circular reference (agent_versions.agentId FKs agents.id). The pointer is
    // maintained by the repo (setCurrentVersion) in the same write path; a FK
    // here would create an insert-order deadlock on first version creation.
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_agents_project_created').on(table.projectId, table.createdAt, table.id)],
)

// Immutable per-version snapshot of agent config. JSON columns are intentional
// self-contained value objects — never normalized into join tables (atomic
// snapshot integrity).
export const agentVersions = sqliteTable(
  'agent_versions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    instructions: text('instructions'),
    // Snapshot value, intentionally NOT FK'd to providers: a version must survive
    // a hard provider delete (providers support DELETE). Resolved live only when
    // a session is created from this version. Contrast agents.providerId, which IS
    // a FK because it is live mutable config, not a snapshot.
    providerId: text('provider_id'),
    model: text('model'),
    skills: text('skills').notNull().default('[]'),
    subagents: text('subagents').notNull().default('[]'),
    role: text('role'),
    capabilityTags: text('capability_tags').notNull().default('[]'),
    handoffPolicy: text('handoff_policy').notNull().default('{}'),
    memoryPolicy: text('memory_policy').notNull().default('{"enabled":false}'),
    tools: text('tools').notNull().default('[]'),
    mcpConnectors: text('mcp_connectors').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_agent_versions_agent_id').on(table.agentId),
    uniqueIndex('idx_agent_versions_agent_version').on(table.agentId, table.version),
  ],
)

export const agentMemories = sqliteTable(
  'agent_memories',
  {
    agentId: text('agent_id')
      .primaryKey()
      .references(() => agents.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    content: text('content').notNull().default(''),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_agent_memories_project_updated').on(table.projectId, table.updatedAt, table.agentId)],
)

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    packages: text('packages').notNull().default('[]'),
    variables: text('variables').notNull().default('{}'),
    // JSON array of { credentialId, versionId? } vault references. KEEP as JSON:
    // the live row is the editable working copy snapshotted verbatim into an
    // environment_version on each runtime-config change (atomic value object).
    credentialRefs: text('credential_refs').notNull().default('[]'),
    // Mirrors EnvironmentHostingMode (server/domain/environment.ts).
    hostingMode: text('hosting_mode', { enum: ['cloud', 'self_hosted'] })
      .notNull()
      .default('cloud'),
    networkPolicy: text('network_policy').notNull().default('{"mode":"unrestricted"}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    packageManagerPolicy: text('package_manager_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull().default('{}'),
    runtimeConfig: text('runtime_config').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    archivedAt: text('archived_at'),
    // Intentionally NOT a FK to environment_versions: the circular reference
    // (environment_versions.environment_id -> environments.id) would make inserts
    // un-orderable. Set by setCurrentVersion after the version row exists;
    // integrity is enforced in the usecase, not the DB.
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_environments_project_created').on(table.projectId, table.createdAt, table.id),
    check('ck_environments_hosting_mode', sql`${table.hostingMode} in ('cloud','self_hosted')`),
  ],
)

export const environmentVersions = sqliteTable(
  'environment_versions',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    packages: text('packages').notNull(),
    variables: text('variables').notNull(),
    // Immutable snapshot of credential refs for this version (atomic value object).
    credentialRefs: text('credential_refs').notNull().default('[]'),
    hostingMode: text('hosting_mode', { enum: ['cloud', 'self_hosted'] })
      .notNull()
      .default('cloud'),
    networkPolicy: text('network_policy').notNull().default('{"mode":"unrestricted"}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    packageManagerPolicy: text('package_manager_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull(),
    runtimeConfig: text('runtime_config').notNull(),
    metadata: text('metadata').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_environment_versions_environment_id').on(table.environmentId),
    uniqueIndex('idx_environment_versions_environment_version').on(table.environmentId, table.version),
    check('ck_environment_versions_hosting_mode', sql`${table.hostingMode} in ('cloud','self_hosted')`),
  ],
)

export const vaults = sqliteTable(
  'vaults',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    // NULL = organization-scoped (shared across every project in the org).
    // Project-scoped rows pin a projectId; org-scoped rows are NULL by design
    // (see scope column). organization_id is always present. Visibility queries
    // use OR(projectId=?, projectId IS NULL).
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    // Mirrors VAULT_SCOPES (server/domain/vault.ts).
    scope: text('scope', { enum: ['project', 'organization'] })
      .notNull()
      .default('project'),
    metadata: text('metadata').notNull().default('{}'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vaults_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_vaults_organization_created').on(table.organizationId, table.createdAt, table.id),
    check('ck_vaults_scope', sql`${table.scope} in ('project','organization')`),
  ],
)

export const vaultCredentials = sqliteTable(
  'vault_credentials',
  {
    id: text('id').primaryKey(),
    vaultId: text('vault_id')
      .notNull()
      .references(() => vaults.id),
    organizationId: text('organization_id').notNull(),
    // NULL = organization-scoped (shared across the org); project-scoped rows pin
    // a projectId. organization_id is always present. By design — do not force
    // NOT NULL (visibility queries use OR(projectId=?, projectId IS NULL)).
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    connectorBinding: text('connector_binding').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    // Mirrors CREDENTIAL_STATES (server/domain/vault.ts).
    state: text('state', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    // Intentional non-FK soft pointer. A real FK here + the version's credential_id
    // FK would form a circular dependency blocking the two-step insert (insert
    // credential, insert version, then set active_version_id). Integrity is kept by
    // the insertCredentialWithVersion/insertVersionRotation batches.
    activeVersionId: text('active_version_id'),
    revokedAt: text('revoked_at'),
    revokedByUserId: text('revoked_by_user_id'),
    revokeReason: text('revoke_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vault_credentials_vault_created').on(table.vaultId, table.createdAt, table.id),
    index('idx_vault_credentials_project_created').on(table.projectId, table.createdAt, table.id),
    check('ck_vault_credentials_state', sql`${table.state} in ('active','revoked')`),
  ],
)

export const vaultCredentialVersions = sqliteTable(
  'vault_credential_versions',
  {
    id: text('id').primaryKey(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => vaultCredentials.id),
    vaultId: text('vault_id')
      .notNull()
      .references(() => vaults.id),
    organizationId: text('organization_id').notNull(),
    // NULL = organization-scoped; project-scoped rows pin a projectId. By design.
    projectId: text('project_id').references(() => projects.id),
    version: integer('version').notNull(),
    // Mirrors SECRET_PROVIDERS (server/domain/vault.ts).
    provider: text('provider', { enum: ['ama-managed', 'cloudflare-secrets', 'external-vault'] }).notNull(),
    secretRef: text('secret_ref').notNull(),
    externalVaultPath: text('external_vault_path'),
    referenceName: text('reference_name').notNull(),
    // Mirrors VERSION_STATES (server/domain/vault.ts).
    state: text('state', { enum: ['active', 'superseded', 'revoked'] })
      .notNull()
      .default('active'),
    hasSecret: integer('has_secret', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    supersededAt: text('superseded_at'),
    revokedAt: text('revoked_at'),
  },
  // idx_vault_credential_versions_credential_version dropped: the uniqueIndex on
  // the same (credentialId, version) tuple covers it.
  (table) => [
    uniqueIndex('idx_vault_credential_versions_unique_credential_version').on(table.credentialId, table.version),
    index('idx_vault_credential_versions_vault_created').on(table.vaultId, table.createdAt, table.id),
    check('ck_vault_credential_versions_state', sql`${table.state} in ('active','superseded','revoked')`),
    check(
      'ck_vault_credential_versions_provider',
      sql`${table.provider} in ('ama-managed','cloudflare-secrets','external-vault')`,
    ),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    organizationId: text('organization_id'),
    createdByUserId: text('created_by_user_id'),
    agentVersionId: text('agent_version_id').references(() => agentVersions.id),
    agentSnapshot: text('agent_snapshot'),
    environmentId: text('environment_id').references(() => environments.id),
    environmentVersionId: text('environment_version_id').references(() => environmentVersions.id),
    environmentSnapshot: text('environment_snapshot'),
    title: text('title'),
    resourceRefs: text('resource_refs').notNull().default('[]'),
    env: text('env').notNull().default('{}'),
    // JSON array of { name, credentialRef: { credentialId, versionId? } }. Part of
    // the session's frozen execution spec — a snapshot value object, not relational
    // state (no reverse-query path), so kept as JSON deliberately.
    secretEnv: text('secret_env').notNull().default('[]'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Internal runtime placement columns. Never exposed via the API.
    durableObjectName: text('durable_object_name').notNull(),
    sandboxId: text('sandbox_id'),
    piRuntimeId: text('pi_runtime_id'),
    piProcessId: text('pi_process_id'),
    runtimeEndpointPath: text('runtime_endpoint_path'),
    modelProvider: text('model_provider'),
    modelConfig: text('model_config'),
    // Mirrors SESSION_STATES (server/domain/session.ts).
    state: text('state', { enum: ['pending', 'running', 'idle', 'stopped', 'error'] }).notNull(),
    stateReason: text('state_reason'),
    // Per-session turn lease. The multi-state CAS in updateSessionWhenState is not
    // a mutex (it succeeds on running→running), so a concurrent prompt could race
    // a turn already in flight. A turn claims the lease (active_turn_id) for the
    // whole continuation chain; a second turn loses the CAS and is deferred. NULL
    // means no turn is in flight; an elapsed turn_lease_expires_at lets the next
    // turn reclaim a lease whose holder crashed.
    activeTurnId: text('active_turn_id'),
    turnLeaseExpiresAt: text('turn_lease_expires_at'),
    // Continuation-step depth for the current turn chain; reset to 0 when a fresh
    // turn acquires the lease, incremented per pause, capped to bound runaway loops.
    continuationDepth: integer('continuation_depth').notNull().default(0),
    metadata: text('metadata').notNull().default('{}'),
    startedAt: text('started_at'),
    stoppedAt: text('stopped_at'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_sessions_project_state_created').on(table.projectId, table.state, table.createdAt, table.id),
    // Supports the watchdog isNotNull(sandboxId) sweeps (leakedSandboxSessions /
    // markStalledCloudSessions) without splitting the runtime columns into a side table.
    index('idx_sessions_sandbox').on(table.sandboxId),
    check('ck_sessions_state', sql`${table.state} in ('pending','running','idle','stopped','error')`),
  ],
)

export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    visibility: text('visibility').notNull(),
    role: text('role'),
    parentEventId: text('parent_event_id'),
    correlationId: text('correlation_id'),
    payload: text('payload').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_session_events_session_type_visibility_created').on(
      table.sessionId,
      table.type,
      table.visibility,
      table.createdAt,
    ),
    index('idx_session_events_session_sequence').on(table.sessionId, table.sequence),
    uniqueIndex('idx_session_events_unique_sequence').on(table.sessionId, table.sequence),
  ],
)

export const sessionMessages = sqliteTable(
  'session_messages',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    type: text('type').notNull().default('prompt'),
    content: text('content').notNull(),
    // Mirrors MESSAGE_DELIVERIES (server/domain/session.ts).
    delivery: text('delivery', { enum: ['live', 'queued'] }).notNull(),
    // Mirrors MESSAGE_STATES (server/domain/session.ts).
    state: text('state', { enum: ['accepted', 'delivered', 'failed'] })
      .notNull()
      .default('accepted'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_session_messages_session_created').on(table.sessionId, table.createdAt, table.id),
    check('ck_session_messages_delivery', sql`${table.delivery} in ('live','queued')`),
    check('ck_session_messages_state', sql`${table.state} in ('accepted','delivered','failed')`),
  ],
)

export const sessionApprovals = sqliteTable(
  'session_approvals',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    // Runtime/ACP tool-call correlation id minted by the agent loop, NOT a
    // tool_calls.id FK. tool_calls records only MCP connection-tool executions;
    // sandbox/builtin tool approvals never produce a tool_calls row. Intentionally
    // non-FK (the upsert conflict target is (sessionId, toolCallId)).
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    input: text('input').notNull().default('{}'),
    relatedEventIds: text('related_event_ids').notNull().default('[]'),
    // Mirrors APPROVAL_STATES (server/domain/session.ts).
    state: text('state', { enum: ['pending', 'approved', 'denied'] })
      .notNull()
      .default('pending'),
    reason: text('reason'),
    result: text('result'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: text('decided_at'),
    requestedAt: text('requested_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_session_approvals_session_tool_call').on(table.sessionId, table.toolCallId),
    index('idx_session_approvals_session_state').on(table.sessionId, table.state, table.createdAt),
    check('ck_session_approvals_state', sql`${table.state} in ('pending','approved','denied')`),
  ],
)

export const triggers = sqliteTable(
  'triggers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    // Nullable: an unpinned trigger resolves a runner-capable environment per
    // dispatch (dispatch-triggers.resolveEnvironmentForRuntime) instead of
    // baking one in at creation time.
    environmentId: text('environment_id').references(() => environments.id),
    // Mirrors RuntimeSchema (server/contracts/environment-contracts.ts) — keep in lockstep.
    runtime: text('runtime', { enum: ['ama', 'claude-code', 'codex', 'copilot'] }).notNull(),
    name: text('name').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    resourceRefs: text('resource_refs').notNull().default('[]'),
    env: text('env').notNull().default('{}'),
    // Ordered list of vault credential REFERENCES (name + {credentialId, versionId?});
    // a value-object array, not relational state. Existence is validated at session
    // creation (resolveSecretEnvEntries), not by FK. Kept as JSON deliberately.
    secretEnv: text('secret_env').notNull().default('[]'),
    intervalSeconds: integer('interval_seconds').notNull(),
    windowSeconds: integer('window_seconds').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    nextDueAt: text('next_due_at').notNull(),
    lastDispatchedAt: text('last_dispatched_at'),
    // Intentional non-FK pointer to trigger_runs.id. Avoids a triggers<->trigger_runs
    // circular FK (trigger_runs.trigger_id already FKs triggers); a convenience
    // denormalization set by the dispatcher (advanceTrigger) that may briefly lag.
    lastRunId: text('last_run_id'),
    metadata: text('metadata').notNull().default('{}'),
    // Nullable audit pointer with no FK — there is no users table in this D1 schema
    // (identity lives in the federated/OIDC layer). Survives user-record deletion.
    createdByUserId: text('created_by_user_id'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_triggers_project_next').on(table.projectId, table.enabled, table.nextDueAt, table.id),
    index('idx_triggers_due').on(table.enabled, table.nextDueAt, table.id),
    // enum types the column; check enforces it in D1/SQLite, in parity with every
    // other hardened enum column. Mirrors RuntimeSchema (contracts/environment-contracts).
    check('ck_triggers_runtime', sql`${table.runtime} in ('ama','claude-code','codex','copilot')`),
  ],
)

export const triggerRuns = sqliteTable(
  'trigger_runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    triggerId: text('trigger_id')
      .notNull()
      .references(() => triggers.id),
    scheduledFor: text('scheduled_for').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
    // Mirrors RUN_STATES (server/http/triggers.ts).
    state: text('state', { enum: ['claimed', 'session_created', 'failed'] }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sessionId: text('session_id').references(() => sessions.id),
    correlationId: text('correlation_id').notNull(),
    errorMessage: text('error_message'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_trigger_runs_unique_occurrence').on(table.triggerId, table.scheduledFor),
    uniqueIndex('idx_trigger_runs_idempotency_key').on(table.idempotencyKey),
    index('idx_trigger_runs_trigger_created').on(table.triggerId, table.createdAt, table.id),
    index('idx_trigger_runs_project_created').on(table.projectId, table.createdAt, table.id),
    check('ck_trigger_runs_state', sql`${table.state} in ('claimed','session_created','failed')`),
  ],
)

export const runners = sqliteTable(
  'runners',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    environmentId: text('environment_id').references(() => environments.id),
    // Vault credential ref (nullable). Existence validated in the usecase
    // (credentialRefUsable). Intentionally NOT a FK: a hard FK would reject
    // legitimate pre-validation writes / stale refs as raw D1 500s (D1 enforces
    // FKs). Documented soft pointer.
    credentialId: text('credential_id'),
    credentialVersionId: text('credential_version_id'),
    // Mirrors RUNNER_AUTH_MODES (server/domain/runner-queue.ts).
    authMode: text('auth_mode', { enum: ['bearer', 'mtls', 'oidc', 'federated'] })
      .notNull()
      .default('bearer'),
    oidcSubject: text('oidc_subject'),
    oidcClientId: text('oidc_client_id'),
    // Mirrors RUNNER_STATES (server/http/runners.ts).
    state: text('state', { enum: ['active', 'draining', 'disabled', 'offline'] })
      .notNull()
      .default('offline'),
    currentLoad: integer('current_load').notNull().default(0),
    maxConcurrent: integer('max_concurrent').notNull().default(1),
    // Heartbeat-reported diagnostic snapshots (value objects, never reverse-queried)
    // — KEEP as JSON per the api-v1-design header.
    runtimeUsage: text('runtime_usage').notNull().default('[]'),
    runtimeInventory: text('runtime_inventory').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    lastHeartbeatAt: text('last_heartbeat_at'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_runners_project_state_updated').on(table.projectId, table.state, table.updatedAt, table.id),
    index('idx_runners_project_environment').on(table.projectId, table.environmentId, table.state),
    check('ck_runners_state', sql`${table.state} in ('active','draining','disabled','offline')`),
    check('ck_runners_auth_mode', sql`${table.authMode} in ('bearer','mtls','oidc','federated')`),
  ],
)

export const workItems = sqliteTable(
  'work_items',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id').references(() => sessions.id),
    environmentId: text('environment_id').references(() => environments.id),
    runnerId: text('runner_id').references(() => runners.id),
    // Denormalized non-FK back-pointer to the current live lease (circular-FK
    // avoidance). leases.workItemId is the authoritative owning FK; this is the
    // reverse convenience pointer (mirror of sessions.activeTurnId).
    leaseId: text('lease_id'),
    type: text('type').notNull(),
    // Mirrors WORK_ITEM_STATES (server/http/work-items.ts).
    state: text('state', { enum: ['available', 'leased', 'succeeded', 'failed', 'cancelled'] })
      .notNull()
      .default('available'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    payload: text('payload').notNull(),
    result: text('result'),
    error: text('error'),
    availableAt: text('available_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_work_items_project_state_available').on(
      table.projectId,
      table.state,
      table.availableAt,
      table.priority,
      table.createdAt,
    ),
    index('idx_work_items_session').on(table.sessionId),
    index('idx_work_items_runner_state').on(table.runnerId, table.state),
    check('ck_work_items_state', sql`${table.state} in ('available','leased','succeeded','failed','cancelled')`),
  ],
)

export const leases = sqliteTable(
  'leases',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Mirrors LEASE_STATES (server/http/leases.ts) + 'interrupted' (finish input).
    // Persisted set is {active,completed,failed,cancelled,expired}; 'interrupted'
    // is an input value mapped to 'expired' — included as a harmless permitted superset.
    state: text('state', { enum: ['active', 'completed', 'failed', 'cancelled', 'expired', 'interrupted'] })
      .notNull()
      .default('active'),
    expiresAt: text('expires_at').notNull(),
    renewedAt: text('renewed_at'),
    resumeToken: text('resume_token'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_leases_project_state_expires').on(table.projectId, table.state, table.expiresAt),
    index('idx_leases_runner_state').on(table.runnerId, table.state),
    index('idx_leases_work_item').on(table.workItemId),
    check(
      'ck_leases_state',
      sql`${table.state} in ('active','completed','failed','cancelled','expired','interrupted')`,
    ),
  ],
)

export const sessionChannels = sqliteTable(
  'session_channels',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id),
    leaseId: text('lease_id')
      .notNull()
      .references(() => leases.id),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    state: text('state').notNull().default('active'),
    acceptedAt: text('accepted_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    closedAt: text('closed_at'),
    closeReason: text('close_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_session_channels_session_state').on(table.sessionId, table.state),
    index('idx_session_channels_lease_state').on(table.leaseId, table.state),
    index('idx_session_channels_runner_state').on(table.runnerId, table.state),
  ],
)

export const policies = sqliteTable(
  'policies',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // organization | team | project. Team-scope rows bind to an
    // OIDC-asserted team id; null otherwise. Mirrors PolicyScopeLevel (server/domain/policy.ts).
    scope: text('scope', { enum: ['organization', 'team', 'project'] })
      .notNull()
      .default('project'),
    teamId: text('team_id'),
    toolPolicy: text('tool_policy').notNull().default('{}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    sandboxPolicy: text('sandbox_policy').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_policies_project_scope').on(table.projectId, table.scope, table.updatedAt),
    index('idx_policies_org_scope').on(table.organizationId, table.scope, table.teamId, table.updatedAt),
    uniqueIndex('idx_policies_unique_scope').on(table.projectId, table.scope, table.teamId),
    check('ck_policies_scope', sql`${table.scope} in ('organization','team','project')`),
  ],
)

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // Mirrors BudgetScope (server/domain/policy.ts) + http z.enum.
    scope: text('scope', { enum: ['project', 'provider', 'model'] }).notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    // Mirrors http/budgets.ts z.enum.
    limitType: text('limit_type', { enum: ['tokens', 'cost_micros', 'sessions'] }).notNull(),
    limitValue: integer('limit_value').notNull(),
    window: text('window', { enum: ['day', 'month'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_budgets_project_enabled').on(table.projectId, table.enabled, table.scope),
    check('ck_budgets_scope', sql`${table.scope} in ('project','provider','model')`),
    check('ck_budgets_limit_type', sql`${table.limitType} in ('tokens','cost_micros','sessions')`),
    check('ck_budgets_window', sql`${table.window} in ('day','month')`),
  ],
)

// Append-only usage ledger. agentId/agentVersionId/sessionId/sessionEventId/
// providerId are intentional soft pointers (no FK) so usage history survives
// agent/session/provider deletion. projectId keeps its FK (usage is always
// project-scoped).
export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: text('agent_id'),
    agentVersionId: text('agent_version_id'),
    sessionId: text('session_id'),
    sessionEventId: text('session_event_id'),
    correlationId: text('correlation_id'),
    providerId: text('provider_id'),
    providerType: text('provider_type').notNull(),
    modelId: text('model_id').notNull(),
    // Terminal per-row outcome (never mutated). Mirrors USAGE_STATUSES (server/domain/usage.ts).
    state: text('state', { enum: ['success', 'error'] }).notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    usageType: text('usage_type').notNull().default('model'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_usage_records_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_usage_records_project_provider_model').on(table.projectId, table.providerType, table.modelId),
    check('ck_usage_records_state', sql`${table.state} in ('success','error')`),
  ],
)

// Append-only audit ledger. projectId is nullable + non-FK and
// sessionId/resourceId/actorUserId are soft pointers so audit entries survive
// deletion of the subject and can record org-level (project-less) actions.
export const auditRecords = sqliteTable(
  'audit_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id'),
    actorUserId: text('actor_user_id'),
    actorType: text('actor_type').notNull().default('user'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    sessionId: text('session_id'),
    policyCategory: text('policy_category'),
    metadata: text('metadata').notNull().default('{}'),
    before: text('before').notNull().default('{}'),
    after: text('after').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_records_org_created').on(table.organizationId, table.createdAt, table.id),
    index('idx_audit_records_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_audit_records_action_resource').on(table.action, table.resourceType, table.resourceId),
  ],
)

export const connectors = sqliteTable(
  'connectors',
  {
    // The connector slug (e.g. "github") is the id. connectors is the catalog:
    // seedCatalog() runs before any connection/tool insert and connectors are never
    // deleted, so connections/connection_tools/tool_calls.connector_id safely FK
    // this table (the FK is enforced by D1 at runtime — keep that invariant).
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    trustLevel: text('trust_level').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    supportedAuthModes: text('supported_auth_modes').notNull().default('[]'),
    setupRequirements: text('setup_requirements').notNull().default('[]'),
    // Immutable platform-catalog snapshot of the connector's advertised tool
    // DEFINITIONS (value object, read whole). NOT a dup of connection_tools, which
    // holds per-connection materialized tool instances with tenant policy/availability.
    tools: text('tools').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    availability: text('availability').notNull().default('available'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_connectors_category_trust').on(table.category, table.trustLevel)],
)

export const connections = sqliteTable(
  'connections',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // FK to connectors.id (slug PK; seedCatalog runs before any connection write).
    // Also denormalized onto connection_tools and tool_calls for tenant-scoped queries.
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id),
    credentialId: text('credential_id').references(() => vaultCredentials.id),
    credentialVersionId: text('credential_version_id').references(() => vaultCredentialVersions.id),
    endpointUrl: text('endpoint_url'),
    approvalMode: text('approval_mode').notNull().default('project_policy'),
    state: text('state').notNull().default('connected'),
    lastError: text('last_error'),
    metadata: text('metadata').notNull().default('{}'),
    connectedAt: text('connected_at').notNull(),
    disconnectedAt: text('disconnected_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_connections_project_connector').on(table.projectId, table.connectorId),
    index('idx_connections_project_state').on(table.projectId, table.state, table.createdAt, table.id),
  ],
)

export const connectionTools = sqliteTable(
  'connection_tools',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    // FK to connectors.id (denormalized from the parent connection).
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id),
    name: text('name').notNull(),
    description: text('description'),
    inputSchema: text('input_schema').notNull().default('{}'),
    approvalMode: text('approval_mode').notNull().default('project_policy'),
    policyMetadata: text('policy_metadata').notNull().default('{}'),
    availability: text('availability').notNull().default('available'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_connection_tools_connection_name').on(table.connectionId, table.name),
    index('idx_connection_tools_project_connector_name').on(table.projectId, table.connectorId, table.name),
  ],
)

// Records MCP connection-tool executions only; runtime/sandbox tool calls are
// tracked via session_events + session_approvals, not here.
export const toolCalls = sqliteTable(
  'tool_calls',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    // FK to connectors.id (denormalized from the connection).
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id),
    toolName: text('tool_name').notNull(),
    sessionId: text('session_id').references(() => sessions.id),
    input: text('input').notNull().default('{}'),
    output: text('output'),
    // Mirrors TOOL_CALL_STATES (server/domain/connection.ts).
    state: text('state', { enum: ['success', 'error'] }).notNull(),
    error: text('error'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_tool_calls_connection_tool_created').on(table.connectionId, table.toolName, table.createdAt, table.id),
    index('idx_tool_calls_session_created').on(table.sessionId, table.createdAt, table.id),
    check('ck_tool_calls_state', sql`${table.state} in ('success','error')`),
  ],
)
