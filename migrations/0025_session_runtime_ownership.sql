ALTER TABLE scheduled_agent_triggers ADD COLUMN runtime TEXT NOT NULL DEFAULT 'ama';

ALTER TABLE environments DROP COLUMN runtime;
ALTER TABLE environment_versions DROP COLUMN runtime;
