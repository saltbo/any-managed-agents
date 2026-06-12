ALTER TABLE governance_policies ADD COLUMN team_id TEXT;
--> statement-breakpoint
CREATE INDEX idx_governance_policies_org_scope ON governance_policies (organization_id, scope, team_id, updated_at);
