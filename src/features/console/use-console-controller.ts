import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { emptyAgent, emptyEnvironment, emptyProvider, emptySession, emptyVault } from '@/console/defaults'
import {
  parseJsonObject,
  parseJsonObjectArray,
  parsePackages,
  parseTools,
  parseVariables,
  viewFromPath,
} from '@/console/format'
import { ApiError, api, type Session } from '@/lib/api'
import type { CreateResourceSheetProps } from './CreateResourceSheet'
import type { ConsoleContextValue } from './console-context'

const resourcesQueryKey = (includeArchived: boolean) => ['console', 'resources', includeArchived] as const
const EMPTY_RESOURCES: never[] = []

export function useConsoleController() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const view = viewFromPath(location.pathname) ?? 'agents'
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedSessions, setSelectedSessions] = useState<Record<string, Session>>({})
  const [createMode, setCreateMode] = useState<CreateResourceSheetProps['mode']>(null)
  const [environmentForm, setEnvironmentForm] = useState(emptyEnvironment)
  const [agentForm, setAgentForm] = useState(emptyAgent)
  const [sessionForm, setSessionForm] = useState(emptySession)
  const [providerForm, setProviderForm] = useState(emptyProvider)
  const [vaultForm, setVaultForm] = useState(emptyVault)

  const authQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.me,
    retry: false,
  })

  const resourcesQuery = useQuery({
    queryKey: resourcesQueryKey(includeArchived),
    queryFn: async () => {
      const [
        agents,
        environments,
        sessions,
        providers,
        vaults,
        mcpConnectors,
        mcpConnections,
        governancePolicy,
        usageSummary,
        auditRecords,
      ] = await Promise.all([
        api.listAgents(includeArchived),
        api.listEnvironments(includeArchived),
        api.listSessions(includeArchived),
        api.listProviders(includeArchived),
        api.listVaults(includeArchived),
        api.listMcpConnectors(),
        api.listMcpConnections(),
        api.readGovernancePolicy(),
        api.readUsageSummary(),
        api.listAuditRecords(),
      ])
      const vaultCredentials = await Promise.all(
        vaults.data.map(
          async (vault) => [vault.id, (await api.listVaultCredentials(vault.id, includeArchived)).data] as const,
        ),
      )
      return {
        agents: agents.data,
        environments: environments.data,
        sessions: sessions.data,
        providers: providers.data,
        vaults: vaults.data,
        mcpConnectors: mcpConnectors.data,
        mcpConnections: mcpConnections.data,
        governancePolicy,
        usageSummary,
        auditRecords: auditRecords.data,
        vaultCredentials: Object.fromEntries(vaultCredentials),
      }
    },
    enabled: authQuery.isSuccess,
  })

  const agents = resourcesQuery.data?.agents ?? EMPTY_RESOURCES
  const environments = resourcesQuery.data?.environments ?? EMPTY_RESOURCES
  const sessions = resourcesQuery.data?.sessions ?? EMPTY_RESOURCES
  const providers = resourcesQuery.data?.providers ?? EMPTY_RESOURCES
  const vaults = resourcesQuery.data?.vaults ?? EMPTY_RESOURCES
  const mcpConnectors = resourcesQuery.data?.mcpConnectors ?? EMPTY_RESOURCES
  const mcpConnections = resourcesQuery.data?.mcpConnections ?? EMPTY_RESOURCES
  const governancePolicy = resourcesQuery.data?.governancePolicy ?? null
  const usageSummary = resourcesQuery.data?.usageSummary ?? null
  const auditRecords = resourcesQuery.data?.auditRecords ?? []
  const vaultCredentials = resourcesQuery.data?.vaultCredentials ?? {}
  const selectedSession =
    selectedSessionId === null
      ? (sessions[0] ?? null)
      : (selectedSessions[selectedSessionId] ?? sessions.find((session) => session.id === selectedSessionId) ?? null)

  const eventsQuery = useQuery({
    queryKey: ['sessions', selectedSession?.id, 'events'],
    queryFn: () => api.listSessionEvents(selectedSession?.id ?? ''),
    enabled: Boolean(selectedSession?.id),
  })

  const invalidateResources = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
  }, [queryClient])
  const setMutationError = (err: unknown) => {
    toast.error(err instanceof Error ? err.message : String(err))
  }

  const createEnvironment = useMutation({
    mutationFn: () =>
      api.createEnvironment({
        name: environmentForm.name,
        description: environmentForm.description,
        packages: parsePackages(environmentForm.packages),
        variables: parseVariables(environmentForm.variables),
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
        runtimeImage: { image: environmentForm.runtimeImage },
      }),
    onSuccess: (environment) => {
      setSessionForm((current) => ({ ...current, environmentId: current.environmentId || environment.id }))
      setCreateMode(null)
      toast.success('Environment created')
      invalidateResources()
    },
    onError: setMutationError,
  })
  const createAgent = useMutation({
    mutationFn: () =>
      api.createAgent({
        name: agentForm.name,
        description: agentForm.description,
        instructions: agentForm.instructions,
        systemPrompt: agentForm.instructions,
        provider: agentForm.provider,
        model: agentForm.model,
        allowedTools: parseTools(agentForm.allowedTools),
        mcpConnectors: parseTools(agentForm.mcpConnectors),
        sandboxPolicy: parseJsonObject(agentForm.sandboxPolicy, 'Sandbox policy'),
        metadata: parseJsonObject(agentForm.metadata, 'Metadata'),
      }),
    onSuccess: (agent) => {
      setSessionForm((current) => ({ ...current, agentId: current.agentId || agent.id }))
      setCreateMode(null)
      toast.success('Agent created')
      invalidateResources()
    },
    onError: setMutationError,
  })
  const createProvider = useMutation({
    mutationFn: () =>
      api.createProvider({
        type: providerForm.type,
        displayName: providerForm.displayName,
        ...(providerForm.baseUrl ? { baseUrl: providerForm.baseUrl } : {}),
        ...(providerForm.credentialSecretRef ? { credentialSecretRef: providerForm.credentialSecretRef } : {}),
      }),
    onSuccess: () => {
      setCreateMode(null)
      toast.success('Provider created')
      invalidateResources()
    },
    onError: setMutationError,
  })
  const createVault = useMutation({
    mutationFn: () =>
      api.createVault({
        name: vaultForm.name,
        description: vaultForm.description,
        scope: vaultForm.scope,
      }),
    onSuccess: () => {
      setCreateMode(null)
      toast.success('Vault created')
      invalidateResources()
    },
    onError: setMutationError,
  })
  const createSession = useMutation({
    mutationFn: () =>
      api.createSession({
        agentId: sessionForm.agentId,
        environmentId: sessionForm.environmentId,
        ...(sessionForm.title ? { title: sessionForm.title } : {}),
        metadata: parseJsonObject(sessionForm.metadata, 'Metadata'),
        resourceRefs: parseJsonObjectArray(sessionForm.resourceRefs, 'Resource refs'),
        vaultRefs: parseJsonObjectArray(sessionForm.vaultRefs, 'Vault refs'),
      }),
    onSuccess: (session: Session) => {
      setSelectedSessionId(session.id)
      setSelectedSessions((current) => ({ ...current, [session.id]: session }))
      setCreateMode(null)
      toast.success('Session created')
      invalidateResources()
      void navigate(`/sessions/${session.id}`)
    },
    onError: setMutationError,
  })
  useEffect(() => {
    setSelectedSessionId((current) => current ?? sessions[0]?.id ?? null)
  }, [sessions])
  useEffect(() => {
    if (!sessions.some((session) => session.status === 'pending')) return
    const timer = window.setInterval(invalidateResources, 2000)
    return () => window.clearInterval(timer)
  }, [invalidateResources, sessions])
  useEffect(() => {
    const activeAgent = agents.find((agent) => agent.status === 'active')
    const activeEnvironment = environments.find((environment) => environment.status === 'active')
    setSessionForm((current) => ({
      ...current,
      agentId: current.agentId || activeAgent?.id || '',
      environmentId: current.environmentId || activeEnvironment?.id || '',
    }))
  }, [agents, environments])
  useEffect(() => {
    const authError = authQuery.error
    if (authError instanceof ApiError && authError.status === 401) return
    const nextError = authError ?? resourcesQuery.error ?? eventsQuery.error
    if (nextError) toast.error(nextError instanceof Error ? nextError.message : String(nextError))
  }, [authQuery.error, resourcesQuery.error, eventsQuery.error])

  const busy =
    resourcesQuery.isFetching ||
    createEnvironment.isPending ||
    createAgent.isPending ||
    createProvider.isPending ||
    createVault.isPending ||
    createSession.isPending

  const contextValue: ConsoleContextValue | null = authQuery.data
    ? {
        auth: authQuery.data,
        view,
        query,
        setQuery,
        includeArchived,
        setIncludeArchived,
        agents,
        environments,
        sessions,
        providers,
        vaults,
        mcpConnectors,
        mcpConnections,
        governancePolicy,
        usageSummary,
        auditRecords,
        vaultCredentials,
        selectedSession,
        selectedSessionId,
        setSelectedSessionId,
        setSelectedSession: (session) => {
          setSelectedSessionId(session.id)
          setSelectedSessions((current) => ({ ...current, [session.id]: session }))
        },
        sessionEvents: eventsQuery.data?.data ?? [],
        busy,
        refresh: invalidateResources,
        openCreateAgent: () => setCreateMode('agent'),
        openCreateEnvironment: () => setCreateMode('environment'),
        openCreateProvider: () => setCreateMode('provider'),
        openCreateVault: () => setCreateMode('vault'),
        openCreateSession: (agentId) => {
          const activeAgent = agents.find((agent) => agent.status === 'active')
          const activeEnvironment = environments.find((environment) => environment.status === 'active')
          setSessionForm((current) => ({
            ...current,
            agentId: agentId || current.agentId || activeAgent?.id || '',
            environmentId: current.environmentId || activeEnvironment?.id || '',
          }))
          setCreateMode('session')
        },
      }
    : null

  return {
    authQuery,
    contextValue,
    createSheetProps: {
      mode: createMode,
      onOpenChange: (open: boolean) => !open && setCreateMode(null),
      environmentForm,
      setEnvironmentForm,
      agentForm,
      setAgentForm,
      sessionForm,
      setSessionForm,
      providerForm,
      setProviderForm,
      vaultForm,
      setVaultForm,
      agents,
      environments,
      submitEnvironment: submit(createEnvironment.mutate),
      submitAgent: submit(createAgent.mutate),
      submitSession: submit(createSession.mutate),
      submitProvider: submit(createProvider.mutate),
      submitVault: submit(createVault.mutate),
    } satisfies CreateResourceSheetProps,
  }
}

function submit(action: () => void) {
  return (event: FormEvent) => {
    event.preventDefault()
    action()
  }
}
