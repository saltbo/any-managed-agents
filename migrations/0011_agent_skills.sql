ALTER TABLE agent_definitions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE agent_definition_versions ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
