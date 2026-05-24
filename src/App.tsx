import {
  Archive,
  Bot,
  Boxes,
  CircleStop,
  Code2,
  LogOut,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  type Agent,
  ApiError,
  type AuthContext,
  api,
  type Environment,
  type Session,
  type SessionEvent,
} from './lib/api'

type View = 'agents' | 'environments' | 'sessions'
type LoadState = 'loading' | 'ready' | 'signed-out'

const emptyEnvironment = {
  name: 'Node workspace',
  description: 'Default workspace for Pi-backed coding sessions.',
  packages: 'tsx@latest\ntypescript@latest',
  variables: 'NODE_ENV=development',
  runtimeImage: 'node:24',
}

const emptyAgent = {
  name: 'Coding agent',
  description: 'Executes development tasks in a managed sandbox.',
  instructions: 'You are a focused coding agent. Make changes, run checks, and report the result.',
  allowedTools: 'read\nwrite\nshell',
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'None'
}

function parsePackages(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, version] = line.split('@')
      return version ? { name: name ?? line, version } : { name: line }
    })
}

function parseVariables(value: string) {
  return Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, description] = line.split('=')
        return [key ?? line, { description: description ?? '', required: false }]
      }),
  )
}

function parseTools(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function statusClass(status: string) {
  if (status === 'active' || status === 'idle' || status === 'running') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (status === 'error') {
    return 'border-red-200 bg-red-50 text-red-700'
  }
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function matchesSearch(fields: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase()
  return !normalized || fields.some((field) => field?.toLowerCase().includes(normalized))
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [auth, setAuth] = useState<AuthContext | null>(null)
  const [view, setView] = useState<View>('agents')
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([])
  const [runtimeTranscript, setRuntimeTranscript] = useState('')
  const [environmentForm, setEnvironmentForm] = useState(emptyEnvironment)
  const [agentForm, setAgentForm] = useState(emptyAgent)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>('')
  const [taskMessage, setTaskMessage] = useState('Create ama-task.txt with exactly: AMA task completed')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null

  const loadAll = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) {
        setBusy(true)
      }
      setError(null)
      try {
        const [authContext, agentList, environmentList, sessionList] = await Promise.all([
          api.me(),
          api.listAgents(includeArchived),
          api.listEnvironments(includeArchived),
          api.listSessions(includeArchived),
        ])
        setAuth(authContext)
        setAgents(agentList.data)
        setEnvironments(environmentList.data)
        setSessions(sessionList.data)
        setSelectedSessionId((current) => current ?? sessionList.data[0]?.id ?? null)
        setLoadState('ready')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setLoadState('signed-out')
          return
        }
        setError(err instanceof Error ? err.message : String(err))
        setLoadState('ready')
      } finally {
        setBusy(false)
      }
    },
    [includeArchived],
  )

  const loadEvents = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setSessionEvents([])
      setRuntimeTranscript('')
      return
    }
    try {
      const events = await api.listSessionEvents(sessionId)
      setSessionEvents(events.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    void loadEvents(selectedSession?.id ?? null)
  }, [selectedSession?.id, loadEvents])

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

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(success)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function createEnvironment(event: FormEvent) {
    event.preventDefault()
    void runAction(async () => {
      const environment = await api.createEnvironment({
        name: environmentForm.name,
        description: environmentForm.description,
        packages: parsePackages(environmentForm.packages),
        variables: parseVariables(environmentForm.variables),
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
        runtimeImage: { image: environmentForm.runtimeImage },
      })
      setSelectedEnvironmentId(environment.id)
    }, 'Environment created')
  }

  function createAgent(event: FormEvent) {
    event.preventDefault()
    void runAction(async () => {
      await api.createAgent({
        name: agentForm.name,
        description: agentForm.description,
        instructions: agentForm.instructions,
        systemPrompt: agentForm.instructions,
        allowedTools: parseTools(agentForm.allowedTools),
        sandboxPolicy: { network: 'enabled', filesystem: 'workspace' },
        defaultEnvironmentId: selectedEnvironmentId || null,
      })
    }, 'Agent created')
  }

  function startSession(agentId: string) {
    void runAction(async () => {
      const session = await api.startAgentSession(agentId)
      setSelectedSessionId(session.id)
      setView('sessions')
    }, 'Session started')
  }

  function sendTask(event: FormEvent) {
    event.preventDefault()
    if (!selectedSession) {
      return
    }
    void runAction(async () => {
      await api.sendRuntimeTask(selectedSession, taskMessage)
      setRuntimeTranscript(await api.readRuntimeEvents(selectedSession))
      await loadEvents(selectedSession.id)
    }, 'Task sent to runtime')
  }

  if (loadState === 'loading') {
    return <FullscreenMessage title="Loading console" body="Checking session and project context." />
  }

  if (loadState === 'signed-out') {
    const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
    return (
      <FullscreenMessage
        title="Any Managed Agents"
        body="Sign in through FlareAuth to open the control plane."
        action={
          <a
            className="inline-flex h-10 items-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white"
            href={`/api/auth/login?returnTo=${returnTo}`}
          >
            Continue with FlareAuth
          </a>
        }
      />
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-slate-950 text-white">
            <Bot size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">Any Managed Agents</p>
            <p className="text-xs text-slate-500">{auth?.project.name ?? 'Project'}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          <NavButton
            icon={<Bot size={17} />}
            active={view === 'agents'}
            onClick={() => setView('agents')}
            label="Agents"
          />
          <NavButton
            icon={<Server size={17} />}
            active={view === 'environments'}
            onClick={() => setView('environments')}
            label="Environments"
          />
          <NavButton
            icon={<MessageSquare size={17} />}
            active={view === 'sessions'}
            onClick={() => setView('sessions')}
            label="Sessions"
          />
          <DisabledNav icon={<ShieldCheck size={17} />} label="Providers" />
          <DisabledNav icon={<Boxes size={17} />} label="Vaults" />
          <DisabledNav icon={<Code2 size={17} />} label="Usage" />
          <DisabledNav icon={<Settings size={17} />} label="Settings" />
        </nav>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-slate-500">{auth?.organization.name}</p>
              <h1 className="text-xl font-semibold">{titleForView(view)}</h1>
            </div>
            <nav className="grid grid-cols-3 gap-2 lg:hidden" aria-label="Primary">
              <MobileNavButton
                icon={<Bot size={16} />}
                active={view === 'agents'}
                onClick={() => setView('agents')}
                label="Agents"
              />
              <MobileNavButton
                icon={<Server size={16} />}
                active={view === 'environments'}
                onClick={() => setView('environments')}
                label="Environments"
              />
              <MobileNavButton
                icon={<MessageSquare size={16} />}
                active={view === 'sessions'}
                onClick={() => setView('sessions')}
                label="Sessions"
              />
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input
                  className="h-10 w-72 max-w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                  placeholder="Search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                />
                Archived
              </label>
              <button className="icon-button" type="button" onClick={() => void loadAll(true)} aria-label="Refresh">
                <RefreshCw size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => void api.logout().then(() => setLoadState('signed-out'))}
                aria-label="Log out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:p-8">
          <section className="space-y-4">
            {notice ? <Banner tone="success" message={notice} /> : null}
            {error ? <Banner tone="error" message={error} /> : null}
            {view === 'agents' ? (
              <AgentsView
                agents={visibleAgents}
                environments={environments}
                onStartSession={startSession}
                onArchive={(id) => void runAction(() => api.archiveAgent(id), 'Agent archived')}
              />
            ) : null}
            {view === 'environments' ? (
              <EnvironmentsView
                environments={visibleEnvironments}
                onArchive={(id) => void runAction(() => api.archiveEnvironment(id), 'Environment archived')}
              />
            ) : null}
            {view === 'sessions' ? (
              <SessionsView
                sessions={visibleSessions}
                selectedSession={selectedSession}
                events={sessionEvents}
                runtimeTranscript={runtimeTranscript}
                onSelect={setSelectedSessionId}
                onStop={(id) => void runAction(async () => void (await api.stopSession(id)), 'Session stopped')}
                onArchive={(id) => void runAction(() => api.archiveSession(id), 'Session archived')}
                onRefreshEvents={() => void loadEvents(selectedSession?.id ?? null)}
                taskMessage={taskMessage}
                setTaskMessage={setTaskMessage}
                onSendTask={sendTask}
              />
            ) : null}
          </section>

          <aside className="space-y-4">
            <WorkflowPanel agents={agents} environments={environments} sessions={sessions} busy={busy} />
            <EnvironmentForm value={environmentForm} setValue={setEnvironmentForm} onSubmit={createEnvironment} />
            <AgentForm
              value={agentForm}
              setValue={setAgentForm}
              environments={environments}
              selectedEnvironmentId={selectedEnvironmentId}
              setSelectedEnvironmentId={setSelectedEnvironmentId}
              onSubmit={createAgent}
            />
          </aside>
        </div>
      </section>
    </main>
  )
}

function titleForView(view: View) {
  return view === 'agents' ? 'Agents' : view === 'environments' ? 'Environments' : 'Sessions'
}

function FullscreenMessage({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-950">
      <section className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-lg bg-slate-950 text-white">
          <Bot size={24} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </section>
    </main>
  )
}

function NavButton({
  icon,
  active,
  onClick,
  label,
}: {
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${active ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function MobileNavButton({
  icon,
  active,
  onClick,
  label,
}: {
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      className={`inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-2 text-sm ${active ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function DisabledNav({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-slate-400">
      {icon}
      {label}
    </div>
  )
}

function Banner({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}
    >
      {message}
    </div>
  )
}

function WorkflowPanel({
  agents,
  environments,
  sessions,
  busy,
}: {
  agents: Agent[]
  environments: Environment[]
  sessions: Session[]
  busy: boolean
}) {
  const steps = [
    { label: 'Environment', done: environments.length > 0 },
    { label: 'Agent', done: agents.length > 0 },
    { label: 'Session', done: sessions.length > 0 },
    {
      label: 'Runtime ready',
      done: sessions.some((session) => session.status === 'idle' || session.status === 'running'),
    },
  ]
  return (
    <section className="panel">
      <div className="flex items-center justify-between">
        <h2 className="panel-title">Acceptance Path</h2>
        {busy ? <span className="text-xs text-slate-500">Working</span> : null}
      </div>
      <div className="mt-4 grid gap-2">
        {steps.map((step) => (
          <div
            key={step.label}
            className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <span>{step.label}</span>
            <span className={step.done ? 'text-emerald-700' : 'text-slate-400'}>{step.done ? 'Ready' : 'Pending'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function AgentsView({
  agents,
  environments,
  onStartSession,
  onArchive,
}: {
  agents: Agent[]
  environments: Environment[]
  onStartSession: (id: string) => void
  onArchive: (id: string) => void
}) {
  if (agents.length === 0) {
    return (
      <EmptyState title="No agents" body="Create an agent from the side panel, then start a session from this list." />
    )
  }
  return (
    <div className="grid gap-3">
      {agents.map((agent) => {
        const environment = environments.find((item) => item.id === agent.defaultEnvironmentId)
        return (
          <article className="item" key={agent.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold">{agent.name}</h2>
                <Badge value={agent.status} />
                <Badge value={`v${agent.version}`} />
              </div>
              <p className="mt-1 text-sm text-slate-600">{agent.description ?? 'No description'}</p>
              <dl className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                <Meta label="Model" value={`${agent.provider} / ${agent.model}`} />
                <Meta label="Environment" value={environment?.name ?? 'None'} />
                <Meta label="Tools" value={agent.allowedTools.join(', ') || 'None'} />
                <Meta label="Updated" value={formatDate(agent.updatedAt)} />
              </dl>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                className="icon-button"
                type="button"
                onClick={() => onStartSession(agent.id)}
                aria-label="Start session"
              >
                <Play size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => onArchive(agent.id)}
                aria-label="Archive agent"
              >
                <Archive size={16} />
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function EnvironmentsView({
  environments,
  onArchive,
}: {
  environments: Environment[]
  onArchive: (id: string) => void
}) {
  if (environments.length === 0) {
    return <EmptyState title="No environments" body="Create a runtime environment before creating an agent." />
  }
  return (
    <div className="grid gap-3">
      {environments.map((environment) => (
        <article className="item" key={environment.id}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{environment.name}</h2>
              <Badge value={environment.status} />
              <Badge value={`v${environment.version}`} />
            </div>
            <p className="mt-1 text-sm text-slate-600">{environment.description ?? 'No description'}</p>
            <dl className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
              <Meta
                label="Packages"
                value={
                  environment.packages
                    .map((item) => `${item.name}${item.version ? `@${item.version}` : ''}`)
                    .join(', ') || 'None'
                }
              />
              <Meta label="Variables" value={Object.keys(environment.variables).join(', ') || 'None'} />
              <Meta label="Secrets" value={environment.secretRefs.map((item) => item.name).join(', ') || 'None'} />
              <Meta label="Runtime image" value={String(environment.runtimeImage.image ?? 'Default')} />
              <Meta label="Network" value={stringifyJson(environment.networkPolicy)} />
              <Meta label="Limits" value={stringifyJson(environment.resourceLimits)} />
            </dl>
          </div>
          <button
            className="icon-button shrink-0"
            type="button"
            onClick={() => onArchive(environment.id)}
            aria-label="Archive environment"
          >
            <Archive size={16} />
          </button>
        </article>
      ))}
    </div>
  )
}

function SessionsView({
  sessions,
  selectedSession,
  events,
  runtimeTranscript,
  onSelect,
  onStop,
  onArchive,
  onRefreshEvents,
  taskMessage,
  setTaskMessage,
  onSendTask,
}: {
  sessions: Session[]
  selectedSession: Session | null
  events: SessionEvent[]
  runtimeTranscript: string
  onSelect: (id: string) => void
  onStop: (id: string) => void
  onArchive: (id: string) => void
  onRefreshEvents: () => void
  taskMessage: string
  setTaskMessage: (value: string) => void
  onSendTask: (event: FormEvent) => void
}) {
  if (sessions.length === 0) {
    return <EmptyState title="No sessions" body="Start a session from an active agent." />
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        {sessions.map((session) => (
          <button
            className={`rounded-md border p-3 text-left text-sm ${selectedSession?.id === session.id ? 'border-slate-950 bg-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            type="button"
            key={session.id}
            onClick={() => onSelect(session.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{session.agentSnapshot.systemPrompt ?? session.agentId}</span>
              <Badge value={session.status} />
            </div>
            <p className="mt-2 truncate text-xs text-slate-500">{session.id}</p>
          </button>
        ))}
      </div>

      {selectedSession ? (
        <article className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Session detail</h2>
              <p className="mt-1 break-all text-xs text-slate-500">{selectedSession.id}</p>
            </div>
            <div className="flex gap-2">
              <button className="icon-button" type="button" onClick={onRefreshEvents} aria-label="Refresh events">
                <RefreshCw size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => onStop(selectedSession.id)}
                aria-label="Stop session"
              >
                <CircleStop size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => onArchive(selectedSession.id)}
                aria-label="Archive session"
              >
                <Archive size={16} />
              </button>
            </div>
          </div>
          <dl className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
            <Meta label="Status" value={selectedSession.status} />
            <Meta
              label="Model"
              value={`${selectedSession.modelProvider} / ${String(selectedSession.modelConfig.model ?? 'default')}`}
            />
            <Meta label="Sandbox" value={selectedSession.sandboxId ?? 'None'} />
            <Meta label="Runtime endpoint" value={selectedSession.runtimeEndpointPath} />
            <Meta label="Started" value={formatDate(selectedSession.startedAt)} />
            <Meta label="Stopped" value={formatDate(selectedSession.stoppedAt)} />
          </dl>
          {selectedSession.statusReason ? <Banner tone="error" message={selectedSession.statusReason} /> : null}
          <form className="mt-4 space-y-2" onSubmit={onSendTask}>
            <label className="field-label" htmlFor="runtime-task">
              Task
            </label>
            <textarea
              id="runtime-task"
              className="textarea min-h-24"
              value={taskMessage}
              onChange={(event) => setTaskMessage(event.target.value)}
            />
            <button className="button-primary" type="submit">
              <Send size={16} />
              Send task
            </button>
          </form>
          <div className="mt-5 grid gap-3">
            <h3 className="text-sm font-semibold">Transcript and runtime events</h3>
            {runtimeTranscript ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-950 p-3 text-xs text-slate-100">
                {runtimeTranscript}
              </pre>
            ) : null}
            {events.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                No persisted events yet.
              </p>
            ) : (
              events.map((event) => (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={event.id}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge value={`#${event.sequence}`} />
                    <Badge value={event.type} />
                    <Badge value={event.visibility} />
                    <span className="text-slate-500">{formatDate(event.createdAt)}</span>
                  </div>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                    {stringifyJson(event.payload)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </article>
      ) : null}
    </div>
  )
}

function EnvironmentForm({
  value,
  setValue,
  onSubmit,
}: {
  value: typeof emptyEnvironment
  setValue: (value: typeof emptyEnvironment) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="panel space-y-3" onSubmit={onSubmit}>
      <h2 className="panel-title">Create Environment</h2>
      <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
      <TextField
        label="Description"
        value={value.description}
        onChange={(description) => setValue({ ...value, description })}
      />
      <TextAreaField
        label="Packages"
        value={value.packages}
        onChange={(packages) => setValue({ ...value, packages })}
      />
      <TextAreaField
        label="Variables"
        value={value.variables}
        onChange={(variables) => setValue({ ...value, variables })}
      />
      <TextField
        label="Runtime image"
        value={value.runtimeImage}
        onChange={(runtimeImage) => setValue({ ...value, runtimeImage })}
      />
      <button className="button-primary" type="submit">
        <Server size={16} />
        Create environment
      </button>
    </form>
  )
}

function AgentForm({
  value,
  setValue,
  environments,
  selectedEnvironmentId,
  setSelectedEnvironmentId,
  onSubmit,
}: {
  value: typeof emptyAgent
  setValue: (value: typeof emptyAgent) => void
  environments: Environment[]
  selectedEnvironmentId: string
  setSelectedEnvironmentId: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="panel space-y-3" onSubmit={onSubmit}>
      <h2 className="panel-title">Create Agent</h2>
      <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
      <TextField
        label="Description"
        value={value.description}
        onChange={(description) => setValue({ ...value, description })}
      />
      <TextAreaField
        label="Instructions"
        value={value.instructions}
        onChange={(instructions) => setValue({ ...value, instructions })}
      />
      <TextAreaField
        label="Allowed Pi tools"
        value={value.allowedTools}
        onChange={(allowedTools) => setValue({ ...value, allowedTools })}
      />
      <label className="grid gap-1">
        <span className="field-label">Default environment</span>
        <select
          className="input"
          value={selectedEnvironmentId}
          onChange={(event) => setSelectedEnvironmentId(event.target.value)}
        >
          <option value="">None</option>
          {environments
            .filter((environment) => environment.status === 'active')
            .map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
        </select>
      </label>
      <button className="button-primary" type="submit">
        <Bot size={16} />
        Create agent
      </button>
    </form>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="field-label">{label}</span>
      <input className="input" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1">
      <span className="field-label">{label}</span>
      <textarea className="textarea" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(value)}`}>{value}</span>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[11px] text-slate-800">{value}</dd>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="grid min-h-64 place-items-center rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{body}</p>
      </div>
    </section>
  )
}
