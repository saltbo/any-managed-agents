import { useQuery } from '@tanstack/react-query'
import { EmptyState, PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { McpView } from './McpView'
import { useMcpActions } from './use-mcp-actions'

export function McpPage() {
  const actions = useMcpActions()
  const connectorsQuery = useQuery({
    queryKey: queryKeys.mcp.connectors,
    queryFn: api.listMcpConnectors,
  })
  const connectionsQuery = useQuery({
    queryKey: queryKeys.mcp.connections,
    queryFn: api.listMcpConnections,
  })
  const connectors = useClientPagination(connectorsQuery.data?.data ?? [])
  const connections = useClientPagination(connectionsQuery.data?.data ?? [])
  const error = connectorsQuery.error ?? connectionsQuery.error
  if (error) {
    return <EmptyState title="MCP unavailable" body={error instanceof Error ? error.message : String(error)} />
  }
  if (connectorsQuery.isPending || connectionsQuery.isPending) {
    return <EmptyState title="Loading MCP" body="Reading connector catalog and project connections." />
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="MCP"
        description="Review connector catalog entries, project connections, credentials, and runtime availability."
      />
      <McpView
        connectors={connectors.items}
        connectorPagination={connectors}
        connections={connections.items}
        connectionPagination={connections}
        onDisconnect={actions.disconnectMcpConnection}
      />
    </div>
  )
}
