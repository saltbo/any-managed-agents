import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useConsoleContext } from '@/features/console/console-context'
import { AgentsView } from './AgentsView'
import { useAgentActions } from './use-agent-actions'

export function AgentsPage() {
  const context = useConsoleContext()
  const actions = useAgentActions()
  const agents = context.agents.filter((agent) =>
    matchesSearch([agent.name, agent.description, agent.model, agent.provider], context.query),
  )
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Agents"
        description="Create and operate reusable agent profiles. Create sessions from active agents."
        actions={
          <Button type="button" onClick={context.openCreateAgent}>
            <Bot data-icon="inline-start" />
            Create agent
          </Button>
        }
      />
      <AgentsView agents={agents} onCreateSession={context.openCreateSession} onArchive={actions.archiveAgent} />
    </div>
  )
}
