ALTER TABLE agent_definitions ADD COLUMN external_product TEXT;
ALTER TABLE agent_definitions ADD COLUMN external_kind TEXT;
ALTER TABLE agent_definitions ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_agent_definitions_external_ref
  ON agent_definitions(project_id, external_product, external_kind, external_id);

ALTER TABLE environments ADD COLUMN external_product TEXT;
ALTER TABLE environments ADD COLUMN external_kind TEXT;
ALTER TABLE environments ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_environments_external_ref
  ON environments(project_id, external_product, external_kind, external_id);

ALTER TABLE sessions ADD COLUMN external_product TEXT;
ALTER TABLE sessions ADD COLUMN external_kind TEXT;
ALTER TABLE sessions ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_sessions_external_ref
  ON sessions(project_id, external_product, external_kind, external_id);
