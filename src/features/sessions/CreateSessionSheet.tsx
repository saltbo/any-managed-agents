import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptySession } from '@/console/defaults'
import { isArchived } from '@/console/format'
import { SessionForm } from '@/console/forms'
import type { SessionFormState } from '@/console/types'
import { ApiError, api, type Session, type SessionInput } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
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
  const memoryStoresQuery = useQuery({
    queryKey: queryKeys.memoryStores.list(false),
    queryFn: () => api.listMemoryStores(),
    enabled: open,
  })
  const vaultsQuery = useQuery({
    queryKey: queryKeys.vaults.list(false),
    queryFn: () => api.listVaults(),
    enabled: open,
  })
  const agents = agentsQuery.data?.data ?? EMPTY_RESOURCES
  const environments = environmentsQuery.data?.data ?? EMPTY_RESOURCES
  const memoryStores = memoryStoresQuery.data?.data ?? EMPTY_RESOURCES
  const vaults = vaultsQuery.data?.data ?? EMPTY_RESOURCES
  const createSession = useMutation({
    mutationFn: () => {
      const resources = sessionResourcesInput(form, memoryStores)
      return api.createSession({
        agentId: form.agentId,
        environmentId: form.environmentId,
        runtime: form.runtime,
        prompt: form.prompt.trim(),
        volumes: resources.volumes,
        volumeMounts: resources.volumeMounts,
      })
    },
    onSuccess: (session: Session) => {
      onOpenChange(false)
      setForm(emptySession)
      toast.success('Session created')
      queryClient.setQueryData(queryKeys.sessions.detail(session.metadata.uid), session)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
      void navigate(`/sessions/${session.metadata.uid}`)
    },
    onError: (error) => toast.error(formatCreateSessionError(error)),
  })

  useEffect(() => {
    if (!open) return
    const activeAgent = agents.find((agent) => !isArchived(agent))
    const activeEnvironment = environments.find((environment) => !isArchived(environment))
    setForm((current) => {
      const nextAgentId = agentId || current.agentId || activeAgent?.metadata.uid || ''
      const nextEnvironmentId = current.environmentId || activeEnvironment?.metadata.uid || ''
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
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Session</SheetTitle>
          <SheetDescription>Select the agent, environment, and runtime for this session.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <SessionForm
            value={form}
            setValue={setForm}
            agents={agents}
            environments={environments}
            memoryStores={memoryStores}
            vaults={vaults}
            onSubmit={submit}
          />
          {createSession.error ? (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formatCreateSessionError(createSession.error)}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function sessionResourcesInput(
  form: SessionFormState,
  memoryStores: Array<{ metadata: { uid: string; name: string; description?: string | null } }>,
): Pick<SessionInput, 'volumes' | 'volumeMounts'> {
  const volumes: NonNullable<SessionInput['volumes']> = []
  const volumeMounts: NonNullable<SessionInput['volumeMounts']> = []
  for (const vaultId of form.credentialVaultIds) {
    const name = safeVolumeName('vault', vaultId)
    volumes.push({ name, type: 'secret', secretRef: `ama://vaults/${encodeURIComponent(vaultId)}` })
    volumeMounts.push({ name, mountPath: `/workspace/.ama/secrets/${vaultId}`, readOnly: true })
  }
  form.resources.forEach((resource, index) => {
    if (resource.type === 'git_repository') {
      const url = resource.url.trim()
      if (!url) return
      const name = safeVolumeName('repo', resource.id)
      volumes.push({
        name,
        type: 'git_repository',
        url,
        ...(resource.ref.trim() ? { ref: resource.ref.trim() } : {}),
      })
      volumeMounts.push({ name, mountPath: gitRepositoryMountPath(url, index), readOnly: true })
      return
    }
    if (!resource.memoryStoreId) return
    const store = memoryStores.find((candidate) => candidate.metadata.uid === resource.memoryStoreId)
    const name = safeVolumeName('memory', resource.memoryStoreId)
    volumes.push({
      name,
      type: 'memory',
      memoryRef: `ama://memories/${encodeURIComponent(resource.memoryStoreId)}`,
      access: resource.access,
      ...(store?.metadata.name ? { storeName: store.metadata.name } : {}),
      ...(store?.metadata.description ? { description: store.metadata.description } : {}),
    })
    volumeMounts.push({
      name,
      mountPath: `/workspace/.ama/memory-stores/${resource.memoryStoreId}`,
      readOnly: resource.access !== 'read_write',
    })
  })
  return { volumes, volumeMounts }
}

function safeVolumeName(prefix: string, value: string) {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  return `${prefix}-${safe || 'resource'}`.slice(0, 80)
}

function gitRepositoryMountPath(url: string, index: number) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `/workspace/repos/repository-${index + 1}`
  }
  const path = parsed.pathname
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean)
    .join('/')
  return `/workspace/repos/${parsed.hostname}/${path || `repository-${index + 1}`}`
}

export function formatCreateSessionError(error: unknown) {
  if (error instanceof ApiError) {
    const details = apiErrorDetails(error)
    if (
      details?.resourceType === 'runtime_catalog' &&
      typeof details.hostingMode === 'string' &&
      typeof details.runtime === 'string' &&
      typeof details.provider === 'string' &&
      typeof details.model === 'string'
    ) {
      return `Unsupported capability: ${hostingModeLabel(details.hostingMode)} session runtime ${details.runtime} cannot run Agent provider ${details.provider} with model ${details.model}.`
    }
  }
  return errorMessage(error)
}

function apiErrorDetails(error: ApiError) {
  if (!error.details || typeof error.details !== 'object') {
    return null
  }
  const body = error.details as { error?: { details?: unknown } }
  const details = body.error?.details
  return details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : null
}

function hostingModeLabel(value: string) {
  return value === 'self_hosted' ? 'Self-hosted' : 'Cloud'
}
