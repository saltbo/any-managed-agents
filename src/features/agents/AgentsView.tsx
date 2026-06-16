import { Archive, Play } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Agent } from '@/lib/api'

export function AgentsView({
  agents,
  pagination,
  onCreateSession,
  onArchive,
}: {
  agents: Agent[]
  pagination: ClientPagination<Agent>
  onCreateSession: (id: string) => void
  onArchive: (id: string) => void
}) {
  if (agents.length === 0) {
    return <EmptyState title="No agents" body="Create an agent, then create a session from this list." />
  }
  return (
    <TableSurface
      tableId="agents"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Skills</TableHead>
          <TableHead>Tools</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.id}>
            <TableCell className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/agents/${agent.id}`}>
                  {agent.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">{agent.description ?? agent.id}</span>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <StatusBadge value={archivedLabel(agent)} />
                <StatusBadge value={`v${agent.version}`} />
              </div>
            </TableCell>
            <TableCell className="max-w-64 truncate">{`${agent.providerId ?? 'None'} / ${agent.model ?? 'None'}`}</TableCell>
            <TableCell className="max-w-48 truncate">{agent.skills.join(', ') || 'None'}</TableCell>
            <TableCell className="max-w-48 truncate">
              {agent.tools.map((tool) => tool.name).join(', ') || 'None'}
            </TableCell>
            <TableCell>{formatDate(agent.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onCreateSession(agent.id)}
                  aria-label="Create session"
                >
                  <Play data-icon="inline-start" />
                </Button>
                <ConfirmAction
                  title="Archive agent?"
                  description={`Archive ${agent.name}. Existing active sessions are not deleted, but this agent will leave the active list.`}
                  confirmLabel="Archive agent"
                  destructive
                  onConfirm={() => onArchive(agent.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive agent">
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
