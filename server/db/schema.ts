import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    environmentId: text('environment_id'),
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

export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    type: text('type').notNull(),
    displayName: text('display_name').notNull(),
    baseUrl: text('base_url'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    credentialId: text('credential_id'),
    credentialVersionId: text('credential_version_id'),
    metadata: text('metadata').notNull().default('{}'),
    rateLimits: text('rate_limits').notNull().default('{}'),
    budgetPolicy: text('budget_policy').notNull().default('{}'),
    modelCatalogState: text('model_catalog_state').notNull().default('ready'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_providers_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_providers_project_default').on(table.projectId, table.isDefault),
  ],
)

export const providerModels = sqliteTable(
  'provider_models',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    contextWindow: integer('context_window'),
    pricing: text('pricing').notNull().default('{}'),
    availability: text('availability').notNull().default('available'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_provider_models_project_provider').on(table.projectId, table.providerId, table.modelId),
    uniqueIndex('idx_provider_models_unique_model').on(table.projectId, table.providerId, table.modelId),
  ],
)

export const modelDiscoveryTasks = sqliteTable(
  'model_discovery_tasks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    state: text('state').notNull().default('pending'),
    discoveredCount: integer('discovered_count'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_model_discovery_tasks_provider_created').on(table.providerId, table.createdAt, table.id)],
)

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    instructions: text('instructions'),
    // null = resolve the project default provider at session start.
    providerId: text('provider_id').references(() => providers.id),
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
    archivedAt: text('archived_at'),
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_agents_project_created').on(table.projectId, table.createdAt, table.id)],
)

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
    // JSON array of { credentialId, versionId? } vault references.
    credentialRefs: text('credential_refs').notNull().default('[]'),
    hostingMode: text('hosting_mode').notNull().default('cloud'),
    networkPolicy: text('network_policy').notNull().default('{"mode":"unrestricted"}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    packageManagerPolicy: text('package_manager_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull().default('{}'),
    runtimeConfig: text('runtime_config').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    archivedAt: text('archived_at'),
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_environments_project_created').on(table.projectId, table.createdAt, table.id)],
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
    credentialRefs: text('credential_refs').notNull().default('[]'),
    hostingMode: text('hosting_mode').notNull().default('cloud'),
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
  ],
)

export const vaults = sqliteTable(
  'vaults',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    scope: text('scope').notNull().default('project'),
    metadata: text('metadata').notNull().default('{}'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vaults_project_created').on(table.projectId, table.createdAt, table.id),
    index('idx_vaults_organization_created').on(table.organizationId, table.createdAt, table.id),
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
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    connectorBinding: text('connector_binding').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    state: text('state').notNull().default('active'),
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
    projectId: text('project_id').references(() => projects.id),
    version: integer('version').notNull(),
    provider: text('provider').notNull(),
    secretRef: text('secret_ref').notNull(),
    externalVaultPath: text('external_vault_path'),
    referenceName: text('reference_name').notNull(),
    state: text('state').notNull().default('active'),
    hasSecret: integer('has_secret', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    supersededAt: text('superseded_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('idx_vault_credential_versions_credential_version').on(table.credentialId, table.version),
    uniqueIndex('idx_vault_credential_versions_unique_credential_version').on(table.credentialId, table.version),
    index('idx_vault_credential_versions_vault_created').on(table.vaultId, table.createdAt, table.id),
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
    // JSON array of { name, credentialRef: { credentialId, versionId? } }.
    secretEnv: text('secret_env').notNull().default('[]'),
    projectId: text('project_id').references(() => projects.id),
    // Internal runtime placement columns. Never exposed via the API.
    durableObjectName: text('durable_object_name').notNull(),
    sandboxId: text('sandbox_id'),
    piRuntimeId: text('pi_runtime_id'),
    piProcessId: text('pi_process_id'),
    runtimeEndpointPath: text('runtime_endpoint_path'),
    modelProvider: text('model_provider'),
    modelConfig: text('model_config'),
    state: text('state').notNull(),
    stateReason: text('state_reason'),
    metadata: text('metadata').notNull().default('{}'),
    startedAt: text('started_at'),
    stoppedAt: text('stopped_at'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_sessions_project_state_created').on(table.projectId, table.state, table.createdAt, table.id)],
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
    delivery: text('delivery').notNull(),
    state: text('state').notNull().default('accepted'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_session_messages_session_created').on(table.sessionId, table.createdAt, table.id)],
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
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    input: text('input').notNull().default('{}'),
    relatedEventIds: text('related_event_ids').notNull().default('[]'),
    state: text('state').notNull().default('pending'),
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
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id),
    runtime: text('runtime').notNull(),
    name: text('name').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    resourceRefs: text('resource_refs').notNull().default('[]'),
    env: text('env').notNull().default('{}'),
    secretEnv: text('secret_env').notNull().default('[]'),
    intervalSeconds: integer('interval_seconds').notNull(),
    windowSeconds: integer('window_seconds').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    nextDueAt: text('next_due_at').notNull(),
    lastDispatchedAt: text('last_dispatched_at'),
    lastRunId: text('last_run_id'),
    metadata: text('metadata').notNull().default('{}'),
    createdByUserId: text('created_by_user_id'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_triggers_project_next').on(table.projectId, table.enabled, table.nextDueAt, table.id),
    index('idx_triggers_due').on(table.enabled, table.nextDueAt, table.id),
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
    state: text('state').notNull(),
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
    credentialId: text('credential_id'),
    credentialVersionId: text('credential_version_id'),
    authMode: text('auth_mode').notNull().default('bearer'),
    oidcSubject: text('oidc_subject'),
    oidcClientId: text('oidc_client_id'),
    state: text('state').notNull().default('offline'),
    currentLoad: integer('current_load').notNull().default(0),
    maxConcurrent: integer('max_concurrent').notNull().default(1),
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
    leaseId: text('lease_id'),
    type: text('type').notNull(),
    state: text('state').notNull().default('available'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    payload: text('payload').notNull(),
    result: text('result'),
    error: text('error'),
    availableAt: text('available_at').notNull(),
    leaseExpiresAt: text('lease_expires_at'),
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
    state: text('state').notNull().default('active'),
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

export const accessRules = sqliteTable(
  'access_rules',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    teamId: text('team_id'),
    effect: text('effect').notNull(),
    reason: text('reason'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_access_rules_project_provider').on(table.projectId, table.providerId, table.modelId)],
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
    // OIDC-asserted team id; null otherwise.
    scope: text('scope').notNull().default('project'),
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
    scope: text('scope').notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    limitType: text('limit_type').notNull(),
    limitValue: integer('limit_value').notNull(),
    window: text('window').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_budgets_project_enabled').on(table.projectId, table.enabled, table.scope)],
)

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
    status: text('status').notNull(),
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
  ],
)

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
    // The connector slug (e.g. "github") is the id.
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    trustLevel: text('trust_level').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    supportedAuthModes: text('supported_auth_modes').notNull().default('[]'),
    setupRequirements: text('setup_requirements').notNull().default('[]'),
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
    connectorId: text('connector_id').notNull(),
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
    connectorId: text('connector_id').notNull(),
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
    connectorId: text('connector_id').notNull(),
    toolName: text('tool_name').notNull(),
    sessionId: text('session_id').references(() => sessions.id),
    input: text('input').notNull().default('{}'),
    output: text('output'),
    state: text('state').notNull(),
    error: text('error'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_tool_calls_connection_tool_created').on(table.connectionId, table.toolName, table.createdAt, table.id),
  ],
)
