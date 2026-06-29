import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DetailSection, StatusBadge, TableEmpty, TableSurface } from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import type { Agent, Session } from '@/lib/amarpc'

function isAgent(item: Agent | Session): item is Agent {
  return 'systemPrompt' in item.spec
}

export function RelatedResourcesTable({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: Array<Agent | Session>
}) {
  return (
    <DetailSection title={title}>
      <TableSurface tableId="related-resources" tableClassName="min-w-full md:min-w-[720px]">
        <colgroup>
          <col className="w-[62%] md:w-[44%]" />
          <col className="w-[38%] md:w-[18%]" />
          <col className="hidden md:table-column md:w-[28%]" />
          <col className="hidden md:table-column md:w-[10%]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Updated</TableHead>
            <TableHead className="hidden text-right md:table-cell">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableEmpty colSpan={4}>{empty}</TableEmpty>
          ) : (
            items.map((item) => {
              const agent = isAgent(item)
              const id = item.metadata.uid
              const name = item.metadata.name
              const updated = agent
                ? formatDate(item.metadata.updatedAt)
                : item.status.startedAt
                  ? formatDate(item.status.startedAt)
                  : 'None'
              return (
                <TableRow key={id}>
                  <TableCell className="min-w-0">
                    <Link
                      className="block truncate font-medium hover:underline"
                      to={agent ? `/agents/${id}` : `/sessions/${id}`}
                    >
                      {name}
                    </Link>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{id}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={agent ? archivedLabel(item) : item.status.phase} />
                  </TableCell>
                  <TableCell className="hidden min-w-0 md:table-cell">
                    <span className="block truncate">{updated}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex justify-end">
                      <Button asChild variant="outline" size="sm">
                        <Link to={agent ? `/agents/${id}` : `/sessions/${id}`}>Open</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </TableSurface>
    </DetailSection>
  )
}
