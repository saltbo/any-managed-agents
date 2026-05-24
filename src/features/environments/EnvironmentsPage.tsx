import { matchesSearch } from '@/console/format'
import { EnvironmentsView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function EnvironmentsPage() {
  const context = useConsoleContext()
  const environments = context.environments.filter((environment) =>
    matchesSearch(
      [environment.name, environment.description, environment.runtimeImage.image as string | undefined],
      context.query,
    ),
  )
  return <EnvironmentsView environments={environments} onArchive={context.archiveEnvironment} />
}
