CREATE TABLE `scheduled_agent_triggers` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `environment_id` text NOT NULL,
  `name` text NOT NULL,
  `prompt_template` text NOT NULL,
  `interval_seconds` integer NOT NULL,
  `window_seconds` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `next_due_at` text NOT NULL,
  `last_dispatched_at` text,
  `last_run_id` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_by_user_id` text,
  `archived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`agent_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `idx_scheduled_agent_triggers_project_status_next`
  ON `scheduled_agent_triggers` (`project_id`, `status`, `next_due_at`, `id`);

CREATE INDEX `idx_scheduled_agent_triggers_due`
  ON `scheduled_agent_triggers` (`status`, `next_due_at`, `id`);

CREATE TABLE `scheduled_trigger_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `trigger_id` text NOT NULL,
  `scheduled_for` text NOT NULL,
  `heartbeat_at` text NOT NULL,
  `status` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `session_id` text,
  `correlation_id` text NOT NULL,
  `error_message` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`trigger_id`) REFERENCES `scheduled_agent_triggers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `idx_scheduled_trigger_runs_unique_occurrence`
  ON `scheduled_trigger_runs` (`trigger_id`, `scheduled_for`);

CREATE UNIQUE INDEX `idx_scheduled_trigger_runs_idempotency_key`
  ON `scheduled_trigger_runs` (`idempotency_key`);

CREATE INDEX `idx_scheduled_trigger_runs_trigger_created`
  ON `scheduled_trigger_runs` (`trigger_id`, `created_at`, `id`);

CREATE INDEX `idx_scheduled_trigger_runs_project_created`
  ON `scheduled_trigger_runs` (`project_id`, `created_at`, `id`);
