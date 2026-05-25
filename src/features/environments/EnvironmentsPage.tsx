import { Server } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { useConsoleContext } from '@/features/console/console-context'
import { EnvironmentsView } from './EnvironmentsView'
import { useEnvironmentActions } from './use-environment-actions'

export function EnvironmentsPage() {
  const context = useConsoleContext()
  const actions = useEnvironmentActions()
  const environments = useMemo(
    () =>
      context.environments.filter((environment) =>
        matchesSearch(
          [environment.name, environment.description, environment.runtimeImage.image as string | undefined],
          context.query,
        ),
      ),
    [context.environments, context.query],
  )
  const pagination = useClientPagination(environments)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Environments"
        description="Runtime environment definitions for packages, variables, network policy, and resource limits."
        actions={
          <Button type="button" onClick={context.openCreateEnvironment}>
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
    </div>
  )
}
