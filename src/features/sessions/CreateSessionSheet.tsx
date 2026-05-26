import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptySession } from '@/console/defaults'
import { parseJsonObject, parseJsonObjectArray } from '@/console/format'
import { SessionForm } from '@/console/forms'
import type { SessionFormState } from '@/console/types'
import { api, type Session } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_RESOURCES: never[] = []

export function CreateSessionSheet({
  open,
  onOpenChange,
  agentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId?: string | undefined
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SessionFormState>(emptySession)
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(false),
    queryFn: () => api.listAgents(),
    enabled: open,
  })
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(false),
    queryFn: () => api.listEnvironments(),
    enabled: open,
  })
  const agents = agentsQuery.data?.data ?? EMPTY_RESOURCES
  const environments = environmentsQuery.data?.data ?? EMPTY_RESOURCES
  const createSession = useMutation({
    mutationFn: () =>
      api.createSession({
        agentId: form.agentId,
        environmentId: form.environmentId,
        ...(form.title ? { title: form.title } : {}),
        metadata: parseJsonObject(form.metadata, 'Metadata'),
        resourceRefs: parseJsonObjectArray(form.resourceRefs, 'Resource refs'),
        vaultRefs: parseJsonObjectArray(form.vaultRefs, 'Vault refs'),
      }),
    onSuccess: (session: Session) => {
      onOpenChange(false)
      setForm(emptySession)
      toast.success('Session created')
      queryClient.setQueryData(queryKeys.sessions.detail(session.id), session)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
      void navigate(`/sessions/${session.id}`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  useEffect(() => {
    if (!open) return
    const activeAgent = agents.find((agent) => agent.status === 'active')
    const activeEnvironment = environments.find((environment) => environment.status === 'active')
    setForm((current) => {
      const nextAgentId = agentId || current.agentId || activeAgent?.id || ''
      const nextEnvironmentId = current.environmentId || activeEnvironment?.id || ''
      if (current.agentId === nextAgentId && current.environmentId === nextEnvironmentId) {
        return current
      }
      return {
        ...current,
        agentId: nextAgentId,
        environmentId: nextEnvironmentId,
      }
    })
  }, [agentId, agents, environments, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    createSession.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Create Session</SheetTitle>
          <SheetDescription>Select the agent and runtime environment for this session.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <SessionForm value={form} setValue={setForm} agents={agents} environments={environments} onSubmit={submit} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
