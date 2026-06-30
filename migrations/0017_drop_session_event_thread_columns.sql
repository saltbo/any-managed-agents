DROP INDEX IF EXISTS `idx_session_events_session_type_visibility_created`;
CREATE INDEX IF NOT EXISTS `idx_session_events_session_type_created` ON `session_events` (`session_id`,`type`,`created_at`);
ALTER TABLE `session_events` DROP COLUMN `visibility`;
ALTER TABLE `session_events` DROP COLUMN `role`;
ALTER TABLE `session_events` DROP COLUMN `parent_event_id`;
ALTER TABLE `session_events` DROP COLUMN `correlation_id`;
