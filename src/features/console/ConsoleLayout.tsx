import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Boxes,
  Code2,
  LogOut,
  MessageSquare,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Banner, DisabledNav, FullscreenMessage, MobileNavButton, NavButton } from '@/console/components'
import { emptyAgent, emptyEnvironment } from '@/console/defaults'
import { matchesSearch, parsePackages, parseTools, parseVariables, titleForView, viewFromPath } from '@/console/format'
import { AgentForm, EnvironmentForm } from '@/console/forms'
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
  const [runtimeTranscript, setRuntimeTranscript] = useState('')
  const [createMode, setCreateMode] = useState<CreateMode>(null)
  const [environmentForm, setEnvironmentForm] = useState(emptyEnvironment)
  const [agentForm, setAgentForm] = useState(emptyAgent)
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
      const [agents, environments, sessions] = await Promise.all([
        api.listAgents(includeArchived),
        api.listEnvironments(includeArchived),
        api.listSessions(includeArchived),
      ])
      return {
        agents: agents.data,
        environments: environments.data,
        sessions: sessions.data,
      }
    },
    enabled: authQuery.isSuccess,
  })

  const agents = resourcesQuery.data?.agents ?? []
  const environments = resourcesQuery.data?.environments ?? []
  const sessions = resourcesQuery.data?.sessions ?? []
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null

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

  const visibleAgents = useMemo(
    () => agents.filter((agent) => matchesSearch([agent.name, agent.description, agent.model, agent.provider], query)),
    [agents, query],
  )
  const visibleEnvironments = useMemo(
    () =>
      environments.filter((environment) =>
        matchesSearch(
          [environment.name, environment.description, environment.runtimeImage.image as string | undefined],
          query,
        ),
      ),
    [environments, query],
  )
  const visibleSessions = useMemo(
    () =>
      sessions.filter((session) =>
        matchesSearch([session.id, session.agentSnapshot.systemPrompt, session.status, session.modelProvider], query),
      ),
    [sessions, query],
  )

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

  const startSession = useMutation({
    mutationFn: api.startAgentSession,
    onSuccess: (session: Session) => {
      setSelectedSessionId(session.id)
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
    archiveAgent.isPending ||
    archiveEnvironment.isPending ||
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
        agents: visibleAgents,
        environments: visibleEnvironments,
        sessions: visibleSessions,
        selectedSession,
        selectedSessionId,
        setSelectedSessionId,
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
        archiveAgent: (id) => archiveAgent.mutate(id),
        archiveEnvironment: (id) => archiveEnvironment.mutate(id),
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
            <SheetTitle>{createMode === 'environment' ? 'Create Environment' : 'Create Agent'}</SheetTitle>
            <SheetDescription>
              {createMode === 'environment'
                ? 'Define a reusable runtime environment for future sessions.'
                : 'Define an agent profile and attach its default runtime environment.'}
            </SheetDescription>
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
          <DisabledNav icon={<ShieldCheck size={17} />} label="Providers" />
          <DisabledNav icon={<Boxes size={17} />} label="Vaults" />
          <DisabledNav icon={<Code2 size={17} />} label="Usage" />
          <DisabledNav icon={<Settings size={17} />} label="Settings" />
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
