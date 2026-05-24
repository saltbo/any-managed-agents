import { Archive, Play } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import type { Agent } from '@/lib/api'

export function AgentsView({
  agents,
  onCreateSession,
  onArchive,
}: {
  agents: Agent[]
  onCreateSession: (id: string) => void
  onArchive: (id: string) => void
}) {
  if (agents.length === 0) {
    return <EmptyState title="No agents" body="Create an agent, then create a session from this list." />
  }
  return (
    <TableSurface>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Tools</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.id}>
            <TableCell className="min-w-56">
              <Link className="font-medium hover:underline" to={`/agents/${agent.id}`}>
                {agent.name}
              </Link>
              <p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{agent.description ?? agent.id}</p>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <StatusBadge value={agent.status} />
                <StatusBadge value={`v${agent.version}`} />
              </div>
            </TableCell>
            <TableCell className="max-w-64 truncate">{`${agent.provider} / ${agent.model}`}</TableCell>
            <TableCell className="max-w-48 truncate">{agent.allowedTools.join(', ') || 'None'}</TableCell>
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
