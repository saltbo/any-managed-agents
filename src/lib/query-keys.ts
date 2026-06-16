export const queryKeys = {
  auth: {
    user: ['auth', 'user'] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: ['projects', 'list'] as const,
  },
  agents: {
    all: ['agents'] as const,
    list: (includeArchived = false) => ['agents', 'list', { includeArchived }] as const,
    detail: (id: string) => ['agents', 'detail', id] as const,
    versions: (id: string) => ['agents', 'detail', id, 'versions'] as const,
  },
  environments: {
    all: ['environments'] as const,
    list: (includeArchived = false) => ['environments', 'list', { includeArchived }] as const,
    detail: (id: string) => ['environments', 'detail', id] as const,
    versions: (id: string) => ['environments', 'detail', id, 'versions'] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    list: (includeArchived = false) => ['sessions', 'list', { includeArchived }] as const,
    detail: (id: string) => ['sessions', 'detail', id] as const,
    events: (id: string) => ['sessions', 'detail', id, 'events'] as const,
  },
  providers: {
    all: ['providers'] as const,
    list: (includeArchived = false) => ['providers', 'list', { includeArchived }] as const,
    detail: (id: string) => ['providers', 'detail', id] as const,
    models: ['providers', 'models'] as const,
  },
  vaults: {
    all: ['vaults'] as const,
    list: (includeArchived = false) => ['vaults', 'list', { includeArchived }] as const,
    detail: (id: string) => ['vaults', 'detail', id] as const,
    credentials: (id: string, includeArchived = false) =>
      ['vaults', 'detail', id, 'credentials', { includeArchived }] as const,
    audit: (id: string) => ['vaults', 'detail', id, 'audit'] as const,
  },
  connectors: {
    all: ['connectors'] as const,
    list: (filters: Record<string, string> = {}) => ['connectors', 'list', filters] as const,
    detail: (connectorId: string) => ['connectors', 'detail', connectorId] as const,
  },
  connections: {
    all: ['connections'] as const,
    list: ['connections', 'list'] as const,
  },
  governance: {
    accessRules: ['governance', 'access-rules'] as const,
    effectivePolicy: ['governance', 'effective-policy'] as const,
  },
  usage: {
    summary: (filters: object = {}) => ['usage', 'summary', filters] as const,
  },
  audit: {
    records: (filters: object = {}) => ['audit', 'records', filters] as const,
    record: (id: string) => ['audit', 'record', id] as const,
  },
}
