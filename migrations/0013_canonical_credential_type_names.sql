PRAGMA defer_foreign_keys=on;--> statement-breakpoint

UPDATE `vault_credentials`
SET `type` = CASE
  WHEN `type` = 'Opaque'
    THEN 'opaque'
  WHEN `type` = 'kubernetes.io/basic-auth'
    THEN 'ama.dev/basic-auth'
  WHEN `type` = 'kubernetes.io/ssh-auth'
    THEN 'ama.dev/ssh-auth'
  WHEN `type` = 'kubernetes.io/tls'
    THEN 'ama.dev/tls'
  WHEN `type` = 'ama.dev/private-key-jwk'
    THEN 'ama.dev/private-key-jwk'
  WHEN `type` = 'ama.dev/oauth-token'
    THEN 'ama.dev/oauth-token'
  WHEN `type` IN ('opaque','ama.dev/basic-auth','ama.dev/ssh-auth','ama.dev/tls','ama.dev/private-key-jwk','ama.dev/oauth-token')
    THEN `type`
  ELSE 'opaque'
END;--> statement-breakpoint

CREATE TABLE `__new_vault_credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `vault_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `name` text NOT NULL,
  `type` text NOT NULL,
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
  CONSTRAINT "ck_vault_credentials_state" CHECK("__new_vault_credentials"."state" in ('active','revoked')),
  CONSTRAINT "ck_vault_credentials_type" CHECK("__new_vault_credentials"."type" in ('opaque','ama.dev/basic-auth','ama.dev/ssh-auth','ama.dev/tls','ama.dev/private-key-jwk','ama.dev/oauth-token'))
);--> statement-breakpoint

INSERT INTO `__new_vault_credentials` (
  `id`,
  `vault_id`,
  `organization_id`,
  `project_id`,
  `name`,
  `type`,
  `metadata`,
  `state`,
  `active_version_id`,
  `revoked_at`,
  `revoked_by_user_id`,
  `revoke_reason`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `vault_id`,
  `organization_id`,
  `project_id`,
  `name`,
  `type`,
  `metadata`,
  `state`,
  `active_version_id`,
  `revoked_at`,
  `revoked_by_user_id`,
  `revoke_reason`,
  `created_at`,
  `updated_at`
FROM `vault_credentials`;--> statement-breakpoint

DROP TABLE `vault_credentials`;--> statement-breakpoint
ALTER TABLE `__new_vault_credentials` RENAME TO `vault_credentials`;--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_vault_created` ON `vault_credentials` (`vault_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_vault_credentials_project_created` ON `vault_credentials` (`project_id`,`created_at`,`id`);
