import { Link } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge, TableEmpty, TablePagination, TableSurface } from '@/console/components'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Connector } from '@/lib/amarpc'

export function connectorDisabledReason(connector: Connector) {
  if (connector.availability === 'unavailable') {
    return 'Connector is unavailable on this platform.'
  }
  return null
}

export function McpView({
  connectors,
  connectorPagination,
}: {
  connectors: Connector[]
  connectorPagination: ClientPagination<Connector>
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP connectors</CardTitle>
          <CardDescription>
            Platform MCP server catalog entries with capabilities, auth mode, and setup metadata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TableSurface
            tableId="mcp-connectors"
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.length === 0 ? (
                <TableEmpty colSpan={5}>No MCP connectors match the current catalog filters.</TableEmpty>
              ) : (
                connectors.map((connector) => {
                  const disabledReason = connectorDisabledReason(connector)
                  return (
                    <TableRow
                      key={connector.id}
                      aria-disabled={disabledReason ? true : undefined}
                      data-connector-id={connector.id}
                      className={disabledReason ? 'opacity-60' : undefined}
                    >
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 flex-col">
                          <div className="flex min-w-0 items-center gap-2">
                            {disabledReason ? (
                              <span className="truncate font-medium">{connector.name}</span>
                            ) : (
                              <Link
                                to={`/settings/mcp/${connector.id}`}
                                className="truncate font-medium underline-offset-4 hover:underline"
                              >
                                {connector.name}
                              </Link>
                            )}
                            <span className="truncate text-xs text-muted-foreground">{connector.id}</span>
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
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </TableSurface>
        </CardContent>
      </Card>
    </div>
  )
}
