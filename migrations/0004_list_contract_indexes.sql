CREATE INDEX IF NOT EXISTS idx_agent_definitions_project_status_created
ON agent_definitions(project_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_environments_project_status_created
ON environments(project_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_sessions_project_status_created
ON sessions(project_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_session_events_session_type_visibility_created
ON session_events(session_id, type, visibility, created_at);
