ALTER TABLE agent_definitions ADD COLUMN mcp_connectors TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_definitions ADD COLUMN archived_at TEXT;
ALTER TABLE agent_definition_versions ADD COLUMN mcp_connectors TEXT NOT NULL DEFAULT '[]';

ALTER TABLE environments ADD COLUMN mcp_policy TEXT NOT NULL DEFAULT '{}';
ALTER TABLE environments ADD COLUMN package_manager_policy TEXT NOT NULL DEFAULT '{}';
ALTER TABLE environments ADD COLUMN archived_at TEXT;
ALTER TABLE environment_versions ADD COLUMN mcp_policy TEXT NOT NULL DEFAULT '{}';
ALTER TABLE environment_versions ADD COLUMN package_manager_policy TEXT NOT NULL DEFAULT '{}';
