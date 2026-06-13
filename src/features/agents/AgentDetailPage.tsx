import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PageHeader, StatusBadge } from '@/console/components'
import { formatDate, parseJsonObject, parseTools, stringifyJson } from '@/console/format'
import { AgentForm } from '@/console/forms'
import type { AgentFormState } from '@/console/types'
import { CreateSessionSheet } from '@/features/sessions/CreateSessionSheet'
import { type Agent, api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { AgentDetailView } from './AgentDetailView'
import { useAgentActions } from './use-agent-actions'

export function AgentDetailPage() {
  const { agentId } = useParams()
  const queryClient = useQueryClient()
  const agentActions = useAgentActions()
  const [editing, setEditing] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [form, setForm] = useState<AgentFormState | null>(null)
  const agentQuery = useQuery({
    queryKey: queryKeys.agents.detail(agentId ?? ''),
    queryFn: () => api.readAgent(agentId as string),
    enabled: Boolean(agentId),
  })
  const versionsQuery = useQuery({
    queryKey: queryKeys.agents.versions(agentId ?? ''),
    queryFn: () => api.listAgentVersions(agentId as string),
    enabled: Boolean(agentId),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(),
  })
  const agent = agentQuery.data ?? null
  const updateAgent = useMutation({
    mutationFn: (input: AgentFormState) =>
      api.updateAgent(agentId as string, {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        systemPrompt: input.instructions,
        provider: input.provider,
        model: input.model || null,
        skills: parseTools(input.skills),
        allowedTools: parseTools(input.allowedTools),
        mcpConnectors: parseTools(input.mcpConnectors),
        metadata: parseJsonObject(input.metadata, 'Metadata'),
      }),
    onSuccess: () => {
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId ?? '') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.versions(agentId ?? '') })
    },
  })
  const openEdit = () => {
    if (!agent) return
    setForm(agentToForm(agent))
    setEditing(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Agent"
        title={agent?.name ?? 'Agent detail'}
        titleAccessory={agent ? <StatusBadge value={agent.status} /> : null}
        description={
          agent
            ? `${agent.description ?? 'No description'} · Created ${formatDate(agent.createdAt)} · Updated ${formatDate(agent.updatedAt)}`
            : 'Inspect agent model configuration, version snapshot, and related sessions.'
        }
        actions={
          agent ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={openEdit}>
                <Pencil data-icon="inline-start" />
                Edit agent
              </Button>
              {agent.status !== 'archived' ? (
                <Button type="button" onClick={() => setCreatingSession(true)}>
                  Create session
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      <AgentDetailView
        agent={agent}
        versions={versionsQuery.data?.data ?? []}
        sessions={sessionsQuery.data?.data ?? []}
        onArchive={agentActions.archiveAgent}
      />
      <CreateSessionSheet
        open={creatingSession}
        agentId={agent?.id}
        onOpenChange={(open) => setCreatingSession(open)}
      />
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Edit Agent</SheetTitle>
            <SheetDescription>
              Saving provider, model, or policy fields creates a new immutable agent version.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {form ? (
              <AgentForm
                value={form}
                setValue={setForm}
                submitLabel={updateAgent.isPending ? 'Saving agent' : 'Save changes'}
                onSubmit={(event) => {
                  event.preventDefault()
                  updateAgent.mutate(form)
                }}
              />
            ) : null}
            {updateAgent.error instanceof Error ? (
              <p className="mt-3 text-sm text-destructive">{updateAgent.error.message}</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function agentToForm(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    description: agent.description ?? '',
    instructions: agent.instructions ?? '',
    provider: agent.provider,
    model: agent.model,
    skills: agent.skills.join('\n'),
    allowedTools: agent.allowedTools.join('\n'),
    mcpConnectors: agent.mcpConnectors.join('\n'),
    metadata: stringifyJson(agent.metadata),
  }
}
