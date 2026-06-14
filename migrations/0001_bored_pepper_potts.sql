ALTER TABLE `sessions` ADD `active_turn_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `turn_lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `continuation_depth` integer DEFAULT 0 NOT NULL;