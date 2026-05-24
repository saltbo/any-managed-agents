ALTER TABLE agent_definitions ADD COLUMN instructions TEXT;
ALTER TABLE agent_definitions ADD COLUMN provider TEXT NOT NULL DEFAULT 'workers-ai';
ALTER TABLE agent_definitions ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_definitions ADD COLUMN sandbox_policy TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agent_definitions ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agent_definitions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE agent_definitions ADD COLUMN current_version_id TEXT;

CREATE TABLE IF NOT EXISTS agent_definition_versions (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  instructions TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT,
  allowed_tools TEXT NOT NULL,
  sandbox_policy TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  packages TEXT NOT NULL DEFAULT '[]',
  variables TEXT NOT NULL DEFAULT '{}',
  secret_refs TEXT NOT NULL DEFAULT '[]',
  network_policy TEXT NOT NULL DEFAULT '{}',
  resource_limits TEXT NOT NULL DEFAULT '{}',
  runtime_image TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS environment_versions (
  id TEXT PRIMARY KEY NOT NULL,
  environment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  packages TEXT NOT NULL,
  variables TEXT NOT NULL,
  secret_refs TEXT NOT NULL,
  network_policy TEXT NOT NULL,
  resource_limits TEXT NOT NULL,
  runtime_image TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

UPDATE agent_definitions
SET instructions = COALESCE(instructions, system_prompt)
WHERE project_id IS NOT NULL
  AND instructions IS NULL;

INSERT INTO agent_definition_versions (
  id,
  agent_id,
  project_id,
  version,
  instructions,
  provider,
  model,
  system_prompt,
  allowed_tools,
  sandbox_policy,
  metadata,
  created_at
)
SELECT
  'agentver_migrated_' || id,
  id,
  project_id,
  1,
  system_prompt,
  provider,
  model,
  system_prompt,
  allowed_tools,
  sandbox_policy,
  metadata,
  created_at
FROM agent_definitions
WHERE project_id IS NOT NULL
  AND current_version_id IS NULL;

UPDATE agent_definitions
SET current_version_id = 'agentver_migrated_' || id
WHERE project_id IS NOT NULL
  AND current_version_id IS NULL;

ALTER TABLE sessions ADD COLUMN agent_version_id TEXT REFERENCES agent_definition_versions(id);
ALTER TABLE sessions ADD COLUMN agent_snapshot TEXT;
ALTER TABLE sessions ADD COLUMN environment_id TEXT REFERENCES environments(id);
ALTER TABLE sessions ADD COLUMN environment_version_id TEXT REFERENCES environment_versions(id);
ALTER TABLE sessions ADD COLUMN environment_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_definition_versions_agent_id ON agent_definition_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_definition_versions_project_id ON agent_definition_versions(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_definition_versions_agent_version ON agent_definition_versions(agent_id, version);
CREATE INDEX IF NOT EXISTS idx_environments_project_id ON environments(project_id);
CREATE INDEX IF NOT EXISTS idx_environment_versions_environment_id ON environment_versions(environment_id);
CREATE INDEX IF NOT EXISTS idx_environment_versions_project_id ON environment_versions(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_environment_versions_environment_version ON environment_versions(environment_id, version);
