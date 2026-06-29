-- Move persisted runtime inputs from legacy secret_env/resource_refs columns to
-- the normalized env_from/volumes/volume_mounts model used by the current
-- control-plane code. Existing secret_env rows store credential ids; resolve
-- those to the canonical secret_ref persisted on vault credential versions.

PRAGMA defer_foreign_keys=on;--> statement-breakpoint

ALTER TABLE `sessions` ADD COLUMN `env_from` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `volumes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `volume_mounts` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `sessions`
SET `env_from` = COALESCE(
  (
    SELECT json_group_array(
      json_object(
        'type',
        'secret',
        'name',
        json_extract(`item`.`value`, '$.name'),
        'secretRef',
        printf(
          'ama://vaults/%s/credentials/%s/versions/%s',
          `version`.`vault_id`,
          `version`.`credential_id`,
          `version`.`id`
        )
      )
    )
    FROM json_each(`sessions`.`secret_env`) AS `item`
    JOIN `vault_credentials` AS `credential`
      ON `credential`.`id` = json_extract(`item`.`value`, '$.credentialRef.credentialId')
    JOIN `vault_credential_versions` AS `version`
      ON `version`.`id` = COALESCE(
        json_extract(`item`.`value`, '$.credentialRef.versionId'),
        `credential`.`active_version_id`
      )
    WHERE json_extract(`item`.`value`, '$.name') IS NOT NULL
      AND `version`.`id` IS NOT NULL
  ),
  '[]'
)
WHERE json_valid(`secret_env`);--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `secret_env`;--> statement-breakpoint

ALTER TABLE `triggers` ADD COLUMN `env_from` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `triggers` ADD COLUMN `volumes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `triggers` ADD COLUMN `volume_mounts` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `triggers`
SET `env_from` = COALESCE(
  (
    SELECT json_group_array(
      json_object(
        'type',
        'secret',
        'name',
        json_extract(`item`.`value`, '$.name'),
        'secretRef',
        printf(
          'ama://vaults/%s/credentials/%s/versions/%s',
          `version`.`vault_id`,
          `version`.`credential_id`,
          `version`.`id`
        )
      )
    )
    FROM json_each(`triggers`.`secret_env`) AS `item`
    JOIN `vault_credentials` AS `credential`
      ON `credential`.`id` = json_extract(`item`.`value`, '$.credentialRef.credentialId')
    JOIN `vault_credential_versions` AS `version`
      ON `version`.`id` = COALESCE(
        json_extract(`item`.`value`, '$.credentialRef.versionId'),
        `credential`.`active_version_id`
      )
    WHERE json_extract(`item`.`value`, '$.name') IS NOT NULL
      AND `version`.`id` IS NOT NULL
  ),
  '[]'
)
WHERE json_valid(`secret_env`);--> statement-breakpoint
ALTER TABLE `triggers` DROP COLUMN `secret_env`;--> statement-breakpoint

CREATE TABLE `__new_vault_credential_versions` (
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
  CONSTRAINT "ck_vault_credential_versions_state" CHECK("__new_vault_credential_versions"."state" in ('active','superseded','revoked')),
  CONSTRAINT "ck_vault_credential_versions_provider" CHECK("__new_vault_credential_versions"."provider" in ('ama'))
);--> statement-breakpoint
INSERT INTO `__new_vault_credential_versions` (
  `id`,
  `credential_id`,
  `vault_id`,
  `organization_id`,
  `project_id`,
  `version`,
  `provider`,
  `secret_ref`,
  `reference_name`,
  `state`,
  `has_secret`,
  `metadata`,
  `created_at`,
  `superseded_at`,
  `revoked_at`
)
SELECT
  `id`,
  `credential_id`,
  `vault_id`,
  `organization_id`,
  `project_id`,
  `version`,
  'ama',
  printf('ama://vaults/%s/credentials/%s/versions/%s', `vault_id`, `credential_id`, `id`),
  `reference_name`,
  `state`,
  `has_secret`,
  `metadata`,
  `created_at`,
  `superseded_at`,
  `revoked_at`
FROM `vault_credential_versions`;--> statement-breakpoint
DROP TABLE `vault_credential_versions`;--> statement-breakpoint
ALTER TABLE `__new_vault_credential_versions` RENAME TO `vault_credential_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vault_credential_versions_unique_credential_version` ON `vault_credential_versions` (`credential_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_vault_credential_versions_vault_created` ON `vault_credential_versions` (`vault_id`,`created_at`,`id`);
