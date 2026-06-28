-- Correct rows migrated by the first runtime-input backfill to the canonical
-- ama:// vault secret reference format.

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
        'ama://vaults/' || `version`.`vault_id` || '/credentials/' || `version`.`credential_id` || '/versions/' || `version`.`id`
      )
    )
    FROM json_each(`sessions`.`env_from`) AS `item`
    JOIN `vault_credential_versions` AS `version`
      ON `version`.`secret_ref` = json_extract(`item`.`value`, '$.secretRef')
    WHERE json_extract(`item`.`value`, '$.name') IS NOT NULL
      AND `version`.`id` IS NOT NULL
  ),
  `env_from`
)
WHERE `env_from` LIKE '%ama-managed:%'
  AND json_valid(`env_from`);--> statement-breakpoint

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
        'ama://vaults/' || `version`.`vault_id` || '/credentials/' || `version`.`credential_id` || '/versions/' || `version`.`id`
      )
    )
    FROM json_each(`triggers`.`env_from`) AS `item`
    JOIN `vault_credential_versions` AS `version`
      ON `version`.`secret_ref` = json_extract(`item`.`value`, '$.secretRef')
    WHERE json_extract(`item`.`value`, '$.name') IS NOT NULL
      AND `version`.`id` IS NOT NULL
  ),
  `env_from`
)
WHERE `env_from` LIKE '%ama-managed:%'
  AND json_valid(`env_from`);--> statement-breakpoint

UPDATE `vault_credential_versions`
SET `secret_ref` = 'ama://vaults/' || `vault_id` || '/credentials/' || `credential_id` || '/versions/' || `id`
WHERE `secret_ref` NOT LIKE 'ama://vaults/%';
