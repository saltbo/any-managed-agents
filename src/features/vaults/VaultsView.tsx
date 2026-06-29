import { Archive } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Vault } from '@/lib/amarpc'

export function VaultsView({
  vaults,
  pagination,
  onArchive,
}: {
  vaults: Vault[]
  pagination: ClientPagination<Vault>
  onArchive: (id: string) => void
}) {
  if (vaults.length === 0) {
    return <EmptyState title="No vaults" body="Create a vault to track safe secret references for providers and MCP." />
  }
  return (
    <TableSurface
      tableId="vaults"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Vault</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vaults.map((vault) => (
          <TableRow key={vault.metadata.uid}>
            <TableCell className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/vaults/${vault.metadata.uid}`}>
                  {vault.metadata.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {vault.metadata.description ?? vault.metadata.uid}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <StatusBadge value={archivedLabel(vault)} />
            </TableCell>
            <TableCell>
              <StatusBadge value={vault.spec.scope} />
            </TableCell>
            <TableCell className="max-w-48 truncate">{vault.metadata.pid ?? 'Organization'}</TableCell>
            <TableCell>{formatDate(vault.metadata.createdAt)}</TableCell>
            <TableCell>{formatDate(vault.metadata.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ConfirmAction
                  title="Archive vault?"
                  description={`Archive ${vault.metadata.name}. Existing secret references remain auditable.`}
                  confirmLabel="Archive vault"
                  destructive
                  onConfirm={() => onArchive(vault.metadata.uid)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive vault">
                    <Archive data-icon="inline-start" />
                  </Button>
                </ConfirmAction>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
