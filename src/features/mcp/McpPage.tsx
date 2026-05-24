import { PageHeader } from '@/console/components'
import { useConsoleContext } from '@/features/console/console-context'
import { McpView } from './McpView'
import { useMcpActions } from './use-mcp-actions'

export function McpPage() {
  const context = useConsoleContext()
  const actions = useMcpActions()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="MCP"
        description="Review connector catalog entries, project connections, credentials, and runtime availability."
      />
      <McpView
        connectors={context.mcpConnectors}
        connections={context.mcpConnections}
        onDisconnect={actions.disconnectMcpConnection}
      />
    </div>
  )
}
