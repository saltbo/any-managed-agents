import { Bot } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { matchesSearch } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { useConsoleContext } from '@/features/console/console-context'
import { AgentsView } from './AgentsView'
import { useAgentActions } from './use-agent-actions'

export function AgentsPage() {
  const context = useConsoleContext()
  const actions = useAgentActions()
  const agents = useMemo(
    () =>
      context.agents.filter((agent) =>
        matchesSearch([agent.name, agent.description, agent.model, agent.provider], context.query),
      ),
    [context.agents, context.query],
  )
  const pagination = useClientPagination(agents)
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
      <AgentsView
        agents={pagination.items}
        pagination={pagination}
        onCreateSession={context.openCreateSession}
        onArchive={actions.archiveAgent}
      />
    </div>
  )
}
