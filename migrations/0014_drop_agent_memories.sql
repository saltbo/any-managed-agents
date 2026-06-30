DROP TABLE IF EXISTS `agent_memories`;
ALTER TABLE `agents` DROP COLUMN `memory_policy`;
ALTER TABLE `agent_versions` DROP COLUMN `memory_policy`;
