import { useQuery } from '@tanstack/react-query'
import { Bot, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { CreateSessionSheet } from '@/features/sessions/CreateSessionSheet'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { AgentsView } from './AgentsView'
import { CreateAgentSheet } from './CreateAgentSheet'
import { useAgentActions } from './use-agent-actions'

export function AgentsPage() {
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [sessionAgentId, setSessionAgentId] = useState<string | undefined>()
  const actions = useAgentActions()
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(false),
    queryFn: () => api.listAgents(),
  })
  const agents = agentsQuery.data?.data ?? []
  const pagination = useClientPagination(agents)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Agents"
        description="Create and operate reusable agent profiles. Create sessions from active agents."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/agents/new">
                <Wand2 data-icon="inline-start" />
                Agent builder
              </Link>
            </Button>
            <Button type="button" onClick={() => setCreatingAgent(true)}>
              <Bot data-icon="inline-start" />
              Create agent
            </Button>
          </div>
        }
      />
      <AgentsView
        agents={pagination.items}
        pagination={pagination}
        onCreateSession={setSessionAgentId}
        onArchive={actions.archiveAgent}
      />
      <CreateAgentSheet open={creatingAgent} onOpenChange={setCreatingAgent} />
      <CreateSessionSheet
        open={sessionAgentId !== undefined}
        agentId={sessionAgentId}
        onOpenChange={(open) => {
          if (!open) setSessionAgentId(undefined)
        }}
      />
    </div>
  )
}
