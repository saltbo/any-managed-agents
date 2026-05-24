import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, StatusBadge, TableEmpty, TableSurface } from '@/console/components'
import type { McpConnection, McpConnector } from '@/lib/api'

export function McpView({
  connectors,
  connections,
  onDisconnect,
}: {
  connectors: McpConnector[]
  connections: McpConnection[]
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
          <TableSurface>
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
                    <TableCell className="min-w-56">
                      <span className="font-medium">{connector.name}</span>
                      <p className="mt-1 text-xs text-muted-foreground">{connector.connectorId}</p>
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
          <TableSurface>
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
                      <StatusBadge value={connection.status} />
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
