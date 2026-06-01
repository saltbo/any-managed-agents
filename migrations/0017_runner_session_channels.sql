CREATE TABLE runner_session_channels (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  work_item_id TEXT NOT NULL REFERENCES runner_work_items(id),
  lease_id TEXT NOT NULL REFERENCES runner_work_leases(id),
  runner_id TEXT NOT NULL REFERENCES runners(id),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'active',
  accepted_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runner_session_channels_session_status
  ON runner_session_channels(session_id, status);
CREATE INDEX idx_runner_session_channels_lease_status
  ON runner_session_channels(lease_id, status);
CREATE INDEX idx_runner_session_channels_runner_status
  ON runner_session_channels(runner_id, status);
