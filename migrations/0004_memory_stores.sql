CREATE TABLE `memory_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_memory_stores_project_created` ON `memory_stores` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `memory_store_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `memory_stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_store_memories_store_path` ON `memory_store_memories` (`store_id`,`path`);--> statement-breakpoint
CREATE INDEX `idx_memory_store_memories_store_created` ON `memory_store_memories` (`store_id`,`created_at`,`id`);
