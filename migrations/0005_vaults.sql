CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS vault_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  connector_binding TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  active_version_id TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  revoke_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (vault_id) REFERENCES vaults(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (revoked_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS vault_credential_versions (
  id TEXT PRIMARY KEY NOT NULL,
  credential_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  external_vault_path TEXT,
  reference_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  has_secret INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  revoked_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (credential_id) REFERENCES vault_credentials(id),
  FOREIGN KEY (vault_id) REFERENCES vaults(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_vaults_project_status_created
ON vaults(project_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_vaults_organization_status_created
ON vaults(organization_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_vault_credentials_vault_status_created
ON vault_credentials(vault_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_vault_credentials_project_status_created
ON vault_credentials(project_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_vault_credential_versions_credential_version
ON vault_credential_versions(credential_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_credential_versions_unique_credential_version
ON vault_credential_versions(credential_id, version);

CREATE INDEX IF NOT EXISTS idx_vault_credential_versions_vault_status_created
ON vault_credential_versions(vault_id, status, created_at, id);
