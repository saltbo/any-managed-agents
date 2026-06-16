-- Remove the access-rules (provider/model allow-deny) governance feature. The
-- access_rules table is a leaf (only a child of projects; nothing references it),
-- so it drops cleanly. Budgets and the tool/MCP/sandbox policies are untouched.
DROP TABLE `access_rules`;
