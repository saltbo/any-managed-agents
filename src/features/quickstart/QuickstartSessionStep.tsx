import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Play, ShieldCheck } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Meta, MetaGrid, StatusBadge } from '@/console/components'
import { stringifyJson } from '@/console/format'
import { useSessionRuntimeSession } from '@/features/sessions/use-session-runtime'
import { type Agent, api, type Environment } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { OpenPageLink } from './QuickstartSteps'
import { agentHasSandboxExecution, SAFE_EXAMPLE_PROMPT, sandboxAgentInput } from './quickstart-model'

export function QuickstartSessionStep({
  agent,
  environment,
  sessionId,
  onSessionCreated,
  onContinue,
}: {
  agent: Agent | null
  environment: Environment | null
  sessionId: string | null
  onSessionCreated: (sessionId: string) => void
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const sandboxEnabled = agent !== null && agentHasSandboxExecution(agent)

  const enableSandbox = useMutation({
    mutationFn: () => {
      /* v8 ignore start -- button is disabled when agent is null; guard is defensive */
      if (!agent) throw new Error('Create an agent before enabling sandbox execution')
      /* v8 ignore stop */
      return api.updateAgent(agent.metadata.uid, sandboxAgentInput(agent))
    },
    onSuccess: async () => {
      toast.success('Sandbox execution enabled')
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
    },
    /* v8 ignore start -- error is always an Error instance in practice */
    onError: (error) => toast.error(errorMessage(error)),
    /* v8 ignore stop */
  })

  const createSession = useMutation({
    mutationFn: () => {
      /* v8 ignore start -- button is disabled when agent or environment is null; guard is defensive */
      if (!agent || !environment) throw new Error('Quickstart needs an active agent and environment first')
      /* v8 ignore stop */
      return api.createSession({
        agentId: agent.metadata.uid,
        environmentId: environment.metadata.uid,
        runtime: 'ama',
        prompt: SAFE_EXAMPLE_PROMPT,
      })
    },
    onSuccess: async (session) => {
      toast.success('Test session created')
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
      onSessionCreated(session.metadata.uid)
    },
    /* v8 ignore start -- error is always an Error instance in practice */
    onError: (error) => toast.error(errorMessage(error)),
    /* v8 ignore stop */
  })

  return (
    <div className="grid gap-4">
      <MetaGrid>
        <Meta
          label="Agent"
          value={
            agent ? `${agent.metadata.name} · ${agent.metadata.uid} · v${agent.status.version}` : 'No active agent yet'
          }
        />
        <Meta
          label="Environment"
          value={
            environment ? `${environment.metadata.name} · ${environment.metadata.uid}` : 'No active environment yet'
          }
        />
      </MetaGrid>
      <div className="grid gap-2 rounded-md bg-muted/40 p-3">
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!agent || sandboxEnabled || enableSandbox.isPending}
            onClick={() => enableSandbox.mutate()}
          >
            <ShieldCheck data-icon="inline-start" />
            {sandboxEnabled ? 'Sandbox execution enabled' : 'Add sandbox execution'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Updates the agent so sessions may run approved commands in Cloudflare Sandbox: sandbox.* tools are allowed and
          carried skills are mounted into the workspace. Applies to sessions created afterwards.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={!agent || !environment || createSession.isPending}
          onClick={() => createSession.mutate()}
        >
          <Play data-icon="inline-start" />
          {createSession.isPending
            ? 'Creating test session'
            : sessionId
              ? 'Create new test session'
              : 'Create test session'}
        </Button>
        <Button type="button" variant="outline" disabled={!sessionId} onClick={onContinue}>
          Continue to integration
        </Button>
        <OpenPageLink to="/sessions" label="Open sessions" />
      </div>
      {sessionId ? <QuickstartSessionPreview key={sessionId} sessionId={sessionId} /> : null}
    </div>
  )
}

function QuickstartSessionPreview({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState(SAFE_EXAMPLE_PROMPT)

  const sessionQuery = useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: () => api.readSession(sessionId),
    refetchInterval: (query) =>
      query.state.data && ['pending', 'running'].includes(query.state.data.status.phase) ? 750 : false,
  })
  const eventsQuery = useQuery({
    queryKey: queryKeys.sessions.events(sessionId),
    queryFn: () => api.listSessionEvents(sessionId, { limit: 200, order: 'asc' }),
    refetchInterval: (query) => {
      const hasAssistantMessage = (query.state.data?.data ?? []).some((event) => event.type === 'message_end')
      const state = sessionQuery.data?.status.phase
      const terminal = state !== undefined && !['pending', 'running'].includes(state)
      return terminal && hasAssistantMessage ? false : 1000
    },
  })
  const connectionQuery = useQuery({
    queryKey: ['sessions', 'detail', sessionId, 'connection'],
    queryFn: () => api.readSessionConnection(sessionId),
    enabled: sessionQuery.data?.status.phase === 'idle' || sessionQuery.data?.status.phase === 'running',
  })
  const onEventsChanged = useCallback(() => {
    /* v8 ignore start -- called by the runtime hook which is mocked in tests */
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.events(sessionId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) })
    /* v8 ignore stop */
  }, [queryClient, sessionId])
  const runtime = useSessionRuntimeSession({
    session: sessionQuery.data ?? null,
    events: eventsQuery.data?.data ?? [],
    onEventsChanged,
  })
  const session = sessionQuery.data ?? null
  if (!session) {
    return <p className="text-sm text-muted-foreground">Loading the quickstart session preview.</p>
  }

  const sendPrompt = () => {
    const message = prompt.trim()
    /* v8 ignore start -- Send button is disabled when prompt is empty; guard is defensive */
    if (!message) return
    /* v8 ignore stop */
    if (runtime.sendPrompt(message)) {
      setPrompt('')
    }
  }
  const busy = runtime.state.runState === 'running'
  const transcriptItems = [
    ...runtime.state.messages.map((message) => ({ type: 'message' as const, at: message.createdAt, message })),
    ...runtime.state.tools.map((tool) => ({ type: 'tool' as const, at: tool.createdAt, tool })),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Session preview</span>
        <StatusBadge value={session.status.phase} detail={session.status.reason} />
        <OpenPageLink to={`/sessions/${session.metadata.uid}`} label="Open session detail" />
      </div>
      <MetaGrid>
        <Meta label="Session id" value={session.metadata.uid} />
        <Meta label="Runtime endpoint" value={connectionQuery.data?.path ?? 'Pending runtime endpoint'} />
      </MetaGrid>
      <Tabs defaultValue="transcript">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="debug">Debug</TabsTrigger>
        </TabsList>
        <TabsContent value="transcript" className="mt-2">
          {transcriptItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet. Send the first task below.</p>
          ) : (
            <ul className="grid gap-2" aria-label="Quickstart session transcript">
              {transcriptItems.map((item) =>
                item.type === 'message' ? (
                  <li key={`message:${item.message.id}`} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <p className="text-xs font-medium uppercase text-muted-foreground">{item.message.role}</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">{item.message.content}</p>
                  </li>
                ) : (
                  <li key={`tool:${item.tool.id}`} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Tool {item.tool.name} · {item.tool.status}
                    </p>
                  </li>
                ),
              )}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="debug" className="mt-2">
          {runtime.state.debugEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Runtime diagnostics appear here as the agent runs.</p>
          ) : (
            <ul className="grid gap-2" aria-label="Quickstart session debug events">
              {runtime.state.debugEvents.map((event) => (
                <li key={event.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={event.type} />
                    <span className="font-mono text-xs text-muted-foreground">{event.id}</span>
                  </div>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                    {stringifyJson(event.payload)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <Field>
        <FieldLabel htmlFor="quickstart-first-task">First task</FieldLabel>
        <Textarea
          id="quickstart-first-task"
          // The composer is the next action after creating the session, so it
          // receives focus with a safe example prompt ready to send.
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <FieldDescription>
          A safe example prompt is prefilled. Sending streams runtime events into the preview without a page reload.
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={runtime.state.connection !== 'open' || busy || !prompt.trim()}
          onClick={sendPrompt}
        >
          <MessageSquare data-icon="inline-start" />
          {busy ? 'Agent is running' : 'Send first task'}
        </Button>
        <span className="text-xs capitalize text-muted-foreground">Runtime connection: {runtime.state.connection}</span>
      </div>
    </div>
  )
}
