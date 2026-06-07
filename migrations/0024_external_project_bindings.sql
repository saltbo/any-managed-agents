CREATE TABLE `external_project_bindings` (
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
CREATE UNIQUE INDEX `idx_external_project_bindings_issuer_tenant` ON `external_project_bindings` (`issuer`,`external_tenant_id`);
--> statement-breakpoint
CREATE INDEX `idx_external_project_bindings_project` ON `external_project_bindings` (`project_id`);
