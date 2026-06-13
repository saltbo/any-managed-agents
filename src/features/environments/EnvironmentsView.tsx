import { Archive } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Environment } from '@/lib/api'

function networkSummary(environment: Environment) {
  if (environment.networkPolicy.mode === 'restricted') {
    return `Restricted: ${environment.networkPolicy.allowedHosts.join(', ')}`
  }
  return environment.networkPolicy.mode
}

function runtimeConfigSummary(environment: Environment) {
  return String(environment.runtimeConfig.image ?? environment.runtimeConfig.mode ?? 'Default')
}

export function EnvironmentsView({
  environments,
  pagination,
  onArchive,
}: {
  environments: Environment[]
  pagination: ClientPagination<Environment>
  onArchive: (id: string) => void
}) {
  if (environments.length === 0) {
    return <EmptyState title="No environments" body="Create an execution environment before creating an agent." />
  }
  return (
    <TableSurface viewportRef={pagination.viewportRef} footer={<TablePagination pagination={pagination} />}>
      <TableHeader>
        <TableRow>
          <TableHead>Environment</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Hosting</TableHead>
          <TableHead>Runtime config</TableHead>
          <TableHead>Packages</TableHead>
          <TableHead>Network</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {environments.map((environment) => (
          <TableRow key={environment.id}>
            <TableCell className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/environments/${environment.id}`}>
                  {environment.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {environment.description ?? environment.id}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <StatusBadge value={archivedLabel(environment)} />
                <StatusBadge value={`v${environment.version}`} />
              </div>
            </TableCell>
            <TableCell>{environment.hostingMode}</TableCell>
            <TableCell className="max-w-48 truncate">{runtimeConfigSummary(environment)}</TableCell>
            <TableCell className="max-w-56 truncate">
              {environment.packages.map((item) => `${item.name}${item.version ? `@${item.version}` : ''}`).join(', ') ||
                'None'}
            </TableCell>
            <TableCell className="max-w-48 truncate">{networkSummary(environment)}</TableCell>
            <TableCell>{formatDate(environment.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ConfirmAction
                  title="Archive environment?"
                  description={`Archive ${environment.name}. Agents can no longer start new sessions with this environment.`}
                  confirmLabel="Archive environment"
                  destructive
                  onConfirm={() => onArchive(environment.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive environment">
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
