-- De-tenant the provider catalog: providers/provider_models become a GLOBAL
-- vendor catalog (populated by the scheduled discovery refresh), model_discovery
-- tasks are removed. The old rows are discovery-derived, so they are dropped and
-- repopulated; agents.provider_id keeps its FK to providers (values are re-pinned
-- to the new vendor rows). FK enforcement is disabled for the rebuild.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE `model_discovery_tasks`;--> statement-breakpoint
DROP TABLE `provider_models`;--> statement-breakpoint
DROP TABLE `providers`;--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`model_catalog_state` text DEFAULT 'ready' NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_providers_slug` ON `providers` (`slug`);--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_models_unique_model` ON `provider_models` (`provider_id`,`model_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
