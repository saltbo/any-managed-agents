import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, StatusBadge, TableEmpty, TablePagination, TableSurface } from '@/console/components'
import { stringifyJson } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { McpConnection, McpConnector } from '@/lib/api'

export function McpView({
  connectors,
  connectorPagination,
  connections,
  connectionPagination,
  onDisconnect,
}: {
  connectors: McpConnector[]
  connectorPagination: ClientPagination<McpConnector>
  connections: McpConnection[]
  connectionPagination: ClientPagination<McpConnection>
  onDisconnect: (id: string) => void
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP connectors</CardTitle>
          <CardDescription>Catalog status, governance result, and connection state.</CardDescription>
        </CardHeader>
        <CardContent>
          <TableSurface
            viewportRef={connectorPagination.viewportRef}
            footer={<TablePagination pagination={connectorPagination} />}
          >
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.length === 0 ? (
                <TableEmpty colSpan={4}>No MCP connectors are discoverable yet.</TableEmpty>
              ) : (
                connectors.map((connector) => (
                  <TableRow key={connector.id}>
                    <TableCell className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{connector.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{connector.connectorId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={connector.policyStatus} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={connector.connectionStatus} />
                    </TableCell>
                    <TableCell className="max-w-80 truncate">
                      {connector.tools.map((tool) => tool.name).join(', ') || 'None'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </TableSurface>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>Disconnect is destructive and requires confirmation.</CardDescription>
        </CardHeader>
        <CardContent>
          <TableSurface
            viewportRef={connectionPagination.viewportRef}
            footer={<TablePagination pagination={connectionPagination} />}
          >
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.length === 0 ? (
                <TableEmpty colSpan={5}>No project MCP connections exist.</TableEmpty>
              ) : (
                connections.map((connection) => (
                  <TableRow key={connection.id}>
                    <TableCell className="font-medium">{connection.connectorId}</TableCell>
                    <TableCell>
                      <StatusBadge
                        value={connection.status}
                        detail={connection.lastError ? stringifyJson(connection.lastError) : null}
                      />
                    </TableCell>
                    <TableCell>{connection.hasCredential ? 'Reference configured' : 'No credential'}</TableCell>
                    <TableCell className="max-w-72 truncate">{connection.endpointUrl ?? 'Default'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ConfirmAction
                          title="Disconnect MCP connector?"
                          description={`Disconnect ${connection.connectorId}. Runtime tool calls through this connection will stop.`}
                          confirmLabel="Disconnect"
                          destructive
                          onConfirm={() => onDisconnect(connection.id)}
                        >
                          <Button type="button" variant="outline">
                            Disconnect
                          </Button>
                        </ConfirmAction>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </TableSurface>
        </CardContent>
      </Card>
    </div>
  )
}
