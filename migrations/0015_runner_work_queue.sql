CREATE TABLE runners (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  environment_id TEXT REFERENCES environments(id),
  credential_secret_ref TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'bearer',
  status TEXT NOT NULL DEFAULT 'offline',
  current_load INTEGER NOT NULL DEFAULT 0,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runners_project_status_updated
  ON runners(project_id, status, updated_at, id);
CREATE INDEX idx_runners_project_environment
  ON runners(project_id, environment_id, status);

CREATE TABLE runner_heartbeats (
  id TEXT PRIMARY KEY NOT NULL,
  runner_id TEXT NOT NULL REFERENCES runners(id),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  current_load INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_runner_heartbeats_runner_created
  ON runner_heartbeats(runner_id, created_at);
CREATE INDEX idx_runner_heartbeats_project_created
  ON runner_heartbeats(project_id, created_at);

CREATE TABLE runner_work_items (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT REFERENCES sessions(id),
  environment_id TEXT REFERENCES environments(id),
  runner_id TEXT REFERENCES runners(id),
  lease_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload TEXT NOT NULL,
  result TEXT,
  error TEXT,
  available_at TEXT NOT NULL,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runner_work_items_project_status_available
  ON runner_work_items(project_id, status, available_at, priority, created_at);
CREATE INDEX idx_runner_work_items_session
  ON runner_work_items(session_id);
CREATE INDEX idx_runner_work_items_runner_status
  ON runner_work_items(runner_id, status);

CREATE TABLE runner_work_leases (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES runner_work_items(id),
  runner_id TEXT NOT NULL REFERENCES runners(id),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT NOT NULL,
  renewed_at TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runner_work_leases_project_status_expires
  ON runner_work_leases(project_id, status, expires_at);
CREATE INDEX idx_runner_work_leases_runner_status
  ON runner_work_leases(runner_id, status);
CREATE INDEX idx_runner_work_leases_work_item
  ON runner_work_leases(work_item_id);
