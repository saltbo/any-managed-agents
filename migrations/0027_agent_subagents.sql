ALTER TABLE agent_definitions ADD COLUMN subagents TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE agent_definition_versions ADD COLUMN subagents TEXT NOT NULL DEFAULT '[]';
