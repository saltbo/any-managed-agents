CREATE TABLE IF NOT EXISTS agent_memories (
  agent_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_memories_project_updated ON agent_memories(project_id, updated_at, agent_id);
