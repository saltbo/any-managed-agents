// Pure connector catalog rules and data. Zero outward imports — directly
// unit-testable. The catalog is a static, read-only platform directory.

export const CONNECTOR_AVAILABILITIES = ['available', 'unavailable'] as const
export const CONNECTOR_APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

export type ConnectorAvailability = (typeof CONNECTOR_AVAILABILITIES)[number]
export type ConnectorApprovalMode = (typeof CONNECTOR_APPROVAL_MODES)[number]

export interface ConnectorCatalogTool {
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
  approvalMode: ConnectorApprovalMode
  policyMetadata: Record<string, unknown>
}

export interface ConnectorCatalogEntry {
  id: string
  name: string
  description: string
  category: string
  trustLevel: string
  capabilities: string[]
  supportedAuthModes: string[]
  setupRequirements: string[]
  tools: ConnectorCatalogTool[]
  metadata: Record<string, unknown>
  availability: ConnectorAvailability
}

// Platform catalog seed data. Rows are lazily seeded once and only ever read
// afterwards.
export const DEFAULT_CONNECTORS: readonly ConnectorCatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository, issue, and pull request tools through an MCP server.',
    category: 'development',
    trustLevel: 'verified',
    capabilities: ['repositories', 'issues', 'pull_requests'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['github_token'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository metadata and files.',
        inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
        approvalMode: 'project_policy',
        policyMetadata: { sensitivity: 'low' },
      },
    ],
    metadata: { source: 'platform_catalog' },
    availability: 'available',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project planning tools through an MCP server.',
    category: 'planning',
    trustLevel: 'verified',
    capabilities: ['issues', 'projects'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['linear_api_key'],
    tools: [
      {
        name: 'issue.read',
        description: 'Read issue metadata.',
        inputSchema: { type: 'object', properties: { issueId: { type: 'string' } }, required: ['issueId'] },
        approvalMode: 'project_policy',
        policyMetadata: { sensitivity: 'low' },
      },
    ],
    metadata: { source: 'platform_catalog' },
    availability: 'available',
  },
]

// Connector ids the platform catalog ships with, exported so governance config
// validation can recognize catalog connectors before the lazily seeded catalog
// rows exist.
export const PLATFORM_CONNECTOR_IDS: readonly string[] = DEFAULT_CONNECTORS.map((connector) => connector.id)

// Whether a connector's auth modes require a vault credential reference.
export function requiresVaultCredential(supportedAuthModes: string[]) {
  return supportedAuthModes.includes('vault_credential')
}
