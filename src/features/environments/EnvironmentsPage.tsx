import { useQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { archivedLabel } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { matchesSearch, useUrlFilter } from '@/console/use-list-filters'
import { api } from '@/lib/amarpc'
import { queryKeys } from '@/lib/query-keys'
import { CreateEnvironmentSheet } from './CreateEnvironmentSheet'
import { EnvironmentsView } from './EnvironmentsView'
import { useEnvironmentActions } from './use-environment-actions'

export function EnvironmentsPage() {
  const [creating, setCreating] = useState(false)
  const actions = useEnvironmentActions()
  const [search, setSearch] = useUrlFilter('search')
  const [environmentType, setEnvironmentType] = useUrlFilter('type', 'all')
  const [status, setStatus] = useUrlFilter('status', 'all')
  const archived = status === 'archived'
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(archived),
    queryFn: () => api.listEnvironments({ archived }),
  })
  const allEnvironments = useMemo(() => environmentsQuery.data?.data ?? [], [environmentsQuery.data?.data])
  const environments = useMemo(
    () =>
      allEnvironments.filter(
        (environment) =>
          matchesSearch(search, environment.metadata.name, environment.metadata.description) &&
          (environmentType === 'all' || environment.spec.type === environmentType) &&
          (status === 'all' || archivedLabel(environment) === status),
      ),
    [allEnvironments, search, environmentType, status],
  )
  const pagination = useClientPagination(environments)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Environments"
        description="Runtime environment definitions for packages, variables, and networking."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Server data-icon="inline-start" />
            Create environment
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search environments"
          aria-label="Search environments"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={environmentType} onValueChange={setEnvironmentType}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by environment type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="cloud">cloud</SelectItem>
              <SelectItem value="self_hosted">self_hosted</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="archived">archived</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <EnvironmentsView
        environments={pagination.items}
        pagination={pagination}
        onArchive={actions.archiveEnvironment}
      />
      <CreateEnvironmentSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
