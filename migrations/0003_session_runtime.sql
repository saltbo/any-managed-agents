ALTER TABLE sessions ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE sessions ADD COLUMN created_by_user_id TEXT REFERENCES users(id);
ALTER TABLE sessions ADD COLUMN sandbox_id TEXT;
ALTER TABLE sessions ADD COLUMN pi_runtime_id TEXT;
ALTER TABLE sessions ADD COLUMN pi_process_id TEXT;
ALTER TABLE sessions ADD COLUMN runtime_endpoint_path TEXT;
ALTER TABLE sessions ADD COLUMN model_provider TEXT;
ALTER TABLE sessions ADD COLUMN model_config TEXT;
ALTER TABLE sessions ADD COLUMN status_reason TEXT;
ALTER TABLE sessions ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sessions ADD COLUMN started_at TEXT;
ALTER TABLE sessions ADD COLUMN stopped_at TEXT;
ALTER TABLE sessions ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  role TEXT,
  parent_event_id TEXT,
  correlation_id TEXT,
  payload TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_status ON sessions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_sandbox_id ON sessions(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_sessions_pi_runtime_id ON sessions(pi_runtime_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session_sequence ON session_events(session_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_unique_sequence ON session_events(session_id, sequence);
