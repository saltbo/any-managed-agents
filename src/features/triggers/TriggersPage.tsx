import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { matchesSearch, useUrlFilter } from '@/console/use-list-filters'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { TriggersView } from './TriggersView'
import { useTriggerActions } from './use-trigger-actions'

function triggerStatus(enabled: boolean) {
  return enabled ? 'active' : 'paused'
}

export function TriggersPage() {
  const actions = useTriggerActions()
  const [search, setSearch] = useUrlFilter('search')
  const [status, setStatus] = useUrlFilter('status', 'all')
  const triggersQuery = useQuery({
    queryKey: queryKeys.triggers.list(),
    queryFn: () => api.listTriggers(),
  })
  const allTriggers = useMemo(() => triggersQuery.data?.data ?? [], [triggersQuery.data?.data])
  const triggers = useMemo(
    () =>
      allTriggers.filter(
        (trigger) =>
          matchesSearch(search, trigger.name, trigger.agentId) &&
          (status === 'all' || triggerStatus(trigger.enabled) === status),
      ),
    [allTriggers, search, status],
  )
  const pagination = useClientPagination(triggers)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Triggers" description="Scheduled triggers that dispatch an agent on a recurring interval." />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search triggers"
          aria-label="Search triggers"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="paused">paused</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <TriggersView
        triggers={pagination.items}
        pagination={pagination}
        onPause={actions.pauseTrigger}
        onResume={actions.resumeTrigger}
      />
    </div>
  )
}
