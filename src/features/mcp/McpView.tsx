import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, StatusBadge, TableEmpty, TablePagination, TableSurface } from '@/console/components'
import { stringifyJson } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { McpConnection, McpConnector } from '@/lib/api'

export function connectorDisabledReason(connector: McpConnector) {
  if (connector.status === 'unavailable') {
    return 'Connector is unavailable on this platform.'
  }
  if (connector.policyStatus === 'blocked') {
    return 'Blocked by governance policy.'
  }
  return null
}

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
          <CardDescription>Catalog entries with capability, trust, governance, and connection state.</CardDescription>
        </CardHeader>
        <CardContent>
          <TableSurface
            viewportRef={connectorPagination.viewportRef}
            footer={<TablePagination pagination={connectorPagination} />}
            tableClassName="min-w-[960px]"
          >
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Trust level</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Auth and setup</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Connection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.length === 0 ? (
                <TableEmpty colSpan={7}>No MCP connectors match the current catalog filters.</TableEmpty>
              ) : (
                connectors.map((connector) => {
                  const disabledReason = connectorDisabledReason(connector)
                  return (
                    <TableRow
                      key={connector.id}
                      aria-disabled={disabledReason ? true : undefined}
                      data-connector-id={connector.connectorId}
                      className={disabledReason ? 'opacity-60' : undefined}
                    >
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 flex-col">
                          <div className="flex min-w-0 items-center gap-2">
                            {disabledReason ? (
                              <span className="truncate font-medium">{connector.name}</span>
                            ) : (
                              <Link
                                to={`/mcp/${connector.connectorId}`}
                                className="truncate font-medium underline-offset-4 hover:underline"
                              >
                                {connector.name}
                              </Link>
                            )}
                            <span className="truncate text-xs text-muted-foreground">{connector.connectorId}</span>
                          </div>
                          <span className="truncate text-xs text-muted-foreground">{connector.description}</span>
                          {disabledReason ? <span className="text-xs text-destructive">{disabledReason}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell>{connector.category}</TableCell>
                      <TableCell>
                        <StatusBadge value={connector.trustLevel} />
                      </TableCell>
                      <TableCell className="max-w-56 truncate">{connector.capabilities.join(', ') || 'None'}</TableCell>
                      <TableCell className="max-w-56 min-w-0">
                        <div className="flex min-w-0 flex-col text-xs">
                          <span className="truncate">{connector.supportedAuthModes.join(', ') || 'None'}</span>
                          <span className="truncate text-muted-foreground">
                            Setup: {connector.setupRequirements.join(', ') || 'None'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={connector.policyStatus} detail={disabledReason} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={connector.connectionStatus} />
                      </TableCell>
                    </TableRow>
                  )
                })
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
