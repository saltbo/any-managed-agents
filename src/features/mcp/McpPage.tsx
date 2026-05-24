import { McpView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function McpPage() {
  const context = useConsoleContext()
  return (
    <McpView
      connectors={context.mcpConnectors}
      connections={context.mcpConnections}
      onDisconnect={context.disconnectMcpConnection}
    />
  )
}
