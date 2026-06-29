UPDATE `vault_credentials`
SET `type` = CASE
  WHEN `type` = 'session_env_secret' AND json_valid(`metadata`) AND json_extract(`metadata`, '$.purpose') = 'agent-session'
    THEN 'ama.dev/private-key-jwk'
  WHEN `type` IN ('Opaque','kubernetes.io/basic-auth','kubernetes.io/ssh-auth','kubernetes.io/tls','ama.dev/private-key-jwk','ama.dev/oauth-token')
    THEN `type`
  ELSE 'Opaque'
END;--> statement-breakpoint

UPDATE `vault_credential_versions`
SET `metadata` = json_remove(
  json_set(
    `metadata`,
    '$.dataKeys',
    json_array(
      CASE
        WHEN (SELECT `type` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`) = 'ama.dev/private-key-jwk'
          THEN 'jwk'
        WHEN json_valid((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`))
          AND json_extract((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`), '$.purpose') = 'github-installation-token'
          THEN 'token'
        WHEN json_valid((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`))
          AND json_extract((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`), '$.purpose') = 'board-maintainer-api-key'
          THEN 'api-key'
        ELSE 'value'
      END
    ),
    '$.encryptedSecretData',
    json_object(
      CASE
        WHEN (SELECT `type` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`) = 'ama.dev/private-key-jwk'
          THEN 'jwk'
        WHEN json_valid((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`))
          AND json_extract((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`), '$.purpose') = 'github-installation-token'
          THEN 'token'
        WHEN json_valid((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`))
          AND json_extract((SELECT `metadata` FROM `vault_credentials` WHERE `vault_credentials`.`id` = `vault_credential_versions`.`credential_id`), '$.purpose') = 'board-maintainer-api-key'
          THEN 'api-key'
        ELSE 'value'
      END,
      json_extract(`metadata`, '$.encryptedSecretValue')
    )
  ),
  '$.encryptedSecretValue',
  '$.localSecretValue'
)
WHERE json_valid(`metadata`)
  AND json_type(`metadata`, '$.encryptedSecretValue') IS NOT NULL;--> statement-breakpoint

UPDATE `vault_credential_versions`
SET `metadata` = json_remove(`metadata`, '$.localSecretValue')
WHERE json_valid(`metadata`)
  AND json_type(`metadata`, '$.localSecretValue') IS NOT NULL;--> statement-breakpoint

ALTER TABLE `vault_credentials` DROP COLUMN `connector_binding`;
