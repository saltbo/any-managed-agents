import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentDefinitions = sqliteTable(
  'agent_definitions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    description: text('description'),
    instructions: text('instructions'),
    provider: text('provider').notNull().default('workers-ai'),
    model: text('model').notNull(),
    systemPrompt: text('system_prompt'),
    skills: text('skills').notNull().default('[]'),
    allowedTools: text('allowed_tools').notNull().default('[]'),
    mcpConnectors: text('mcp_connectors').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    archivedAt: text('archived_at'),
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_agent_definitions_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
  ],
)

export const agentDefinitionVersions = sqliteTable(
  'agent_definition_versions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    instructions: text('instructions'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    systemPrompt: text('system_prompt'),
    skills: text('skills').notNull().default('[]'),
    allowedTools: text('allowed_tools').notNull(),
    mcpConnectors: text('mcp_connectors').notNull().default('[]'),
    metadata: text('metadata').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_agent_definition_versions_agent_id').on(table.agentId),
    uniqueIndex('idx_agent_definition_versions_agent_version').on(table.agentId, table.version),
  ],
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
    secretRefs: text('secret_refs').notNull().default('[]'),
    hostingMode: text('hosting_mode').notNull().default('cloud'),
    runtime: text('runtime').notNull().default('ama'),
    networkPolicy: text('network_policy').notNull().default('{"mode":"unrestricted"}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    packageManagerPolicy: text('package_manager_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull().default('{}'),
    runtimeConfig: text('runtime_config').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    archivedAt: text('archived_at'),
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_environments_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
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
    status: text('status').notNull().default('active'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vaults_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
    index('idx_vaults_organization_status_created').on(table.organizationId, table.status, table.createdAt, table.id),
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
    status: text('status').notNull().default('active'),
    activeVersionId: text('active_version_id'),
    revokedAt: text('revoked_at'),
    revokedByUserId: text('revoked_by_user_id'),
    revokeReason: text('revoke_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_vault_credentials_vault_status_created').on(table.vaultId, table.status, table.createdAt, table.id),
    index('idx_vault_credentials_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
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
    status: text('status').notNull().default('active'),
    hasSecret: integer('has_secret', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    supersededAt: text('superseded_at'),
    revokedAt: text('revoked_at'),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('idx_vault_credential_versions_credential_version').on(table.credentialId, table.version),
    uniqueIndex('idx_vault_credential_versions_unique_credential_version').on(table.credentialId, table.version),
    index('idx_vault_credential_versions_vault_status_created').on(
      table.vaultId,
      table.status,
      table.createdAt,
      table.id,
    ),
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
    secretRefs: text('secret_refs').notNull(),
    hostingMode: text('hosting_mode').notNull().default('cloud'),
    runtime: text('runtime').notNull().default('ama'),
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

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id),
    organizationId: text('organization_id'),
    createdByUserId: text('created_by_user_id'),
    agentVersionId: text('agent_version_id').references(() => agentDefinitionVersions.id),
    agentSnapshot: text('agent_snapshot'),
    environmentId: text('environment_id').references(() => environments.id),
    environmentVersionId: text('environment_version_id').references(() => environmentVersions.id),
    environmentSnapshot: text('environment_snapshot'),
    title: text('title'),
    resourceRefs: text('resource_refs').notNull().default('[]'),
    vaultRefs: text('vault_refs').notNull().default('[]'),
    projectId: text('project_id').references(() => projects.id),
    durableObjectName: text('durable_object_name').notNull(),
    sandboxId: text('sandbox_id'),
    piRuntimeId: text('pi_runtime_id'),
    piProcessId: text('pi_process_id'),
    runtimeEndpointPath: text('runtime_endpoint_path'),
    modelProvider: text('model_provider'),
    modelConfig: text('model_config'),
    status: text('status').notNull(),
    statusReason: text('status_reason'),
    metadata: text('metadata').notNull().default('{}'),
    startedAt: text('started_at'),
    stoppedAt: text('stopped_at'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_sessions_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
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

export const scheduledAgentTriggers = sqliteTable(
  'scheduled_agent_triggers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id),
    name: text('name').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    intervalSeconds: integer('interval_seconds').notNull(),
    windowSeconds: integer('window_seconds').notNull().default(0),
    status: text('status').notNull().default('active'),
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
    index('idx_scheduled_agent_triggers_project_status_next').on(
      table.projectId,
      table.status,
      table.nextDueAt,
      table.id,
    ),
    index('idx_scheduled_agent_triggers_due').on(table.status, table.nextDueAt, table.id),
  ],
)

export const scheduledTriggerRuns = sqliteTable(
  'scheduled_trigger_runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    triggerId: text('trigger_id')
      .notNull()
      .references(() => scheduledAgentTriggers.id),
    scheduledFor: text('scheduled_for').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
    status: text('status').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sessionId: text('session_id').references(() => sessions.id),
    correlationId: text('correlation_id').notNull(),
    errorMessage: text('error_message'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_scheduled_trigger_runs_unique_occurrence').on(table.triggerId, table.scheduledFor),
    uniqueIndex('idx_scheduled_trigger_runs_idempotency_key').on(table.idempotencyKey),
    index('idx_scheduled_trigger_runs_trigger_created').on(table.triggerId, table.createdAt, table.id),
    index('idx_scheduled_trigger_runs_project_created').on(table.projectId, table.createdAt, table.id),
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
    credentialSecretRef: text('credential_secret_ref'),
    authMode: text('auth_mode').notNull().default('bearer'),
    oidcSubject: text('oidc_subject'),
    oidcClientId: text('oidc_client_id'),
    status: text('status').notNull().default('offline'),
    currentLoad: integer('current_load').notNull().default(0),
    maxConcurrent: integer('max_concurrent').notNull().default(1),
    metadata: text('metadata').notNull().default('{}'),
    lastHeartbeatAt: text('last_heartbeat_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_runners_project_status_updated').on(table.projectId, table.status, table.updatedAt, table.id),
    index('idx_runners_project_environment').on(table.projectId, table.environmentId, table.status),
  ],
)

export const runnerHeartbeats = sqliteTable(
  'runner_heartbeats',
  {
    id: text('id').primaryKey(),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    status: text('status').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    currentLoad: integer('current_load').notNull().default(0),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_runner_heartbeats_runner_created').on(table.runnerId, table.createdAt),
    index('idx_runner_heartbeats_project_created').on(table.projectId, table.createdAt),
  ],
)

export const runnerWorkItems = sqliteTable(
  'runner_work_items',
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
    status: text('status').notNull().default('available'),
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
    index('idx_runner_work_items_project_status_available').on(
      table.projectId,
      table.status,
      table.availableAt,
      table.priority,
      table.createdAt,
    ),
    index('idx_runner_work_items_session').on(table.sessionId),
    index('idx_runner_work_items_runner_status').on(table.runnerId, table.status),
  ],
)

export const runnerWorkLeases = sqliteTable(
  'runner_work_leases',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => runnerWorkItems.id),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    status: text('status').notNull().default('active'),
    expiresAt: text('expires_at').notNull(),
    renewedAt: text('renewed_at'),
    result: text('result'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_runner_work_leases_project_status_expires').on(table.projectId, table.status, table.expiresAt),
    index('idx_runner_work_leases_runner_status').on(table.runnerId, table.status),
    index('idx_runner_work_leases_work_item').on(table.workItemId),
  ],
)

export const runnerSessionChannels = sqliteTable(
  'runner_session_channels',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => runnerWorkItems.id),
    leaseId: text('lease_id')
      .notNull()
      .references(() => runnerWorkLeases.id),
    runnerId: text('runner_id')
      .notNull()
      .references(() => runners.id),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    status: text('status').notNull().default('active'),
    acceptedAt: text('accepted_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    closedAt: text('closed_at'),
    closeReason: text('close_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_runner_session_channels_session_status').on(table.sessionId, table.status),
    index('idx_runner_session_channels_lease_status').on(table.leaseId, table.status),
    index('idx_runner_session_channels_runner_status').on(table.runnerId, table.status),
  ],
)

export const providerConfigs = sqliteTable(
  'provider_configs',
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
    status: text('status').notNull().default('active'),
    credentialSecretRef: text('credential_secret_ref'),
    metadata: text('metadata').notNull().default('{}'),
    rateLimits: text('rate_limits').notNull().default('{}'),
    budgetPolicy: text('budget_policy').notNull().default('{}'),
    modelCatalogStatus: text('model_catalog_status').notNull().default('ready'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_provider_configs_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
    index('idx_provider_configs_project_default').on(table.projectId, table.isDefault),
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
      .references(() => providerConfigs.id),
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

export const providerAccessRules = sqliteTable(
  'provider_access_rules',
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
  (table) => [index('idx_provider_access_rules_project_provider').on(table.projectId, table.providerId, table.modelId)],
)

export const governancePolicies = sqliteTable(
  'governance_policies',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    scope: text('scope').notNull().default('project'),
    providerRules: text('provider_rules').notNull().default('[]'),
    modelRules: text('model_rules').notNull().default('[]'),
    toolPolicy: text('tool_policy').notNull().default('{}'),
    mcpPolicy: text('mcp_policy').notNull().default('{}'),
    sandboxPolicy: text('sandbox_policy').notNull().default('{}'),
    budgetPolicy: text('budget_policy').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_governance_policies_project_scope').on(table.projectId, table.scope, table.updatedAt)],
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
    status: text('status').notNull().default('active'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_budgets_project_status').on(table.projectId, table.status, table.scope)],
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

export const mcpCatalogEntries = sqliteTable(
  'mcp_catalog_entries',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    trustLevel: text('trust_level').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    supportedAuthModes: text('supported_auth_modes').notNull().default('[]'),
    setupRequirements: text('setup_requirements').notNull().default('[]'),
    tools: text('tools').notNull().default('[]'),
    metadata: text('metadata').notNull().default('{}'),
    status: text('status').notNull().default('available'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_mcp_catalog_entries_connector').on(table.connectorId),
    index('idx_mcp_catalog_entries_category_trust').on(table.category, table.trustLevel),
  ],
)

export const mcpConnections = sqliteTable(
  'mcp_connections',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    connectorId: text('connector_id').notNull(),
    credentialId: text('credential_id').references(() => vaultCredentials.id),
    credentialVersionId: text('credential_version_id').references(() => vaultCredentialVersions.id),
    credentialSecretRef: text('credential_secret_ref'),
    endpointUrl: text('endpoint_url'),
    approvalMode: text('approval_mode').notNull().default('project_policy'),
    status: text('status').notNull().default('connected'),
    lastError: text('last_error'),
    metadata: text('metadata').notNull().default('{}'),
    connectedAt: text('connected_at').notNull(),
    disconnectedAt: text('disconnected_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_mcp_connections_project_connector').on(table.projectId, table.connectorId),
    index('idx_mcp_connections_project_status').on(table.projectId, table.status, table.createdAt, table.id),
  ],
)

export const mcpConnectionTools = sqliteTable(
  'mcp_connection_tools',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => mcpConnections.id),
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
    status: text('status').notNull().default('available'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_mcp_connection_tools_connection_name').on(table.connectionId, table.name),
    index('idx_mcp_connection_tools_project_connector_name').on(table.projectId, table.connectorId, table.name),
  ],
)
