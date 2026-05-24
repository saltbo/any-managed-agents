import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  flareauthSubject: text('flareauth_subject').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  flareauthOrganizationId: text('flareauth_organization_id').notNull().unique(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const memberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  roles: text('roles').notNull(),
  permissions: text('permissions').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const appSessions = sqliteTable('app_sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
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
    allowedTools: text('allowed_tools').notNull().default('[]'),
    sandboxPolicy: text('sandbox_policy').notNull().default('{}'),
    defaultEnvironmentId: text('default_environment_id'),
    metadata: text('metadata').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_agent_definitions_project_status_created').on(table.projectId, table.status, table.createdAt, table.id),
  ],
)

export const agentDefinitionVersions = sqliteTable('agent_definition_versions', {
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
  allowedTools: text('allowed_tools').notNull(),
  sandboxPolicy: text('sandbox_policy').notNull(),
  defaultEnvironmentId: text('default_environment_id'),
  metadata: text('metadata').notNull(),
  createdAt: text('created_at').notNull(),
})

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
    networkPolicy: text('network_policy').notNull().default('{}'),
    resourceLimits: text('resource_limits').notNull().default('{}'),
    runtimeImage: text('runtime_image').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    status: text('status').notNull().default('active'),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    connectorBinding: text('connector_binding').notNull().default('{}'),
    metadata: text('metadata').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    activeVersionId: text('active_version_id'),
    revokedAt: text('revoked_at'),
    revokedByUserId: text('revoked_by_user_id').references(() => users.id),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
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

export const environmentVersions = sqliteTable('environment_versions', {
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
  networkPolicy: text('network_policy').notNull(),
  resourceLimits: text('resource_limits').notNull(),
  runtimeImage: text('runtime_image').notNull(),
  metadata: text('metadata').notNull(),
  createdAt: text('created_at').notNull(),
})

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentDefinitions.id),
    organizationId: text('organization_id').references(() => organizations.id),
    createdByUserId: text('created_by_user_id').references(() => users.id),
    agentVersionId: text('agent_version_id').references(() => agentDefinitionVersions.id),
    agentSnapshot: text('agent_snapshot'),
    environmentId: text('environment_id').references(() => environments.id),
    environmentVersionId: text('environment_version_id').references(() => environmentVersions.id),
    environmentSnapshot: text('environment_snapshot'),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
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
  ],
)
