import { Archive, Boxes, ChevronDown, CircleStop, Cloud, GitBranch, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ConfirmAction, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { formatDuration, formatRelativeTime, stringifyJson } from '@/console/format'
import { JsonBlock } from '@/features/console/json-block'
import { SessionRuntimePanel } from '@/features/sessions/SessionRuntimePanel'
import type { SessionRuntimeState } from '@/features/sessions/session-runtime'
import type { Session, SessionEvent } from '@/lib/api'

export function SessionDetailView({
  session,
  agentName: agentDisplayName,
  environmentName: environmentDisplayName,
  events,
  runtime,
  onStop,
  onArchive,
  onRefreshEvents,
  chatMessage,
  setChatMessage,
  onSendMessage,
  onAbortRuntime,
}: {
  session: Session
  agentName: string | undefined
  environmentName: string | undefined
  events: SessionEvent[]
  runtime: SessionRuntimeState
  onStop: (id: string) => void
  onArchive: (id: string) => void
  onRefreshEvents: () => void
  chatMessage: string
  setChatMessage: (value: string) => void
  onSendMessage: (message: string) => void
  onAbortRuntime: () => void
}) {
  const [pendingAction, setPendingAction] = useState<'stop' | 'archive' | null>(null)
  const [activeSheet, setActiveSheet] = useState<'agent' | 'environment' | 'volumes' | null>(null)
  const sessionId = session.metadata.uid
  const phase = session.status.phase
  const agentSnapshot = session.status.bindings.agent.snapshot
  const environmentSnapshot = session.status.bindings.environment.snapshot
  const volumes = session.spec.volumes
  const shortSessionId = `${sessionId.slice(0, 5)}...${sessionId.slice(-7)}`
  const duration = formatDuration(session.status.startedAt, session.status.stoppedAt)
  const agentName = agentDisplayName || agentSnapshot.instructions || session.spec.agentId
  const environmentName = String(environmentDisplayName ?? session.spec.environmentId ?? 'Environment')
  const agentProviderModel = `${agentSnapshot.providerId} / ${agentSnapshot.model ?? 'None'}`
  const hostingRuntime = environmentSnapshot
    ? `${hostingModeLabel(environmentSnapshot.hostingMode)} / ${session.status.bindings.runtime}`
    : 'No environment snapshot'
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col bg-background lg:min-h-screen">
      <header className="border-b px-4 py-4 lg:px-6">
        <div className="flex flex-col gap-5">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground" aria-label="Breadcrumb">
              <Link to="/sessions" className="hover:text-foreground">
                Sessions
              </Link>
              <span className="text-border">/</span>
              <span className="truncate font-mono font-medium text-foreground">{shortSessionId}</span>
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline">
                    Actions
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setPendingAction('stop')} variant="destructive">
                    <CircleStop />
                    Stop session
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPendingAction('archive')}>
                    <Archive />
                    Archive session
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <h1 className="min-w-24 flex-1 truncate text-3xl font-semibold tracking-normal text-foreground">
                {session.metadata.name}
              </h1>
              <div className="shrink-0">
                <StatusBadge value={phase} detail={phase === 'error' ? session.status.reason : null} />
              </div>
              <div className="hidden min-w-0 shrink items-center gap-2 text-sm text-muted-foreground md:flex">
                <SessionMeta
                  icon={<GitBranch className="size-4" />}
                  value={agentName}
                  label="Open agent details"
                  onClick={() => setActiveSheet('agent')}
                />
                <SessionMeta
                  icon={<Cloud className="size-4" />}
                  value={environmentName}
                  label="Open environment details"
                  onClick={() => setActiveSheet('environment')}
                  disabled={!environmentSnapshot}
                />
                <SessionMeta icon={<Timer className="size-4" />} value={duration} />
                <SessionMeta
                  icon={<Boxes className="size-4" />}
                  value={`${volumes.length} volumes`}
                  label="Open session volumes"
                  onClick={() => setActiveSheet('volumes')}
                />
                <Separator orientation="vertical" className="h-4" />
                <span className="shrink-0">{formatRelativeTime(session.metadata.updatedAt)}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground md:hidden">
              <SessionMeta
                icon={<GitBranch className="size-4" />}
                value={agentName}
                label="Open agent details"
                onClick={() => setActiveSheet('agent')}
              />
              <SessionMeta
                icon={<Cloud className="size-4" />}
                value={environmentName}
                label="Open environment details"
                onClick={() => setActiveSheet('environment')}
                disabled={!environmentSnapshot}
              />
              <SessionMeta icon={<Timer className="size-4" />} value={duration} />
              <SessionMeta
                icon={<Boxes className="size-4" />}
                value={`${volumes.length} volumes`}
                label="Open session volumes"
                onClick={() => setActiveSheet('volumes')}
              />
              <span className="shrink-0">{formatRelativeTime(session.metadata.updatedAt)}</span>
            </div>
            <div className="sr-only">
              <span className="truncate font-mono">Agent provider/model {agentProviderModel}</span>
              <span className="truncate font-mono">Hosting / runtime {hostingRuntime}</span>
            </div>
            <dl className="grid gap-2 pt-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <SessionFact label="Agent provider/model" value={agentProviderModel} />
              <SessionFact label="Hosting / runtime" value={hostingRuntime} />
              <SessionFact label="Hosting mode" value={environmentSnapshot?.hostingMode ?? 'None'} />
              <SessionFact label="Runtime status" value={session.status.reason ?? phase} />
            </dl>
          </div>
        </div>
      </header>

      <SessionRuntimePanel
        runtime={runtime}
        persistedEvents={events}
        message={chatMessage}
        setMessage={setChatMessage}
        onSend={onSendMessage}
        onAbort={onAbortRuntime}
        onRefreshEvents={onRefreshEvents}
        canSend={phase === 'idle'}
      />
      <Sheet
        open={activeSheet !== null}
        onOpenChange={(open) => {
          /* v8 ignore start -- Radix never calls onOpenChange(true) in controlled mode (jsdom) */
          if (!open) setActiveSheet(null)
          /* v8 ignore stop */
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {activeSheet === 'agent' ? (
            <SnapshotSheet
              title={agentName}
              description={`Agent snapshot captured for ${sessionId}`}
              meta={
                <MetaGrid>
                  <Meta label="Agent id" value={session.spec.agentId} />
                  <Meta label="Version" value={`v${agentSnapshot.version}`} />
                  <Meta label="Provider" value={agentSnapshot.providerId} />
                  <Meta label="Model" value={agentSnapshot.model ?? 'None'} />
                  <Meta label="Skills" value={agentSnapshot.skills.join(', ') || 'None'} />
                  <Meta label="Tools" value={agentSnapshotToolNames(session).join(', ') || 'None'} />
                  <Meta label="MCP connectors" value={agentSnapshot.mcpConnectors.join(', ') || 'None'} />
                </MetaGrid>
              }
              json={{
                instructions: agentSnapshot.instructions,
                metadata: agentSnapshot.metadata,
              }}
            />
          ) : null}
          {activeSheet === 'environment' && environmentSnapshot ? (
            <SnapshotSheet
              title={environmentName}
              description={`Environment snapshot captured for ${sessionId}`}
              meta={
                <MetaGrid>
                  <Meta label="Environment id" value={session.spec.environmentId ?? 'None'} />
                  <Meta label="Version" value={`v${environmentSnapshot.version}`} />
                  <Meta label="Hosting mode" value={environmentSnapshot.hostingMode} />
                  <Meta label="Runtime" value={session.status.bindings.runtime} />
                  <Meta label="Runtime config" value={stringifyJson(environmentSnapshot.runtimeConfig)} />
                  <Meta
                    label="Packages"
                    value={environmentSnapshot.packages.map((item) => item.name).join(', ') || 'None'}
                  />
                  <Meta label="Variables" value={Object.keys(environmentSnapshot.variables).join(', ') || 'None'} />
                </MetaGrid>
              }
              json={{
                networkPolicy: environmentSnapshot.networkPolicy,
                mcpPolicy: environmentSnapshot.mcpPolicy,
                packageManagerPolicy: environmentSnapshot.packageManagerPolicy,
                resourceLimits: environmentSnapshot.resourceLimits,
                metadata: environmentSnapshot.metadata,
              }}
            />
          ) : null}
          {activeSheet === 'volumes' ? (
            <SnapshotSheet
              title="Session volumes"
              description={`Mountable session inputs captured for ${sessionId}`}
              meta={
                <MetaGrid>
                  <Meta label="Count" value={String(volumes.length)} />
                  <Meta label="Git repositories" value={String(gitVolumes(session).length)} />
                  <Meta
                    label="Memory stores"
                    value={
                      memoryStoreVolumes(session).length === 0 ? 'None' : String(memoryStoreVolumes(session).length)
                    }
                  />
                  <Meta label="Workspace manifest" value="/workspace/.ama/resources.json" />
                  <Meta label="Setup status" value="Declared for runtime executor setup" />
                </MetaGrid>
              }
              json={{
                volumes: volumes.map(safeVolumeView),
                volumeMounts: session.spec.volumeMounts,
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmAction
        title="Stop session?"
        description="Stop the selected runtime session. In-flight work may be interrupted."
        confirmLabel="Stop session"
        destructive
        open={pendingAction === 'stop'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirm={() => onStop(sessionId)}
      />
      <ConfirmAction
        title="Archive session?"
        description="Archive this session from active operations while preserving persisted events."
        confirmLabel="Archive session"
        destructive
        open={pendingAction === 'archive'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirm={() => onArchive(sessionId)}
      />
    </div>
  )
}

function SessionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  )
}

function hostingModeLabel(value: string) {
  return value === 'self_hosted' ? 'Self-hosted' : 'Cloud'
}

function agentSnapshotToolNames(session: Session) {
  return session.status.bindings.agent.snapshot.tools
    .map((tool) => (typeof tool.name === 'string' ? tool.name : null))
    .filter((name): name is string => Boolean(name))
}

function gitVolumes(session: Session) {
  return session.spec.volumes.filter((volume) => volume.type === 'git_repository')
}

function memoryStoreVolumes(session: Session) {
  return session.spec.volumes.filter((volume) => volume.type === 'memory')
}

function safeVolumeView(volume: Record<string, unknown>) {
  if (volume.type === 'memory') {
    return {
      name: volume.name,
      type: volume.type,
      memoryRef: volume.memoryRef,
      description: volume.description,
      access: volume.access,
      memories: Array.isArray(volume.memories)
        ? volume.memories.map((memory) =>
            memory && typeof memory === 'object' ? { path: (memory as Record<string, unknown>).path } : memory,
          )
        : [],
    }
  }
  if (volume.type !== 'git_repository') {
    return volume
  }
  return {
    name: volume.name,
    type: volume.type,
    url: volume.url,
    ref: volume.ref,
    ...(typeof volume.secretRef === 'string' ? { secretRef: volume.secretRef } : {}),
  }
}

function SessionMeta({
  icon,
  value,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode
  value: string
  label?: string
  onClick?: () => void
  disabled?: boolean
}) {
  const content = (
    <>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{value}</span>
    </>
  )
  const className =
    'inline-flex h-8 max-w-full items-center gap-2 rounded-md border bg-muted/30 px-2.5 text-foreground/80 sm:max-w-[260px]'
  if (!onClick) {
    return <span className={className}>{content}</span>
  }
  return (
    <button
      type="button"
      className={`${className} cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  )
}

function SnapshotSheet({
  title,
  description,
  meta,
  json,
}: {
  title: string
  description: string
  meta: ReactNode
  json: Record<string, unknown>
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        {meta}
        <JsonBlock value={stringifyJson(json)} compact />
      </div>
    </>
  )
}
