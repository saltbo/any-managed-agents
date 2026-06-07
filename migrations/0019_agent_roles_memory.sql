ALTER TABLE agent_definitions ADD COLUMN role TEXT;
--> statement-breakpoint
ALTER TABLE agent_definitions ADD COLUMN capability_tags TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE agent_definitions ADD COLUMN handoff_policy TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE agent_definitions ADD COLUMN memory_policy TEXT NOT NULL DEFAULT '{"enabled":false}';
--> statement-breakpoint
ALTER TABLE agent_definition_versions ADD COLUMN role TEXT;
--> statement-breakpoint
ALTER TABLE agent_definition_versions ADD COLUMN capability_tags TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE agent_definition_versions ADD COLUMN handoff_policy TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE agent_definition_versions ADD COLUMN memory_policy TEXT NOT NULL DEFAULT '{"enabled":false}';
