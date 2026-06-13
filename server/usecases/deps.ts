import type { AgentRepo, AuditPort, PolicyPort } from './ports'

// Aggregates every port a usecase may reach for. Constructed once per request
// by composition.createDeps and handed to routes via Hono context.
export interface Deps {
  agents: AgentRepo
  audit: AuditPort
  policy: PolicyPort
}
