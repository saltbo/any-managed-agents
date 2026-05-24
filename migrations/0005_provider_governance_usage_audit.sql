CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  credential_secret_ref TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  rate_limits TEXT NOT NULL DEFAULT '{}',
  budget_policy TEXT NOT NULL DEFAULT '{}',
  model_catalog_status TEXT NOT NULL DEFAULT 'ready',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS provider_models (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  context_window INTEGER,
  pricing TEXT NOT NULL DEFAULT '{}',
  availability TEXT NOT NULL DEFAULT 'available',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (provider_id) REFERENCES provider_configs(id)
);

CREATE TABLE IF NOT EXISTS provider_access_rules (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  team_id TEXT,
  effect TEXT NOT NULL,
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS governance_policies (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project',
  provider_rules TEXT NOT NULL DEFAULT '[]',
  model_rules TEXT NOT NULL DEFAULT '[]',
  tool_policy TEXT NOT NULL DEFAULT '{}',
  mcp_policy TEXT NOT NULL DEFAULT '{}',
  sandbox_policy TEXT NOT NULL DEFAULT '{}',
  budget_policy TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  limit_type TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  window TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  agent_version_id TEXT,
  session_id TEXT,
  session_event_id TEXT,
  correlation_id TEXT,
  provider_id TEXT,
  provider_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  usage_type TEXT NOT NULL DEFAULT 'model',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT,
  actor_user_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  request_id TEXT,
  correlation_id TEXT,
  session_id TEXT,
  policy_category TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  before TEXT NOT NULL DEFAULT '{}',
  after TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_provider_configs_project_status_created
ON provider_configs(project_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_provider_configs_project_default
ON provider_configs(project_id, is_default);
CREATE INDEX IF NOT EXISTS idx_provider_models_project_provider
ON provider_models(project_id, provider_id, model_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_unique_model
ON provider_models(project_id, provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_provider_access_rules_project_provider
ON provider_access_rules(project_id, provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_governance_policies_project_scope
ON governance_policies(project_id, scope, updated_at);
CREATE INDEX IF NOT EXISTS idx_budgets_project_status
ON budgets(project_id, status, scope);
CREATE INDEX IF NOT EXISTS idx_usage_records_project_created
ON usage_records(project_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_usage_records_project_provider_model
ON usage_records(project_id, provider_type, model_id);
CREATE INDEX IF NOT EXISTS idx_audit_records_org_created
ON audit_records(organization_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_audit_records_project_created
ON audit_records(project_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_audit_records_action_resource
ON audit_records(action, resource_type, resource_id);
