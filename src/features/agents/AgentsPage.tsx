import { AgentsView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function AgentsPage() {
  const context = useConsoleContext()
  return (
    <AgentsView
      agents={context.agents}
      environments={context.environments}
      onStartSession={context.startSession}
      onArchive={context.archiveAgent}
    />
  )
}
