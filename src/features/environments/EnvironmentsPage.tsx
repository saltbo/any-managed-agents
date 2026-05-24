import { EnvironmentsView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function EnvironmentsPage() {
  const context = useConsoleContext()
  return <EnvironmentsView environments={context.environments} onArchive={context.archiveEnvironment} />
}
