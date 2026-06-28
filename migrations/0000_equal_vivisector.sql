CREATE TABLE `access_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`team_id` text DEFAULT '*' NOT NULL,
	`effect` text NOT NULL,
	`reason` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_access_rules_effect" CHECK("access_rules"."effect" in ('allow','deny'))
);
--> statement-breakpoint
CREATE INDEX `idx_access_rules_project_provider` ON `access_rules` (`project_id`,`provider_id`,`model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_access_rules_unique_scope` ON `access_rules` (`project_id`,`provider_id`,`model_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `agent_memories` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_memories_project_updated` ON `agent_memories` (`project_id`,`updated_at`,`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`instructions` text,
	`provider_id` text,
	`model` text,
	`skills` text DEFAULT '[]' NOT NULL,
	`subagents` text DEFAULT '[]' NOT NULL,
	`role` text,
	`capability_tags` text DEFAULT '[]' NOT NULL,
	`handoff_policy` text DEFAULT '{}' NOT NULL,
	`memory_policy` text DEFAULT '{"enabled":false}' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`mcp_connectors` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_versions_agent_id` ON `agent_versions` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_versions_agent_version` ON `agent_versions` (`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text,
	`provider_id` text,
	`model` text,
	`skills` text DEFAULT '[]' NOT NULL,
	`subagents` text DEFAULT '[]' NOT NULL,
	`role` text,
	`capability_tags` text DEFAULT '[]' NOT NULL,
	`handoff_policy` text DEFAULT '{}' NOT NULL,
	`memory_policy` text DEFAULT '{"enabled":false}' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`mcp_connectors` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agents_project_created` ON `agents` (`project_id`,`created_at`,`id`);--> statement-breakpoint
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
	`enabled` integer DEFAULT true NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_budgets_scope" CHECK("budgets"."scope" in ('project','provider','model')),
	CONSTRAINT "ck_budgets_limit_type" CHECK("budgets"."limit_type" in ('tokens','cost_micros','sessions')),
	CONSTRAINT "ck_budgets_window" CHECK("budgets"."window" in ('day','month'))
);
--> statement-breakpoint
CREATE INDEX `idx_budgets_project_enabled` ON `budgets` (`project_id`,`enabled`,`scope`);--> statement-breakpoint
CREATE TABLE `connection_tools` (
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
	`availability` text DEFAULT 'available' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connection_tools_connection_name` ON `connection_tools` (`connection_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_connection_tools_project_connector_name` ON `connection_tools` (`project_id`,`connector_id`,`name`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`credential_id` text,
	`credential_version_id` text,
	`endpoint_url` text,
	`approval_mode` text DEFAULT 'project_policy' NOT NULL,
	`state` text DEFAULT 'connected' NOT NULL,
	`last_error` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`connected_at` text NOT NULL,
	`disconnected_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `vault_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_version_id`) REFERENCES `vault_credential_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connections_project_connector` ON `connections` (`project_id`,`connector_id`);--> statement-breakpoint
CREATE INDEX `idx_connections_project_state` ON `connections` (`project_id`,`state`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`trust_level` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`supported_auth_modes` text DEFAULT '[]' NOT NULL,
	`setup_requirements` text DEFAULT '[]' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`availability` text DEFAULT 'available' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_connectors_category_trust` ON `connectors` (`category`,`trust_level`);--> statement-breakpoint
CREATE TABLE `environment_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`packages` text NOT NULL,
	`variables` text NOT NULL,
	`credential_refs` text DEFAULT '[]' NOT NULL,
	`hosting_mode` text DEFAULT 'cloud' NOT NULL,
	`network_policy` text DEFAULT '{"mode":"unrestricted"}' NOT NULL,
	`mcp_policy` text DEFAULT '{}' NOT NULL,
	`package_manager_policy` text DEFAULT '{}' NOT NULL,
	`resource_limits` text NOT NULL,
	`runtime_config` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_environment_versions_hosting_mode" CHECK("environment_versions"."hosting_mode" in ('cloud','self_hosted'))
);
--> statement-breakpoint
CREATE INDEX `idx_environment_versions_environment_id` ON `environment_versions` (`environment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_environment_versions_environment_version` ON `environment_versions` (`environment_id`,`version`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`packages` text DEFAULT '[]' NOT NULL,
	`variables` text DEFAULT '{}' NOT NULL,
	`credential_refs` text DEFAULT '[]' NOT NULL,
	`hosting_mode` text DEFAULT 'cloud' NOT NULL,
	`network_policy` text DEFAULT '{"mode":"unrestricted"}' NOT NULL,
	`mcp_policy` text DEFAULT '{}' NOT NULL,
	`package_manager_policy` text DEFAULT '{}' NOT NULL,
	`resource_limits` text DEFAULT '{}' NOT NULL,
	`runtime_config` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_environments_hosting_mode" CHECK("environments"."hosting_mode" in ('cloud','self_hosted'))
);
--> statement-breakpoint
CREATE INDEX `idx_environments_project_created` ON `environments` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `federated_tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`external_tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_federated_tenants_issuer_tenant` ON `federated_tenants` (`issuer`,`external_tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_federated_tenants_project` ON `federated_tenants` (`project_id`);--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`runner_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`renewed_at` text,
	`resume_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_leases_state" CHECK("leases"."state" in ('active','completed','failed','cancelled','expired','interrupted'))
);
--> statement-breakpoint
CREATE INDEX `idx_leases_project_state_expires` ON `leases` (`project_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_leases_runner_state` ON `leases` (`runner_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_leases_work_item` ON `leases` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `model_discovery_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`discovered_count` integer,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_model_discovery_tasks_state" CHECK("model_discovery_tasks"."state" in ('pending','running','succeeded','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_model_discovery_tasks_provider_created` ON `model_discovery_tasks` (`provider_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text DEFAULT 'project' NOT NULL,
	`team_id` text,
	`tool_policy` text DEFAULT '{}' NOT NULL,
	`mcp_policy` text DEFAULT '{}' NOT NULL,
	`sandbox_policy` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_policies_scope" CHECK("policies"."scope" in ('organization','team','project'))
);
--> statement-breakpoint
CREATE INDEX `idx_policies_project_scope` ON `policies` (`project_id`,`scope`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_policies_org_scope` ON `policies` (`organization_id`,`scope`,`team_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_policies_unique_scope` ON `policies` (`project_id`,`scope`,`team_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
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
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_models_unique_model` ON `provider_models` (`project_id`,`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`base_url` text,
	`is_default` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`credential_id` text,
	`credential_version_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`rate_limits` text DEFAULT '{}' NOT NULL,
	`budget_policy` text DEFAULT '{}' NOT NULL,
	`model_catalog_state` text DEFAULT 'ready' NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_providers_project_created` ON `providers` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_providers_project_default` ON `providers` (`project_id`,`is_default`);--> statement-breakpoint
CREATE TABLE `runners` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`environment_id` text,
	`credential_id` text,
	`credential_version_id` text,
	`auth_mode` text DEFAULT 'bearer' NOT NULL,
	`oidc_subject` text,
	`oidc_client_id` text,
	`state` text DEFAULT 'offline' NOT NULL,
	`current_load` integer DEFAULT 0 NOT NULL,
	`max_concurrent` integer DEFAULT 1 NOT NULL,
	`runtime_usage` text DEFAULT '[]' NOT NULL,
	`runtime_inventory` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`last_heartbeat_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_runners_state" CHECK("runners"."state" in ('active','draining','disabled','offline')),
	CONSTRAINT "ck_runners_auth_mode" CHECK("runners"."auth_mode" in ('bearer','mtls','oidc','federated'))
);
--> statement-breakpoint
CREATE INDEX `idx_runners_project_state_updated` ON `runners` (`project_id`,`state`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_runners_project_environment` ON `runners` (`project_id`,`environment_id`,`state`);--> statement-breakpoint
CREATE TABLE `session_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`related_event_ids` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`result` text,
	`decided_by_user_id` text,
	`decided_at` text,
	`requested_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_session_approvals_state" CHECK("session_approvals"."state" in ('pending','approved','denied'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_approvals_session_tool_call` ON `session_approvals` (`session_id`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `idx_session_approvals_session_state` ON `session_approvals` (`session_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`runner_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`accepted_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`closed_at` text,
	`close_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_session_channels_session_state` ON `session_channels` (`session_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_session_channels_lease_state` ON `session_channels` (`lease_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_session_channels_runner_state` ON `session_channels` (`runner_id`,`state`);--> statement-breakpoint
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
CREATE TABLE `session_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`type` text DEFAULT 'prompt' NOT NULL,
	`content` text NOT NULL,
	`delivery` text NOT NULL,
	`state` text DEFAULT 'accepted' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_session_messages_delivery" CHECK("session_messages"."delivery" in ('live','queued')),
	CONSTRAINT "ck_session_messages_state" CHECK("session_messages"."state" in ('accepted','delivered','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_session_messages_session_created` ON `session_messages` (`session_id`,`created_at`,`id`);--> statement-breakpoint
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
	`env` text DEFAULT '{}' NOT NULL,
	`env_from` text DEFAULT '[]' NOT NULL,
	`volumes` text DEFAULT '[]' NOT NULL,
	`volume_mounts` text DEFAULT '[]' NOT NULL,
	`project_id` text NOT NULL,
	`durable_object_name` text NOT NULL,
	`sandbox_id` text,
	`pi_runtime_id` text,
	`pi_process_id` text,
	`runtime_endpoint_path` text,
	`model_provider` text,
	`model_config` text,
	`state` text NOT NULL,
	`state_reason` text,
	`active_turn_id` text,
	`turn_lease_expires_at` text,
	`continuation_depth` integer DEFAULT 0 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`started_at` text,
	`stopped_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_version_id`) REFERENCES `agent_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_version_id`) REFERENCES `environment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_sessions_state" CHECK("sessions"."state" in ('pending','running','idle','stopped','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_project_state_created` ON `sessions` (`project_id`,`state`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_sandbox` ON `sessions` (`sandbox_id`);--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`session_id` text,
	`input` text DEFAULT '{}' NOT NULL,
	`output` text,
	`state` text NOT NULL,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_tool_calls_state" CHECK("tool_calls"."state" in ('success','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_tool_calls_connection_tool_created` ON `tool_calls` (`connection_id`,`tool_name`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_tool_calls_session_created` ON `tool_calls` (`session_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `trigger_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	`state` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`session_id` text,
	`correlation_id` text NOT NULL,
	`error_message` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_trigger_runs_state" CHECK("trigger_runs"."state" in ('claimed','session_created','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_unique_occurrence` ON `trigger_runs` (`trigger_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_idempotency_key` ON `trigger_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_trigger_created` ON `trigger_runs` (`trigger_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_project_created` ON `trigger_runs` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`runtime` text NOT NULL,
	`name` text NOT NULL,
	`prompt_template` text NOT NULL,
	`resource_refs` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`env_from` text DEFAULT '[]' NOT NULL,
	`volumes` text DEFAULT '[]' NOT NULL,
	`volume_mounts` text DEFAULT '[]' NOT NULL,
	`interval_seconds` integer NOT NULL,
	`window_seconds` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_due_at` text NOT NULL,
	`last_dispatched_at` text,
	`last_run_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_triggers_runtime" CHECK("triggers"."runtime" in ('ama','claude-code','codex','copilot'))
);
--> statement-breakpoint
CREATE INDEX `idx_triggers_project_next` ON `triggers` (`project_id`,`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_triggers_due` ON `triggers` (`enabled`,`next_due_at`,`id`);--> statement-breakpoint
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
	`state` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`usage_type` text DEFAULT 'model' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_usage_records_state" CHECK("usage_records"."state" in ('success','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_project_created` ON `usage_records` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_usage_records_project_provider_model` ON `usage_records` (`project_id`,`provider_type`,`model_id`);--> statement-breakpoint
CREATE TABLE `vault_credential_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`vault_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`version` integer NOT NULL,
	`provider` text NOT NULL,
	`secret_ref` text NOT NULL,
	`reference_name` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`has_secret` integer DEFAULT true NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`superseded_at` text,
	`revoked_at` text,
	FOREIGN KEY (`credential_id`) REFERENCES `vault_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_vault_credential_versions_state" CHECK("vault_credential_versions"."state" in ('active','superseded','revoked')),
	CONSTRAINT "ck_vault_credential_versions_provider" CHECK("vault_credential_versions"."provider" in ('ama'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_credential_versions_unique_credential_version` ON `vault_credential_versions` (`credential_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_vault_credential_versions_vault_created` ON `vault_credential_versions` (`vault_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `vault_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`connector_binding` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`active_version_id` text,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`revoke_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_vault_credentials_state" CHECK("vault_credentials"."state" in ('active','revoked'))
);
--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_vault_created` ON `vault_credentials` (`vault_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_project_created` ON `vault_credentials` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_vaults_scope" CHECK("vaults"."scope" in ('project','organization'))
);
--> statement-breakpoint
CREATE INDEX `idx_vaults_project_created` ON `vaults` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vaults_organization_created` ON `vaults` (`organization_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`environment_id` text,
	`runner_id` text,
	`lease_id` text,
	`type` text NOT NULL,
	`state` text DEFAULT 'available' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`error` text,
	`available_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_work_items_state" CHECK("work_items"."state" in ('available','leased','succeeded','failed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_work_items_project_state_available` ON `work_items` (`project_id`,`state`,`available_at`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_work_items_session` ON `work_items` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_work_items_runner_state` ON `work_items` (`runner_id`,`state`);
