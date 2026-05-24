import { Archive, CircleStop, Play, RefreshCw, Send } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { Agent, Environment, Session, SessionEvent } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Banner, ConfirmAction, EmptyState, Meta, StatusBadge } from './components'
import { formatDate, stringifyJson } from './format'

export function AgentsView({
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
    return <EmptyState title="No agents" body="Create an agent, then start a session from this list." />
  }
  return (
    <div className="grid gap-3">
      {agents.map((agent) => {
        const environment = environments.find((item) => item.id === agent.defaultEnvironmentId)
        return (
          <Card size="sm" key={agent.id}>
            <CardHeader>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="truncate">{agent.name}</CardTitle>
                  <StatusBadge value={agent.status} />
                  <StatusBadge value={`v${agent.version}`} />
                </div>
                <CardDescription>{agent.description ?? 'No description'}</CardDescription>
              </div>
              <CardAction className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onStartSession(agent.id)}
                  aria-label="Start session"
                >
                  <Play size={16} />
                </Button>
                <ConfirmAction
                  title="Archive agent?"
                  description={`Archive ${agent.name}. Existing active sessions are not deleted, but this agent will leave the active list.`}
                  confirmLabel="Archive agent"
                  destructive
                  onConfirm={() => onArchive(agent.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive agent">
                    <Archive size={16} />
                  </Button>
                </ConfirmAction>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-xs md:grid-cols-2">
                <Meta label="Model" value={`${agent.provider} / ${agent.model}`} />
                <Meta label="Environment" value={environment?.name ?? 'None'} />
                <Meta label="Tools" value={agent.allowedTools.join(', ') || 'None'} />
                <Meta label="Updated" value={formatDate(agent.updatedAt)} />
              </dl>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function EnvironmentsView({
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
        <Card size="sm" key={environment.id}>
          <CardHeader>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate">{environment.name}</CardTitle>
                <StatusBadge value={environment.status} />
                <StatusBadge value={`v${environment.version}`} />
              </div>
              <CardDescription>{environment.description ?? 'No description'}</CardDescription>
            </div>
            <CardAction>
              <ConfirmAction
                title="Archive environment?"
                description={`Archive ${environment.name}. Agents can no longer start new sessions with this environment.`}
                confirmLabel="Archive environment"
                destructive
                onConfirm={() => onArchive(environment.id)}
              >
                <Button type="button" variant="outline" size="icon" aria-label="Archive environment">
                  <Archive size={16} />
                </Button>
              </ConfirmAction>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-xs md:grid-cols-2">
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
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function SessionsView({
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
          <Button
            className={cn(
              'h-auto justify-start whitespace-normal p-3 text-left',
              selectedSession?.id === session.id && 'ring-2 ring-ring',
            )}
            type="button"
            variant="outline"
            key={session.id}
            onClick={() => onSelect(session.id)}
          >
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{session.agentSnapshot.systemPrompt ?? session.agentId}</span>
                <StatusBadge value={session.status} />
              </span>
              <span className="truncate text-xs text-muted-foreground">{session.id}</span>
            </span>
          </Button>
        ))}
      </div>

      {selectedSession ? (
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Session detail</CardTitle>
              <CardDescription className="break-all">{selectedSession.id}</CardDescription>
            </div>
            <CardAction className="flex gap-2">
              <Button type="button" variant="outline" size="icon" onClick={onRefreshEvents} aria-label="Refresh events">
                <RefreshCw size={16} />
              </Button>
              <ConfirmAction
                title="Stop session?"
                description="Stop the selected runtime session. In-flight work may be interrupted."
                confirmLabel="Stop session"
                destructive
                onConfirm={() => onStop(selectedSession.id)}
              >
                <Button type="button" variant="outline" size="icon" aria-label="Stop session">
                  <CircleStop size={16} />
                </Button>
              </ConfirmAction>
              <ConfirmAction
                title="Archive session?"
                description="Archive the selected session from active operations while preserving its persisted events."
                confirmLabel="Archive session"
                destructive
                onConfirm={() => onArchive(selectedSession.id)}
              >
                <Button type="button" variant="outline" size="icon" aria-label="Archive session">
                  <Archive size={16} />
                </Button>
              </ConfirmAction>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 text-xs md:grid-cols-2">
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
            <form className="flex flex-col gap-3" onSubmit={onSendTask}>
              <Field>
                <FieldLabel htmlFor="runtime-task">Task</FieldLabel>
                <Textarea
                  id="runtime-task"
                  className="min-h-24"
                  value={taskMessage}
                  onChange={(event) => setTaskMessage(event.target.value)}
                />
                <FieldDescription>Send the next instruction to the selected runtime session.</FieldDescription>
              </Field>
              <Button type="submit">
                <Send size={16} />
                Send task
              </Button>
            </form>
            <Separator />
            <section className="grid gap-3">
              <h3 className="text-sm font-medium">Transcript and runtime events</h3>
              {runtimeTranscript ? (
                <ScrollArea className="max-h-96 rounded-lg border bg-primary p-3 text-primary-foreground">
                  <pre className="whitespace-pre-wrap break-words text-xs">{runtimeTranscript}</pre>
                </ScrollArea>
              ) : null}
              {events.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/50 p-3 text-sm text-muted-foreground">
                  No persisted events yet.
                </div>
              ) : (
                events.map((event) => (
                  <Card size="sm" className="bg-muted/30" key={event.id}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <StatusBadge value={`#${event.sequence}`} />
                        <StatusBadge value={event.type} />
                        <StatusBadge value={event.visibility} />
                        <span className="text-muted-foreground">{formatDate(event.createdAt)}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-48">
                        <pre className="whitespace-pre-wrap break-words text-xs">{stringifyJson(event.payload)}</pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                ))
              )}
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
