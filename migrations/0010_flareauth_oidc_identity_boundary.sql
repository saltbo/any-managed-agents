PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS mcp_connection_tools;
DROP TABLE IF EXISTS mcp_connections;
DROP TABLE IF EXISTS mcp_catalog_entries;
DROP TABLE IF EXISTS audit_records;
DROP TABLE IF EXISTS usage_records;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS governance_policies;
DROP TABLE IF EXISTS provider_access_rules;
DROP TABLE IF EXISTS provider_models;
DROP TABLE IF EXISTS provider_configs;
DROP TABLE IF EXISTS session_events;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS environment_versions;
DROP TABLE IF EXISTS environments;
DROP TABLE IF EXISTS vault_credential_versions;
DROP TABLE IF EXISTS vault_credentials;
DROP TABLE IF EXISTS vaults;
DROP TABLE IF EXISTS agent_definition_versions;
DROP TABLE IF EXISTS agent_definitions;
DROP TABLE IF EXISTS app_sessions;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;
PRAGMA foreign_keys=ON;
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text,
	`instructions` text,
	`provider` text DEFAULT 'workers-ai' NOT NULL,
	`model` text NOT NULL,
	`system_prompt` text,
	`allowed_tools` text DEFAULT '[]' NOT NULL,
	`mcp_connectors` text DEFAULT '[]' NOT NULL,
	`sandbox_policy` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` text,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_definitions_project_status_created` ON `agent_definitions` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `agent_definition_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`instructions` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`system_prompt` text,
	`allowed_tools` text NOT NULL,
	`mcp_connectors` text DEFAULT '[]' NOT NULL,
	`sandbox_policy` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_definition_versions_agent_id` ON `agent_definition_versions` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_definition_versions_agent_version` ON `agent_definition_versions` (`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`packages` text DEFAULT '[]' NOT NULL,
	`variables` text DEFAULT '{}' NOT NULL,
	`secret_refs` text DEFAULT '[]' NOT NULL,
	`network_policy` text DEFAULT '{}' NOT NULL,
	`mcp_policy` text DEFAULT '{}' NOT NULL,
	`package_manager_policy` text DEFAULT '{}' NOT NULL,
	`resource_limits` text DEFAULT '{}' NOT NULL,
	`runtime_image` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` text,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_environments_project_status_created` ON `environments` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `environment_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`packages` text NOT NULL,
	`variables` text NOT NULL,
	`secret_refs` text NOT NULL,
	`network_policy` text NOT NULL,
	`mcp_policy` text DEFAULT '{}' NOT NULL,
	`package_manager_policy` text DEFAULT '{}' NOT NULL,
	`resource_limits` text NOT NULL,
	`runtime_image` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_environment_versions_environment_id` ON `environment_versions` (`environment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_environment_versions_environment_version` ON `environment_versions` (`environment_id`,`version`);--> statement-breakpoint
CREATE TABLE `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vaults_project_status_created` ON `vaults` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vaults_organization_status_created` ON `vaults` (`organization_id`,`status`,`created_at`,`id`);
CREATE TABLE `vault_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`connector_binding` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`active_version_id` text,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`revoke_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_vault_status_created` ON `vault_credentials` (`vault_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_project_status_created` ON `vault_credentials` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `vault_credential_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`vault_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`version` integer NOT NULL,
	`provider` text NOT NULL,
	`secret_ref` text NOT NULL,
	`external_vault_path` text,
	`reference_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`has_secret` integer DEFAULT true NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`superseded_at` text,
	`revoked_at` text,
	`deleted_at` text,
	FOREIGN KEY (`credential_id`) REFERENCES `vault_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vault_credential_versions_credential_version` ON `vault_credential_versions` (`credential_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_credential_versions_unique_credential_version` ON `vault_credential_versions` (`credential_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_vault_credential_versions_vault_status_created` ON `vault_credential_versions` (`vault_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`base_url` text,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`credential_secret_ref` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`rate_limits` text DEFAULT '{}' NOT NULL,
	`budget_policy` text DEFAULT '{}' NOT NULL,
	`model_catalog_status` text DEFAULT 'ready' NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_configs_project_status_created` ON `provider_configs` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_provider_configs_project_default` ON `provider_configs` (`project_id`,`is_default`);--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`context_window` integer,
	`pricing` text DEFAULT '{}' NOT NULL,
	`availability` text DEFAULT 'available' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `provider_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_models_project_provider` ON `provider_models` (`project_id`,`provider_id`,`model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_models_unique_model` ON `provider_models` (`project_id`,`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `provider_access_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`team_id` text,
	`effect` text NOT NULL,
	`reason` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_access_rules_project_provider` ON `provider_access_rules` (`project_id`,`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `governance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text DEFAULT 'project' NOT NULL,
	`provider_rules` text DEFAULT '[]' NOT NULL,
	`model_rules` text DEFAULT '[]' NOT NULL,
	`tool_policy` text DEFAULT '{}' NOT NULL,
	`mcp_policy` text DEFAULT '{}' NOT NULL,
	`sandbox_policy` text DEFAULT '{}' NOT NULL,
	`budget_policy` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_governance_policies_project_scope` ON `governance_policies` (`project_id`,`scope`,`updated_at`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`limit_type` text NOT NULL,
	`limit_value` integer NOT NULL,
	`window` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_budgets_project_status` ON `budgets` (`project_id`,`status`,`scope`);--> statement-breakpoint
CREATE TABLE `mcp_catalog_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`trust_level` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`supported_auth_modes` text DEFAULT '[]' NOT NULL,
	`setup_requirements` text DEFAULT '[]' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_catalog_entries_connector` ON `mcp_catalog_entries` (`connector_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_catalog_entries_category_trust` ON `mcp_catalog_entries` (`category`,`trust_level`);--> statement-breakpoint
CREATE TABLE `mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`credential_id` text,
	`credential_version_id` text,
	`credential_secret_ref` text,
	`endpoint_url` text,
	`approval_mode` text DEFAULT 'project_policy' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_error` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`connected_at` text NOT NULL,
	`disconnected_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `vault_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_version_id`) REFERENCES `vault_credential_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_connections_project_connector` ON `mcp_connections` (`project_id`,`connector_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_connections_project_status` ON `mcp_connections` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `mcp_connection_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`input_schema` text DEFAULT '{}' NOT NULL,
	`approval_mode` text DEFAULT 'project_policy' NOT NULL,
	`policy_metadata` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `mcp_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_connection_tools_connection_name` ON `mcp_connection_tools` (`connection_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_mcp_connection_tools_project_connector_name` ON `mcp_connection_tools` (`project_id`,`connector_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`organization_id` text,
	`created_by_user_id` text,
	`agent_version_id` text,
	`agent_snapshot` text,
	`environment_id` text,
	`environment_version_id` text,
	`environment_snapshot` text,
	`title` text,
	`resource_refs` text DEFAULT '[]' NOT NULL,
	`vault_refs` text DEFAULT '[]' NOT NULL,
	`project_id` text,
	`durable_object_name` text NOT NULL,
	`sandbox_id` text,
	`pi_runtime_id` text,
	`pi_process_id` text,
	`runtime_endpoint_path` text,
	`model_provider` text,
	`model_config` text,
	`status` text NOT NULL,
	`status_reason` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`started_at` text,
	`stopped_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_definition_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_version_id`) REFERENCES `environment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_project_status_created` ON `sessions` (`project_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`visibility` text NOT NULL,
	`role` text,
	`parent_event_id` text,
	`correlation_id` text,
	`payload` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_session_events_session_type_visibility_created` ON `session_events` (`session_id`,`type`,`visibility`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_session_events_session_sequence` ON `session_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_events_unique_sequence` ON `session_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text,
	`agent_version_id` text,
	`session_id` text,
	`session_event_id` text,
	`correlation_id` text,
	`provider_id` text,
	`provider_type` text NOT NULL,
	`model_id` text NOT NULL,
	`status` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`usage_type` text DEFAULT 'model' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_project_created` ON `usage_records` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_usage_records_project_provider_model` ON `usage_records` (`project_id`,`provider_type`,`model_id`);--> statement-breakpoint
CREATE TABLE `audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`actor_user_id` text,
	`actor_type` text DEFAULT 'user' NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`outcome` text NOT NULL,
	`request_id` text,
	`correlation_id` text,
	`session_id` text,
	`policy_category` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`before` text DEFAULT '{}' NOT NULL,
	`after` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_records_org_created` ON `audit_records` (`organization_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_audit_records_project_created` ON `audit_records` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_audit_records_action_resource` ON `audit_records` (`action`,`resource_type`,`resource_id`);--> statement-breakpoint
