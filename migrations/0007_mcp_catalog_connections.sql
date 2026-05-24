CREATE TABLE IF NOT EXISTS mcp_catalog_entries (
  id TEXT PRIMARY KEY NOT NULL,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  trust_level TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  supported_auth_modes TEXT NOT NULL DEFAULT '[]',
  setup_requirements TEXT NOT NULL DEFAULT '[]',
  tools TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  credential_id TEXT,
  credential_version_id TEXT,
  credential_secret_ref TEXT,
  endpoint_url TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'project_policy',
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT NOT NULL,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (credential_id) REFERENCES vault_credentials(id),
  FOREIGN KEY (credential_version_id) REFERENCES vault_credential_versions(id)
);

CREATE TABLE IF NOT EXISTS mcp_connection_tools (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  input_schema TEXT NOT NULL DEFAULT '{}',
  approval_mode TEXT NOT NULL DEFAULT 'project_policy',
  policy_metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES mcp_connections(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_catalog_entries_connector
ON mcp_catalog_entries(connector_id);
CREATE INDEX IF NOT EXISTS idx_mcp_catalog_entries_category_trust
ON mcp_catalog_entries(category, trust_level);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connections_project_connector
ON mcp_connections(project_id, connector_id);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_project_status
ON mcp_connections(project_id, status, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connection_tools_connection_name
ON mcp_connection_tools(connection_id, name);
CREATE INDEX IF NOT EXISTS idx_mcp_connection_tools_project_connector_name
ON mcp_connection_tools(project_id, connector_id, name);
