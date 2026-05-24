import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Boxes,
  Code2,
  DatabaseZap,
  LogOut,
  MessageSquare,
  PlugZap,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Vault,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Banner, FullscreenMessage, MobileNavButton, NavButton } from '@/console/components'
import { emptyAgent, emptyEnvironment, emptyProvider, emptyVault } from '@/console/defaults'
import { parsePackages, parseTools, parseVariables, titleForView, viewFromPath } from '@/console/format'
import { AgentForm, EnvironmentForm, ProviderForm, VaultForm } from '@/console/forms'
import type { CreateMode } from '@/console/types'
import { ApiError, api, type Session } from '@/lib/api'
import { ConsoleContextProvider, useConsoleContext } from './console-context'

const resourcesQueryKey = (includeArchived: boolean) => ['console', 'resources', includeArchived] as const

export function ConsoleLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const view = viewFromPath(location.pathname) ?? 'agents'
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedSessions, setSelectedSessions] = useState<Record<string, Session>>({})
  const [runtimeTranscript, setRuntimeTranscript] = useState('')
  const [createMode, setCreateMode] = useState<CreateMode>(null)
  const [environmentForm, setEnvironmentForm] = useState(emptyEnvironment)
  const [agentForm, setAgentForm] = useState(emptyAgent)
  const [providerForm, setProviderForm] = useState(emptyProvider)
  const [vaultForm, setVaultForm] = useState(emptyVault)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>('')
  const [taskMessage, setTaskMessage] = useState('Create ama-task.txt with exactly: AMA task completed')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const agents = resourcesQuery.data?.agents ?? []
  const environments = resourcesQuery.data?.environments ?? []
  const sessions = resourcesQuery.data?.sessions ?? []
  const providers = resourcesQuery.data?.providers ?? []
  const vaults = resourcesQuery.data?.vaults ?? []
  const mcpConnectors = resourcesQuery.data?.mcpConnectors ?? []
  const mcpConnections = resourcesQuery.data?.mcpConnections ?? []
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

  useEffect(() => {
    setSelectedSessionId((current) => current ?? sessions[0]?.id ?? null)
  }, [sessions])

  useEffect(() => {
    setSelectedEnvironmentId((current) => current || environments[0]?.id || '')
  }, [environments])

  useEffect(() => {
    const authError = authQuery.error
    if (authError instanceof ApiError && authError.status === 401) {
      return
    }
    const nextError = authError ?? resourcesQuery.error ?? eventsQuery.error
    setError(nextError instanceof Error ? nextError.message : nextError ? String(nextError) : null)
  }, [authQuery.error, resourcesQuery.error, eventsQuery.error])

  const invalidateResources = () => {
    void queryClient.invalidateQueries({ queryKey: ['console', 'resources'] })
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
      setSelectedEnvironmentId(environment.id)
      setCreateMode(null)
      setNotice('Environment created')
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
        allowedTools: parseTools(agentForm.allowedTools),
        sandboxPolicy: { network: 'enabled', filesystem: 'workspace' },
        defaultEnvironmentId: selectedEnvironmentId || null,
      }),
    onSuccess: () => {
      setCreateMode(null)
      setNotice('Agent created')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const createProvider = useMutation({
    mutationFn: () => {
      const input = {
        type: providerForm.type,
        displayName: providerForm.displayName,
        ...(providerForm.baseUrl ? { baseUrl: providerForm.baseUrl } : {}),
        ...(providerForm.credentialSecretRef ? { credentialSecretRef: providerForm.credentialSecretRef } : {}),
      }
      return api.createProvider(input)
    },
    onSuccess: () => {
      setCreateMode(null)
      setNotice('Provider created')
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
      setNotice('Vault created')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const archiveAgent = useMutation({
    mutationFn: api.archiveAgent,
    onSuccess: () => {
      setNotice('Agent archived')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const archiveEnvironment = useMutation({
    mutationFn: api.archiveEnvironment,
    onSuccess: () => {
      setNotice('Environment archived')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const archiveProvider = useMutation({
    mutationFn: api.archiveProvider,
    onSuccess: () => {
      setNotice('Provider deleted')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const archiveVault = useMutation({
    mutationFn: api.archiveVault,
    onSuccess: () => {
      setNotice('Vault archived')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const disconnectMcpConnection = useMutation({
    mutationFn: api.disconnectMcpConnection,
    onSuccess: () => {
      setNotice('MCP connection disconnected')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const startSession = useMutation({
    mutationFn: api.startAgentSession,
    onSuccess: (session: Session) => {
      setSelectedSessionId(session.id)
      setSelectedSessions((current) => ({ ...current, [session.id]: session }))
      setNotice('Session started')
      invalidateResources()
      void navigate('/sessions')
    },
    onError: setMutationError,
  })

  const stopSession = useMutation({
    mutationFn: api.stopSession,
    onSuccess: () => {
      setNotice('Session stopped')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const archiveSession = useMutation({
    mutationFn: api.archiveSession,
    onSuccess: () => {
      setNotice('Session archived')
      invalidateResources()
    },
    onError: setMutationError,
  })

  const sendTask = useMutation({
    mutationFn: async () => {
      if (!selectedSession) {
        return ''
      }
      await api.sendRuntimeTask(selectedSession, taskMessage)
      return await api.readRuntimeEvents(selectedSession)
    },
    onSuccess: (transcript) => {
      setRuntimeTranscript(transcript)
      setNotice('Task sent to runtime')
      void queryClient.invalidateQueries({ queryKey: ['sessions', selectedSession?.id, 'events'] })
      invalidateResources()
    },
    onError: setMutationError,
  })

  function setMutationError(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  const busy =
    resourcesQuery.isFetching ||
    createEnvironment.isPending ||
    createAgent.isPending ||
    createProvider.isPending ||
    createVault.isPending ||
    archiveAgent.isPending ||
    archiveEnvironment.isPending ||
    archiveProvider.isPending ||
    archiveVault.isPending ||
    disconnectMcpConnection.isPending ||
    startSession.isPending ||
    stopSession.isPending ||
    archiveSession.isPending ||
    sendTask.isPending

  if (authQuery.isLoading) {
    return <FullscreenMessage title="Loading console" body="Checking session and project context." />
  }

  if (authQuery.error instanceof ApiError && authQuery.error.status === 401) {
    const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
    return (
      <FullscreenMessage
        title="Any Managed Agents"
        body="Sign in through FlareAuth to open the control plane."
        action={
          <Button asChild size="lg">
            <a href={`/api/auth/login?returnTo=${returnTo}`}>Continue with FlareAuth</a>
          </Button>
        }
      />
    )
  }

  if (!authQuery.data) {
    return <FullscreenMessage title="Console unavailable" body="Unable to load the current project context." />
  }

  return (
    <ConsoleContextProvider
      value={{
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
        runtimeTranscript,
        taskMessage,
        setTaskMessage,
        notice,
        error,
        busy,
        refresh: () => {
          setNotice(null)
          setError(null)
          invalidateResources()
        },
        openCreateAgent: () => setCreateMode('agent'),
        openCreateEnvironment: () => setCreateMode('environment'),
        openCreateProvider: () => setCreateMode('provider'),
        openCreateVault: () => setCreateMode('vault'),
        archiveAgent: (id) => archiveAgent.mutate(id),
        archiveEnvironment: (id) => archiveEnvironment.mutate(id),
        archiveProvider: (id) => archiveProvider.mutate(id),
        archiveVault: (id) => archiveVault.mutate(id),
        disconnectMcpConnection: (id) => disconnectMcpConnection.mutate(id),
        startSession: (id) => startSession.mutate(id),
        stopSession: (id) => stopSession.mutate(id),
        archiveSession: (id) => archiveSession.mutate(id),
        refreshEvents: () =>
          void queryClient.invalidateQueries({ queryKey: ['sessions', selectedSession?.id, 'events'] }),
        sendTask: () => sendTask.mutate(),
      }}
    >
      <ConsoleShell>
        <Outlet />
      </ConsoleShell>
      <Sheet open={createMode !== null} onOpenChange={(open) => !open && setCreateMode(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{createSheetCopy(createMode).title}</SheetTitle>
            <SheetDescription>{createSheetCopy(createMode).description}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {createMode === 'environment' ? (
              <EnvironmentForm
                value={environmentForm}
                setValue={setEnvironmentForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  createEnvironment.mutate()
                }}
              />
            ) : null}
            {createMode === 'agent' ? (
              <AgentForm
                value={agentForm}
                setValue={setAgentForm}
                environments={environments}
                selectedEnvironmentId={selectedEnvironmentId}
                setSelectedEnvironmentId={setSelectedEnvironmentId}
                onSubmit={(event) => {
                  event.preventDefault()
                  createAgent.mutate()
                }}
              />
            ) : null}
            {createMode === 'provider' ? (
              <ProviderForm
                value={providerForm}
                setValue={setProviderForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  createProvider.mutate()
                }}
              />
            ) : null}
            {createMode === 'vault' ? (
              <VaultForm
                value={vaultForm}
                setValue={setVaultForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  createVault.mutate()
                }}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </ConsoleContextProvider>
  )
}

function ConsoleShell({ children }: { children: React.ReactNode }) {
  const context = useConsoleContextForShell()
  return (
    <main className="min-h-screen bg-muted/40 text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background px-4 py-5 lg:block">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Any Managed Agents</p>
            <p className="truncate text-xs text-muted-foreground">{context.auth.project.name}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          <NavButton
            icon={<Code2 size={17} />}
            active={context.view === 'quickstart'}
            to="/quickstart"
            label="Quickstart"
          />
          <NavButton icon={<Bot size={17} />} active={context.view === 'agents'} to="/agents" label="Agents" />
          <NavButton
            icon={<Server size={17} />}
            active={context.view === 'environments'}
            to="/environments"
            label="Environments"
          />
          <NavButton
            icon={<MessageSquare size={17} />}
            active={context.view === 'sessions'}
            to="/sessions"
            label="Sessions"
          />
          <NavButton
            icon={<ShieldCheck size={17} />}
            active={context.view === 'providers'}
            to="/providers"
            label="Providers"
          />
          <NavButton icon={<Vault size={17} />} active={context.view === 'vaults'} to="/vaults" label="Vaults" />
          <NavButton icon={<PlugZap size={17} />} active={context.view === 'mcp'} to="/mcp" label="MCP" />
          <NavButton icon={<Code2 size={17} />} active={context.view === 'usage'} to="/usage" label="Usage" />
          <NavButton icon={<DatabaseZap size={17} />} active={context.view === 'audit'} to="/audit" label="Audit" />
          <NavButton
            icon={<Settings size={17} />}
            active={context.view === 'settings'}
            to="/settings"
            label="Settings"
          />
        </nav>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium uppercase text-muted-foreground">
                {context.auth.organization.name}
              </p>
              <h1 className="text-xl font-medium">{titleForView(context.view)}</h1>
            </div>
            <nav className="flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Primary">
              <MobileNavButton
                icon={<Code2 size={16} />}
                active={context.view === 'quickstart'}
                to="/quickstart"
                label="Quickstart"
              />
              <MobileNavButton
                icon={<Bot size={16} />}
                active={context.view === 'agents'}
                to="/agents"
                label="Agents"
              />
              <MobileNavButton
                icon={<Server size={16} />}
                active={context.view === 'environments'}
                to="/environments"
                label="Environments"
              />
              <MobileNavButton
                icon={<MessageSquare size={16} />}
                active={context.view === 'sessions'}
                to="/sessions"
                label="Sessions"
              />
              <MobileNavButton
                icon={<ShieldCheck size={16} />}
                active={context.view === 'providers'}
                to="/providers"
                label="Providers"
              />
              <MobileNavButton
                icon={<Vault size={16} />}
                active={context.view === 'vaults'}
                to="/vaults"
                label="Vaults"
              />
              <MobileNavButton icon={<PlugZap size={16} />} active={context.view === 'mcp'} to="/mcp" label="MCP" />
              <MobileNavButton icon={<Code2 size={16} />} active={context.view === 'usage'} to="/usage" label="Usage" />
              <MobileNavButton
                icon={<DatabaseZap size={16} />}
                active={context.view === 'audit'}
                to="/audit"
                label="Audit"
              />
              <MobileNavButton
                icon={<Settings size={16} />}
                active={context.view === 'settings'}
                to="/settings"
                label="Settings"
              />
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-2 text-muted-foreground" size={16} />
                <Input
                  aria-label="Search"
                  className="h-8 w-72 max-w-full pl-9"
                  placeholder="Search"
                  value={context.query}
                  onChange={(event) => context.setQuery(event.target.value)}
                />
              </div>
              <div className="flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 text-sm">
                <Checkbox
                  id="include-archived"
                  checked={context.includeArchived}
                  onCheckedChange={(checked) => context.setIncludeArchived(checked === true)}
                />
                <label htmlFor="include-archived">Archived</label>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={context.refresh} aria-label="Refresh">
                <RefreshCw size={16} className={context.busy ? 'animate-spin' : undefined} />
              </Button>
              {context.view === 'environments' ? (
                <Button type="button" onClick={context.openCreateEnvironment}>
                  <Server size={16} />
                  Create environment
                </Button>
              ) : null}
              {context.view === 'agents' ? (
                <Button type="button" onClick={context.openCreateAgent}>
                  <Bot size={16} />
                  Create agent
                </Button>
              ) : null}
              {context.view === 'providers' ? (
                <Button type="button" onClick={context.openCreateProvider}>
                  <ShieldCheck size={16} />
                  Create provider
                </Button>
              ) : null}
              {context.view === 'vaults' ? (
                <Button type="button" onClick={context.openCreateVault}>
                  <Boxes size={16} />
                  Create vault
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void api.logout().then(() => window.location.assign('/agents'))}
                aria-label="Log out"
              >
                <LogOut size={16} />
              </Button>
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-8">
          <section className="mx-auto max-w-6xl space-y-4">
            {context.notice ? <Banner tone="success" message={context.notice} /> : null}
            {context.error ? <Banner tone="error" message={context.error} /> : null}
            {children}
          </section>
        </div>
      </section>
    </main>
  )
}

function useConsoleContextForShell() {
  return useConsoleContext()
}

function createSheetCopy(mode: CreateMode) {
  if (mode === 'environment') {
    return {
      title: 'Create Environment',
      description: 'Define a reusable runtime environment for future sessions.',
    }
  }
  if (mode === 'provider') {
    return {
      title: 'Create Provider',
      description: 'Register a model provider without exposing raw credentials.',
    }
  }
  if (mode === 'vault') {
    return {
      title: 'Create Vault',
      description: 'Create safe credential-reference metadata for runtime integrations.',
    }
  }
  return {
    title: 'Create Agent',
    description: 'Define an agent profile and attach its default runtime environment.',
  }
}
