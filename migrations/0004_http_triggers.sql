-- Extend triggers to support scheduled and authenticated HTTP sources.
-- Existing rows become scheduled triggers. HTTP triggers store no schedule
-- timing; HTTP runs use triggered_at as their occurrence timestamp.
PRAGMA defer_foreign_keys=on;--> statement-breakpoint
CREATE TABLE `__new_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`environment_id` text,
	`trigger_type` text DEFAULT 'scheduled' NOT NULL,
	`runtime` text NOT NULL,
	`name` text NOT NULL,
	`prompt_template` text NOT NULL,
	`resource_refs` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`env_from` text DEFAULT '[]' NOT NULL,
	`volumes` text DEFAULT '[]' NOT NULL,
	`volume_mounts` text DEFAULT '[]' NOT NULL,
	`interval_seconds` integer,
	`window_seconds` integer DEFAULT 0,
	`enabled` integer DEFAULT true NOT NULL,
	`next_due_at` text,
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
	CONSTRAINT "ck_triggers_runtime" CHECK("__new_triggers"."runtime" in ('ama','claude-code','codex','copilot')),
	CONSTRAINT "ck_triggers_type" CHECK("__new_triggers"."trigger_type" in ('scheduled','http')),
	CONSTRAINT "ck_triggers_schedule_shape" CHECK(("__new_triggers"."trigger_type" = 'scheduled' and "__new_triggers"."interval_seconds" is not null and "__new_triggers"."next_due_at" is not null) or ("__new_triggers"."trigger_type" = 'http' and "__new_triggers"."interval_seconds" is null and "__new_triggers"."next_due_at" is null))
);--> statement-breakpoint
INSERT INTO `__new_triggers` (
	`id`,
	`organization_id`,
	`project_id`,
	`agent_id`,
	`environment_id`,
	`trigger_type`,
	`runtime`,
	`name`,
	`prompt_template`,
	`resource_refs`,
	`env`,
	`env_from`,
	`volumes`,
	`volume_mounts`,
	`interval_seconds`,
	`window_seconds`,
	`enabled`,
	`next_due_at`,
	`last_dispatched_at`,
	`last_run_id`,
	`metadata`,
	`created_by_user_id`,
	`archived_at`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`organization_id`,
	`project_id`,
	`agent_id`,
	`environment_id`,
	'scheduled',
	`runtime`,
	`name`,
	`prompt_template`,
	`resource_refs`,
	`env`,
	`env_from`,
	`volumes`,
	`volume_mounts`,
	`interval_seconds`,
	`window_seconds`,
	`enabled`,
	`next_due_at`,
	`last_dispatched_at`,
	`last_run_id`,
	`metadata`,
	`created_by_user_id`,
	`archived_at`,
	`created_at`,
	`updated_at`
FROM `triggers`;--> statement-breakpoint
DROP TABLE `triggers`;--> statement-breakpoint
ALTER TABLE `__new_triggers` RENAME TO `triggers`;--> statement-breakpoint
CREATE INDEX `idx_triggers_project_next` ON `triggers` (`project_id`,`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_triggers_due` ON `triggers` (`enabled`,`next_due_at`,`id`);--> statement-breakpoint

CREATE TABLE `__new_trigger_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`scheduled_for` text,
	`heartbeat_at` text,
	`triggered_at` text NOT NULL,
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
	CONSTRAINT "ck_trigger_runs_state" CHECK("__new_trigger_runs"."state" in ('claimed','session_created','failed'))
);--> statement-breakpoint
INSERT INTO `__new_trigger_runs` (
	`id`,
	`organization_id`,
	`project_id`,
	`trigger_id`,
	`scheduled_for`,
	`heartbeat_at`,
	`triggered_at`,
	`state`,
	`idempotency_key`,
	`session_id`,
	`correlation_id`,
	`error_message`,
	`metadata`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`organization_id`,
	`project_id`,
	`trigger_id`,
	`scheduled_for`,
	`heartbeat_at`,
	`heartbeat_at`,
	`state`,
	`idempotency_key`,
	`session_id`,
	`correlation_id`,
	`error_message`,
	`metadata`,
	`created_at`,
	`updated_at`
FROM `trigger_runs`;--> statement-breakpoint
DROP TABLE `trigger_runs`;--> statement-breakpoint
ALTER TABLE `__new_trigger_runs` RENAME TO `trigger_runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_unique_occurrence` ON `trigger_runs` (`trigger_id`,`scheduled_for`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trigger_runs_idempotency_key` ON `trigger_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_trigger_created` ON `trigger_runs` (`trigger_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_trigger_runs_project_created` ON `trigger_runs` (`project_id`,`created_at`,`id`);
