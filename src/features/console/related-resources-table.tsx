import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DetailSection, StatusBadge, TableEmpty, TableSurface } from '@/console/components'
import { archivedLabel, formatDate } from '@/console/format'
import type { Agent, Session } from '@/lib/api'

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
      <TableSurface tableClassName="min-w-full md:min-w-[720px]">
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
              const isAgent = 'name' in item
              return (
                <TableRow key={item.id}>
                  <TableCell className="min-w-0">
                    <Link
                      className="block truncate font-medium hover:underline"
                      to={isAgent ? `/agents/${item.id}` : `/sessions/${item.id}`}
                    >
                      {isAgent ? item.name : item.id}
                    </Link>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{item.id}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={isAgent ? archivedLabel(item) : item.state} />
                  </TableCell>
                  <TableCell className="hidden min-w-0 md:table-cell">
                    <span className="block truncate">{formatDate(isAgent ? item.updatedAt : item.startedAt)}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex justify-end">
                      <Button asChild variant="outline" size="sm">
                        <Link to={isAgent ? `/agents/${item.id}` : `/sessions/${item.id}`}>Open</Link>
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
