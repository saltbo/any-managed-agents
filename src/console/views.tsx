import { Archive, CircleStop, ExternalLink, Play, RefreshCw, Send } from 'lucide-react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type {
  Agent,
  AuditRecord,
  Environment,
  GovernancePolicy,
  McpConnection,
  McpConnector,
  Provider,
  Session,
  SessionEvent,
  UsageSummary,
  Vault,
  VaultCredential,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { Banner, ConfirmAction, EmptyState, Meta, StatusBadge } from './components'
import { formatCostMicros, formatDate, stringifyJson } from './format'

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
                  <CardTitle className="truncate">
                    <Link to={`/agents/${agent.id}`}>{agent.name}</Link>
                  </CardTitle>
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
                  <Play data-icon="inline-start" />
                </Button>
                <ConfirmAction
                  title="Archive agent?"
                  description={`Archive ${agent.name}. Existing active sessions are not deleted, but this agent will leave the active list.`}
                  confirmLabel="Archive agent"
                  destructive
                  onConfirm={() => onArchive(agent.id)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive agent">
                    <Archive data-icon="inline-start" />
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
                <CardTitle className="truncate">
                  <Link to={`/environments/${environment.id}`}>{environment.name}</Link>
                </CardTitle>
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
                  <Archive data-icon="inline-start" />
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
            asChild
            variant="outline"
            key={session.id}
            onClick={() => onSelect(session.id)}
          >
            <Link to={`/sessions/${session.id}`}>
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{session.agentSnapshot.systemPrompt ?? session.agentId}</span>
                  <StatusBadge value={session.status} />
                </span>
                <span className="truncate text-xs text-muted-foreground">{session.id}</span>
              </span>
            </Link>
          </Button>
        ))}
      </div>

      {selectedSession ? (
        <SessionDetailView
          session={selectedSession}
          events={events}
          runtimeTranscript={runtimeTranscript}
          onStop={onStop}
          onArchive={onArchive}
          onRefreshEvents={onRefreshEvents}
          taskMessage={taskMessage}
          setTaskMessage={setTaskMessage}
          onSendTask={onSendTask}
        />
      ) : null}
    </div>
  )
}

export function AgentDetailView({
  agent,
  environments,
  sessions,
  onStartSession,
  onArchive,
}: {
  agent: Agent | null
  environments: Environment[]
  sessions: Session[]
  onStartSession: (id: string) => void
  onArchive: (id: string) => void
}) {
  if (!agent) return <EmptyState title="Agent not found" body="The requested agent is not in the current project." />
  const environment = environments.find((item) => item.id === agent.defaultEnvironmentId)
  const agentSessions = sessions.filter((session) => session.agentId === agent.id)
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{agent.name}</CardTitle>
              <StatusBadge value={agent.status} />
              <StatusBadge value={`v${agent.version}`} />
            </div>
            <CardDescription>{agent.description ?? 'No description'}</CardDescription>
          </div>
          <CardAction className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onStartSession(agent.id)}>
              <Play data-icon="inline-start" />
              Start session
            </Button>
            <ConfirmAction
              title="Archive agent?"
              description={`Archive ${agent.name}. Existing active sessions are not deleted.`}
              confirmLabel="Archive agent"
              destructive
              onConfirm={() => onArchive(agent.id)}
            >
              <Button type="button" variant="outline">
                <Archive data-icon="inline-start" />
                Archive
              </Button>
            </ConfirmAction>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-xs md:grid-cols-2">
            <Meta label="Model" value={`${agent.provider} / ${agent.model}`} />
            <Meta label="Default environment" value={environment?.name ?? 'None'} />
            <Meta label="Allowed tools" value={agent.allowedTools.join(', ') || 'None'} />
            <Meta label="MCP connectors" value={agent.mcpConnectors.join(', ') || 'None'} />
            <Meta label="Sandbox policy" value={stringifyJson(agent.sandboxPolicy)} />
            <Meta label="Metadata" value={stringifyJson(agent.metadata)} />
            <Meta label="Created" value={formatDate(agent.createdAt)} />
            <Meta label="Updated" value={formatDate(agent.updatedAt)} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Version snapshot</CardTitle>
          <CardDescription>Immutable runtime settings captured by the current agent version.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-72 rounded-lg border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap break-words text-xs">
              {stringifyJson({
                instructions: agent.instructions,
                systemPrompt: agent.systemPrompt,
                provider: agent.provider,
                model: agent.model,
              })}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
      <ResourceLinks title="Recent sessions" empty="No sessions have used this agent yet." items={agentSessions} />
    </div>
  )
}

export function EnvironmentDetailView({
  environment,
  agents,
  sessions,
  onArchive,
}: {
  environment: Environment | null
  agents: Agent[]
  sessions: Session[]
  onArchive: (id: string) => void
}) {
  if (!environment) {
    return <EmptyState title="Environment not found" body="The requested environment is not in the current project." />
  }
  const boundAgents = agents.filter((agent) => agent.defaultEnvironmentId === environment.id)
  const boundSessions = sessions.filter((session) => session.environmentId === environment.id)
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{environment.name}</CardTitle>
              <StatusBadge value={environment.status} />
              <StatusBadge value={`v${environment.version}`} />
            </div>
            <CardDescription>{environment.description ?? 'No description'}</CardDescription>
          </div>
          <CardAction>
            <ConfirmAction
              title="Archive environment?"
              description={`Archive ${environment.name}. New sessions cannot use this environment.`}
              confirmLabel="Archive environment"
              destructive
              onConfirm={() => onArchive(environment.id)}
            >
              <Button type="button" variant="outline">
                <Archive data-icon="inline-start" />
                Archive
              </Button>
            </ConfirmAction>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-xs md:grid-cols-2">
            <Meta label="Packages" value={environment.packages.map((item) => item.name).join(', ') || 'None'} />
            <Meta label="Variables" value={Object.keys(environment.variables).join(', ') || 'None'} />
            <Meta label="Secret refs" value={environment.secretRefs.map((item) => item.name).join(', ') || 'None'} />
            <Meta label="Runtime image" value={String(environment.runtimeImage.image ?? 'Default')} />
            <Meta label="Network policy" value={stringifyJson(environment.networkPolicy)} />
            <Meta label="MCP policy" value={stringifyJson(environment.mcpPolicy)} />
            <Meta label="Package manager policy" value={stringifyJson(environment.packageManagerPolicy)} />
            <Meta label="Resource limits" value={stringifyJson(environment.resourceLimits)} />
          </dl>
        </CardContent>
      </Card>
      <ResourceLinks
        title="Agents using this environment"
        empty="No agents use this environment."
        items={boundAgents}
      />
      <ResourceLinks
        title="Sessions using this environment"
        empty="No sessions use this environment."
        items={boundSessions}
      />
    </div>
  )
}

export function SessionDetailView({
  session,
  events,
  runtimeTranscript,
  onStop,
  onArchive,
  onRefreshEvents,
  taskMessage,
  setTaskMessage,
  onSendTask,
}: {
  session: Session
  events: SessionEvent[]
  runtimeTranscript: string
  onStop: (id: string) => void
  onArchive: (id: string) => void
  onRefreshEvents: () => void
  taskMessage: string
  setTaskMessage: (value: string) => void
  onSendTask: (event: FormEvent) => void
}) {
  const transcriptEvents = events.filter((event) => event.visibility === 'transcript')
  const debugEvents = events.filter((event) => event.visibility !== 'transcript')
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Session detail</CardTitle>
          <CardDescription className="break-all">{session.id}</CardDescription>
        </div>
        <CardAction className="flex gap-2">
          <Button type="button" variant="outline" size="icon" onClick={onRefreshEvents} aria-label="Refresh events">
            <RefreshCw data-icon="inline-start" />
          </Button>
          <ConfirmAction
            title="Stop session?"
            description="Stop the selected runtime session. In-flight work may be interrupted."
            confirmLabel="Stop session"
            destructive
            onConfirm={() => onStop(session.id)}
          >
            <Button type="button" variant="outline" size="icon" aria-label="Stop session">
              <CircleStop data-icon="inline-start" />
            </Button>
          </ConfirmAction>
          <ConfirmAction
            title="Archive session?"
            description="Archive the selected session from active operations while preserving persisted events."
            confirmLabel="Archive session"
            destructive
            onConfirm={() => onArchive(session.id)}
          >
            <Button type="button" variant="outline" size="icon" aria-label="Archive session">
              <Archive data-icon="inline-start" />
            </Button>
          </ConfirmAction>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-2 text-xs md:grid-cols-2">
          <Meta label="Status" value={session.status} />
          <Meta label="Model" value={`${session.modelProvider} / ${String(session.modelConfig.model ?? 'default')}`} />
          <Meta label="Sandbox" value={session.sandboxId ?? 'None'} />
          <Meta label="Runtime endpoint" value={session.runtimeEndpointPath} />
          <Meta label="Started" value={formatDate(session.startedAt)} />
          <Meta label="Stopped" value={formatDate(session.stoppedAt)} />
        </dl>
        {session.statusReason ? <Banner tone="error" message={session.statusReason} /> : null}
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
            <Send data-icon="inline-start" />
            Send task
          </Button>
        </form>
        <Separator />
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Transcript and runtime events</h3>
          <p className="text-sm text-muted-foreground">
            Transcript is primary; debug, snapshots, and raw runtime data stay behind tabs.
          </p>
        </section>
        <Tabs defaultValue="transcript">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="debug">Debug</TabsTrigger>
            <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          </TabsList>
          <TabsContent value="transcript" className="mt-3">
            {runtimeTranscript ? <JsonBlock value={runtimeTranscript} inverted /> : null}
            <EventList events={transcriptEvents} empty="No transcript events yet." />
          </TabsContent>
          <TabsContent value="debug" className="mt-3">
            <EventList events={debugEvents} empty="No debug, tool, policy, usage, or audit events yet." />
          </TabsContent>
          <TabsContent value="snapshots" className="mt-3">
            <JsonBlock
              value={stringifyJson({
                agentSnapshot: session.agentSnapshot,
                environmentSnapshot: session.environmentSnapshot,
                metadata: session.metadata,
              })}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export function ProvidersView({ providers, onArchive }: { providers: Provider[]; onArchive: (id: string) => void }) {
  if (providers.length === 0) {
    return (
      <EmptyState
        title="No providers"
        body="Add a model provider or use the platform defaults discovered by the API."
      />
    )
  }
  return (
    <div className="grid gap-3">
      {providers.map((provider) => (
        <Card size="sm" key={provider.id}>
          <CardHeader>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate">
                  <Link to={`/providers/${provider.id}`}>{provider.displayName}</Link>
                </CardTitle>
                <StatusBadge value={provider.status} />
                {provider.isDefault ? <StatusBadge value="default" /> : null}
                <StatusBadge value={provider.credentialStatus} />
              </div>
              <CardDescription>{provider.type}</CardDescription>
            </div>
            <CardAction>
              <ConfirmAction
                title="Delete provider?"
                description={`Delete ${provider.displayName}. Future agents cannot use this provider unless it is restored.`}
                confirmLabel="Delete provider"
                destructive
                onConfirm={() => onArchive(provider.id)}
              >
                <Button type="button" variant="outline" size="icon" aria-label="Delete provider">
                  <Archive data-icon="inline-start" />
                </Button>
              </ConfirmAction>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-xs md:grid-cols-2">
              <Meta label="Base URL" value={provider.baseUrl ?? 'Platform default'} />
              <Meta label="Model catalog" value={provider.modelCatalogStatus} />
              <Meta
                label="Credential"
                value={provider.hasCredential ? 'Configured reference' : 'No credential value returned'}
              />
              <Meta label="Updated" value={formatDate(provider.updatedAt)} />
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function ProviderDetailView({ provider }: { provider: Provider | null }) {
  if (!provider) return <EmptyState title="Provider not found" body="The requested provider is not in this project." />
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{provider.displayName}</CardTitle>
            <StatusBadge value={provider.status} />
            <StatusBadge value={provider.credentialStatus} />
          </div>
          <CardDescription>{provider.type}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-xs md:grid-cols-2">
          <Meta label="Provider id" value={provider.id} />
          <Meta label="Base URL" value={provider.baseUrl ?? 'Platform default'} />
          <Meta label="Rate limits" value={stringifyJson(provider.rateLimits)} />
          <Meta label="Budget policy" value={stringifyJson(provider.budgetPolicy)} />
          <Meta label="Metadata" value={stringifyJson(provider.metadata)} />
          <Meta label="Last error" value={provider.lastError ? stringifyJson(provider.lastError) : 'None'} />
        </dl>
      </CardContent>
    </Card>
  )
}

export function VaultsView({ vaults, onArchive }: { vaults: Vault[]; onArchive: (id: string) => void }) {
  if (vaults.length === 0) {
    return (
      <EmptyState title="No vaults" body="Create a vault to track safe credential references for providers and MCP." />
    )
  }
  return (
    <div className="grid gap-3">
      {vaults.map((vault) => (
        <Card size="sm" key={vault.id}>
          <CardHeader>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate">
                  <Link to={`/vaults/${vault.id}`}>{vault.name}</Link>
                </CardTitle>
                <StatusBadge value={vault.status} />
                <StatusBadge value={vault.scope} />
              </div>
              <CardDescription>{vault.description ?? 'No description'}</CardDescription>
            </div>
            <CardAction>
              <ConfirmAction
                title="Archive vault?"
                description={`Archive ${vault.name}. Existing credential references remain auditable.`}
                confirmLabel="Archive vault"
                destructive
                onConfirm={() => onArchive(vault.id)}
              >
                <Button type="button" variant="outline" size="icon" aria-label="Archive vault">
                  <Archive data-icon="inline-start" />
                </Button>
              </ConfirmAction>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-xs md:grid-cols-2">
              <Meta label="Vault id" value={vault.id} />
              <Meta label="Project" value={vault.projectId ?? 'Organization'} />
              <Meta label="Created" value={formatDate(vault.createdAt)} />
              <Meta label="Updated" value={formatDate(vault.updatedAt)} />
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function VaultDetailView({ vault, credentials }: { vault: Vault | null; credentials: VaultCredential[] }) {
  if (!vault) return <EmptyState title="Vault not found" body="The requested vault is not in this project." />
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{vault.name}</CardTitle>
            <StatusBadge value={vault.status} />
            <StatusBadge value={vault.scope} />
          </div>
          <CardDescription>{vault.description ?? 'No description'}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-xs md:grid-cols-2">
            <Meta label="Vault id" value={vault.id} />
            <Meta label="Metadata" value={stringifyJson(vault.metadata)} />
            <Meta label="Created" value={formatDate(vault.createdAt)} />
            <Meta label="Archived" value={formatDate(vault.archivedAt)} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Credential metadata</CardTitle>
          <CardDescription>Raw secret values are not returned by the control plane.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credentials are registered in this vault.</p>
          ) : (
            credentials.map((credential) => (
              <dl className="grid gap-2 text-xs md:grid-cols-2" key={credential.id}>
                <Meta label="Name" value={credential.name} />
                <Meta label="Type" value={credential.type} />
                <Meta label="Status" value={credential.status} />
                <Meta label="Active version" value={credential.activeVersionId ?? 'None'} />
                <Meta label="Secret reference" value={credential.activeVersion?.referenceName ?? 'Not returned'} />
                <Meta label="Connector binding" value={stringifyJson(credential.connectorBinding)} />
              </dl>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function McpView({
  connectors,
  connections,
  onDisconnect,
}: {
  connectors: McpConnector[]
  connections: McpConnection[]
  onDisconnect: (id: string) => void
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP connectors</CardTitle>
          <CardDescription>Catalog status, governance result, and connection state.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP connectors are discoverable yet.</p>
          ) : (
            connectors.map((connector) => (
              <dl className="grid gap-2 text-xs md:grid-cols-2" key={connector.id}>
                <Meta label="Connector" value={`${connector.name} (${connector.connectorId})`} />
                <Meta label="Policy" value={connector.policyStatus} />
                <Meta label="Connection" value={connector.connectionStatus} />
                <Meta label="Tools" value={connector.tools.map((tool) => tool.name).join(', ') || 'None'} />
              </dl>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>Disconnect is destructive and requires confirmation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No project MCP connections exist.</p>
          ) : (
            connections.map((connection) => (
              <div
                className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
                key={connection.id}
              >
                <dl className="grid min-w-0 flex-1 gap-2 text-xs md:grid-cols-2">
                  <Meta label="Connector" value={connection.connectorId} />
                  <Meta label="Status" value={connection.status} />
                  <Meta
                    label="Credential"
                    value={connection.hasCredential ? 'Reference configured' : 'No credential'}
                  />
                  <Meta label="Endpoint" value={connection.endpointUrl ?? 'Default'} />
                </dl>
                <ConfirmAction
                  title="Disconnect MCP connector?"
                  description={`Disconnect ${connection.connectorId}. Runtime tool calls through this connection will stop.`}
                  confirmLabel="Disconnect"
                  destructive
                  onConfirm={() => onDisconnect(connection.id)}
                >
                  <Button type="button" variant="outline">
                    Disconnect
                  </Button>
                </ConfirmAction>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function UsageView({ summary }: { summary: UsageSummary | null }) {
  if (!summary)
    return <EmptyState title="No usage summary" body="Usage appears after sessions record token or runtime events." />
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Usage summary</CardTitle>
          <CardDescription>Totals across the current project filters.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-xs md:grid-cols-4">
            <Meta label="Records" value={String(summary.totals.records)} />
            <Meta label="Prompt tokens" value={String(summary.totals.promptTokens)} />
            <Meta label="Completion tokens" value={String(summary.totals.completionTokens)} />
            <Meta label="Cost" value={formatCostMicros(summary.totals.costMicros, summary.totals.currency)} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Grouped breakdown</CardTitle>
          <CardDescription>Provider, model, agent, and session attribution.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {summary.groups.map((group) => (
            <dl className="grid gap-2 text-xs md:grid-cols-3" key={JSON.stringify(group.key)}>
              <Meta label="Group" value={stringifyJson(group.key)} />
              <Meta label="Tokens" value={String(group.totalTokens)} />
              <Meta label="Cost" value={formatCostMicros(group.costMicros, group.currency)} />
            </dl>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export function AuditView({ records }: { records: AuditRecord[] }) {
  if (records.length === 0) {
    return <EmptyState title="No audit records" body="Security-relevant control-plane activity will appear here." />
  }
  return (
    <div className="grid gap-3">
      {records.map((record) => (
        <Card size="sm" key={record.id}>
          <CardHeader>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="break-words text-base">{record.action}</CardTitle>
                <StatusBadge value={record.outcome} />
              </div>
              <CardDescription>{formatDate(record.createdAt)}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-xs md:grid-cols-2">
              <Meta label="Actor" value={record.actorUserId ?? record.actorType} />
              <Meta label="Resource" value={`${record.resourceType} / ${record.resourceId ?? 'None'}`} />
              <Meta label="Request" value={record.requestId ?? 'None'} />
              <Meta label="Policy" value={record.policyCategory ?? 'None'} />
              <Meta label="Metadata" value={stringifyJson(record.metadata)} />
              <Meta label="After" value={stringifyJson(record.after)} />
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function GovernanceView({ policy }: { policy: GovernancePolicy | null }) {
  if (!policy)
    return <EmptyState title="No governance policy" body="Project policy will appear after it is configured." />
  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance settings</CardTitle>
        <CardDescription>Project policy for providers, models, tools, MCP, sandbox, and budgets.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-xs md:grid-cols-2">
          <Meta label="Provider rules" value={stringifyJson(policy.providerRules)} />
          <Meta label="Model rules" value={stringifyJson(policy.modelRules)} />
          <Meta label="Tool policy" value={stringifyJson(policy.toolPolicy)} />
          <Meta label="MCP policy" value={stringifyJson(policy.mcpPolicy)} />
          <Meta label="Sandbox policy" value={stringifyJson(policy.sandboxPolicy)} />
          <Meta label="Budget policy" value={stringifyJson(policy.budgetPolicy)} />
        </dl>
      </CardContent>
    </Card>
  )
}

export function QuickstartView({
  agents,
  environments,
  sessions,
}: {
  agents: Agent[]
  environments: Environment[]
  sessions: Session[]
}) {
  const steps = [
    { label: 'Provider', complete: true, call: 'GET /api/providers' },
    {
      label: 'Environment',
      complete: environments.some((item) => item.status === 'active'),
      call: 'POST /api/environments',
    },
    { label: 'Agent', complete: agents.some((item) => item.status === 'active'), call: 'POST /api/agents' },
    { label: 'Session', complete: sessions.length > 0, call: 'POST /api/agents/{agentId}/sessions' },
    {
      label: 'Integration',
      complete: sessions.some((item) => item.runtimeEndpointPath),
      call: 'GET /api/openapi.json',
    },
  ]
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>First run workflow</CardTitle>
          <CardDescription>Create the minimum resources required to run a Pi-backed session.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {steps.map((step, index) => (
            <div
              className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
              key={step.label}
            >
              <div className="flex items-center gap-3">
                <StatusBadge value={step.complete ? 'complete' : 'pending'} />
                <div>
                  <p className="font-medium">
                    {index + 1}. {step.label}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.call}</p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link
                  to={
                    step.label === 'Provider'
                      ? '/providers'
                      : step.label === 'Environment'
                        ? '/environments'
                        : step.label === 'Agent'
                          ? '/agents'
                          : step.label === 'Session'
                            ? '/sessions'
                            : '/usage'
                  }
                >
                  Open
                  <ExternalLink data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Integration snippets</CardTitle>
          <CardDescription>
            Use the OpenAPI contract for control-plane automation and the session runtime endpoint for live traffic.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JsonBlock
            value={
              'restish :/api/openapi.json\nrestish post :/api/agents/{agentId}/sessions\ncurl -X POST "$ORIGIN/api/sessions/{sessionId}/runtime"'
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

function EventList({ events, empty }: { events: SessionEvent[]; empty: string }) {
  if (events.length === 0) {
    return <div className="rounded-lg border border-dashed bg-muted/50 p-3 text-sm text-muted-foreground">{empty}</div>
  }
  return (
    <div className="grid gap-3">
      {events.map((event) => (
        <Card size="sm" className="bg-muted/30" key={event.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge value={`#${event.sequence}`} />
              <StatusBadge value={event.type} />
              <StatusBadge value={event.visibility} />
              {event.role ? <StatusBadge value={event.role} /> : null}
              <span className="text-muted-foreground">{formatDate(event.createdAt)}</span>
            </div>
          </CardHeader>
          <CardContent>
            <JsonBlock value={stringifyJson(event.payload)} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function JsonBlock({ value, inverted = false }: { value: string; inverted?: boolean }) {
  return (
    <ScrollArea
      className={cn('max-h-96 rounded-lg border p-3', inverted ? 'bg-primary text-primary-foreground' : 'bg-muted/30')}
    >
      <pre className="whitespace-pre-wrap break-words text-xs">{value}</pre>
    </ScrollArea>
  )
}

function ResourceLinks({ title, empty, items }: { title: string; empty: string; items: Array<Agent | Session> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.map((item) => {
            const isAgent = 'name' in item
            return (
              <Button asChild variant="outline" className="justify-start" key={item.id}>
                <Link to={isAgent ? `/agents/${item.id}` : `/sessions/${item.id}`}>
                  {isAgent ? item.name : item.id}
                </Link>
              </Button>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
