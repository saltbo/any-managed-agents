-- Relax triggers.environment_id to nullable. An unpinned trigger resolves a
-- runner-capable environment at each dispatch instead of baking one in at
-- creation. SQLite cannot drop a column NOT NULL constraint in place, so the
-- table is rebuilt; environment_id keeps its FK to environments.
PRAGMA defer_foreign_keys=on;--> statement-breakpoint
CREATE TABLE `__new_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`environment_id` text,
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
	CONSTRAINT "ck_triggers_runtime" CHECK("__new_triggers"."runtime" in ('ama','claude-code','codex','copilot'))
);--> statement-breakpoint
INSERT INTO `__new_triggers` SELECT * FROM `triggers`;--> statement-breakpoint
DROP TABLE `triggers`;--> statement-breakpoint
ALTER TABLE `__new_triggers` RENAME TO `triggers`;--> statement-breakpoint
CREATE INDEX `idx_triggers_project_next` ON `triggers` (`project_id`,`enabled`,`next_due_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_triggers_due` ON `triggers` (`enabled`,`next_due_at`,`id`);
