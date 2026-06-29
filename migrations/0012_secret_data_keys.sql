UPDATE `vault_credentials`
SET `type` = CASE
  WHEN `type` = 'session_env_secret' AND json_valid(`metadata`) AND json_extract(`metadata`, '$.purpose') = 'agent-session'
    THEN 'ama.dev/private-key-jwk'
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
