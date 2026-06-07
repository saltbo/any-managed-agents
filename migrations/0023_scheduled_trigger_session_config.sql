ALTER TABLE scheduled_agent_triggers ADD COLUMN resource_refs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE scheduled_agent_triggers ADD COLUMN runtime_env TEXT NOT NULL DEFAULT '{}';
ALTER TABLE scheduled_agent_triggers ADD COLUMN runtime_secret_env TEXT NOT NULL DEFAULT '[]';
