PRAGMA defer_foreign_keys=ON;

CREATE TABLE agent_definitions_new (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  provider TEXT NOT NULL DEFAULT 'workers-ai',
  model TEXT,
  system_prompt TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  role TEXT,
  capability_tags TEXT NOT NULL DEFAULT '[]',
  handoff_policy TEXT NOT NULL DEFAULT '{}',
  memory_policy TEXT NOT NULL DEFAULT '{"enabled":false}',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  mcp_connectors TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  archived_at TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO agent_definitions_new (
  id,
  project_id,
  name,
  description,
  instructions,
  provider,
  model,
  system_prompt,
  skills,
  role,
  capability_tags,
  handoff_policy,
  memory_policy,
  allowed_tools,
  mcp_connectors,
  metadata,
  status,
  archived_at,
  current_version_id,
  created_at,
  updated_at
)
SELECT
  id,
  project_id,
  name,
  description,
  instructions,
  provider,
  model,
  system_prompt,
  skills,
  role,
  capability_tags,
  handoff_policy,
  memory_policy,
  allowed_tools,
  mcp_connectors,
  metadata,
  status,
  archived_at,
  current_version_id,
  created_at,
  updated_at
FROM agent_definitions;

CREATE TABLE agent_definition_versions_new (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agent_definitions(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  instructions TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  system_prompt TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  role TEXT,
  capability_tags TEXT NOT NULL DEFAULT '[]',
  handoff_policy TEXT NOT NULL DEFAULT '{}',
  memory_policy TEXT NOT NULL DEFAULT '{"enabled":false}',
  allowed_tools TEXT NOT NULL,
  mcp_connectors TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO agent_definition_versions_new (
  id,
  agent_id,
  project_id,
  version,
  instructions,
  provider,
  model,
  system_prompt,
  skills,
  role,
  capability_tags,
  handoff_policy,
  memory_policy,
  allowed_tools,
  mcp_connectors,
  metadata,
  created_at
)
SELECT
  id,
  agent_id,
  project_id,
  version,
  instructions,
  provider,
  model,
  system_prompt,
  skills,
  role,
  capability_tags,
  handoff_policy,
  memory_policy,
  allowed_tools,
  mcp_connectors,
  metadata,
  created_at
FROM agent_definition_versions;

DROP TABLE agent_definition_versions;
DROP TABLE agent_definitions;
ALTER TABLE agent_definitions_new RENAME TO agent_definitions;
ALTER TABLE agent_definition_versions_new RENAME TO agent_definition_versions;

CREATE INDEX IF NOT EXISTS idx_agent_definitions_project_id ON agent_definitions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_project_status_created
  ON agent_definitions(project_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_agent_definition_versions_agent_id ON agent_definition_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_definition_versions_project_id ON agent_definition_versions(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_definition_versions_agent_version
  ON agent_definition_versions(agent_id, version);
