ALTER TABLE `agents` RENAME COLUMN `instructions` TO `system_prompt`;
ALTER TABLE `agent_versions` RENAME COLUMN `instructions` TO `system_prompt`;

ALTER TABLE `agents` RENAME COLUMN `tools` TO `allowed_tools`;
ALTER TABLE `agent_versions` RENAME COLUMN `tools` TO `allowed_tools`;

UPDATE `agents`
SET `system_prompt` = 'You are a managed agent.'
WHERE `system_prompt` IS NULL OR trim(`system_prompt`) = '';

UPDATE `agent_versions`
SET `system_prompt` = 'You are a managed agent.'
WHERE `system_prompt` IS NULL OR trim(`system_prompt`) = '';

UPDATE `agents`
SET `allowed_tools` = '["read","bash","edit","write","grep","find","ls","fetch","web_search"]'
WHERE `allowed_tools` IS NULL OR trim(`allowed_tools`) = '' OR trim(`allowed_tools`) = '[]';

UPDATE `agent_versions`
SET `allowed_tools` = '["read","bash","edit","write","grep","find","ls","fetch","web_search"]'
WHERE `allowed_tools` IS NULL OR trim(`allowed_tools`) = '' OR trim(`allowed_tools`) = '[]';

ALTER TABLE `agents` DROP COLUMN `role`;
ALTER TABLE `agents` DROP COLUMN `capability_tags`;
ALTER TABLE `agents` DROP COLUMN `handoff_policy`;
ALTER TABLE `agents` DROP COLUMN `metadata`;

ALTER TABLE `agent_versions` DROP COLUMN `role`;
ALTER TABLE `agent_versions` DROP COLUMN `capability_tags`;
ALTER TABLE `agent_versions` DROP COLUMN `handoff_policy`;
ALTER TABLE `agent_versions` DROP COLUMN `metadata`;
