import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { useConsoleContext } from '@/features/console/console-context'
import { McpView } from './McpView'
import { useMcpActions } from './use-mcp-actions'

export function McpPage() {
  const context = useConsoleContext()
  const actions = useMcpActions()
  const connectors = useClientPagination(context.mcpConnectors)
  const connections = useClientPagination(context.mcpConnections)
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
