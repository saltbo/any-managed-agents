import { useQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { CreateEnvironmentSheet } from './CreateEnvironmentSheet'
import { EnvironmentsView } from './EnvironmentsView'
import { useEnvironmentActions } from './use-environment-actions'

export function EnvironmentsPage() {
  const [creating, setCreating] = useState(false)
  const actions = useEnvironmentActions()
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(false),
    queryFn: () => api.listEnvironments(),
  })
  const environments = environmentsQuery.data?.data ?? []
  const pagination = useClientPagination(environments)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Environments"
        description="Runtime environment definitions for packages, variables, network policy, and resource limits."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Server data-icon="inline-start" />
            Create environment
          </Button>
        }
      />
      <EnvironmentsView
        environments={pagination.items}
        pagination={pagination}
        onArchive={actions.archiveEnvironment}
      />
      <CreateEnvironmentSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
