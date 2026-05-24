import { matchesSearch } from '@/console/format'
import { AgentsView } from '@/console/views'
import { useConsoleContext } from '@/features/console/console-context'

export function AgentsPage() {
  const context = useConsoleContext()
  const agents = context.agents.filter((agent) =>
    matchesSearch([agent.name, agent.description, agent.model, agent.provider], context.query),
  )
  return (
    <AgentsView
      agents={agents}
      environments={context.environments}
      onStartSession={context.startSession}
      onArchive={context.archiveAgent}
    />
  )
}
