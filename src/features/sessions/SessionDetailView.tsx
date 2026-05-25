import { Archive, ChevronDown, CircleStop, Cloud, GitBranch, Timer } from 'lucide-react'
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
import type { PiRuntimeState } from '@/features/sessions/pi-runtime'
import { SessionRuntimePanel } from '@/features/sessions/SessionRuntimePanel'
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
  runtime: PiRuntimeState
  onStop: (id: string) => void
  onArchive: (id: string) => void
  onRefreshEvents: () => void
  chatMessage: string
  setChatMessage: (value: string) => void
  onSendMessage: (message: string) => void
  onAbortRuntime: () => void
}) {
  const [pendingAction, setPendingAction] = useState<'stop' | 'archive' | null>(null)
  const [activeResource, setActiveResource] = useState<'agent' | 'environment' | null>(null)
  const shortSessionId = `${session.id.slice(0, 5)}...${session.id.slice(-7)}`
  const duration = formatDuration(session.startedAt, session.stoppedAt)
  const agentName = agentDisplayName || session.agentSnapshot.systemPrompt || session.agentId
  const environmentName = String(
    environmentDisplayName ?? session.environmentSnapshot?.runtimeImage.image ?? session.environmentId ?? 'Environment',
  )
  const modelName = String(session.modelConfig.model ?? 'default')
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
                {session.title ?? session.id}
              </h1>
              <div className="shrink-0">
                <StatusBadge value={session.status} detail={session.status === 'error' ? session.statusReason : null} />
              </div>
              <div className="hidden min-w-0 shrink items-center gap-2 text-sm text-muted-foreground md:flex">
                <SessionMeta
                  icon={<GitBranch className="size-4" />}
                  value={agentName}
                  label="Open agent details"
                  onClick={() => setActiveResource('agent')}
                />
                <SessionMeta
                  icon={<Cloud className="size-4" />}
                  value={environmentName}
                  label="Open environment details"
                  onClick={() => setActiveResource('environment')}
                  disabled={!session.environmentSnapshot}
                />
                <SessionMeta icon={<Timer className="size-4" />} value={duration} />
                <Separator orientation="vertical" className="h-4" />
                <span className="shrink-0">{formatRelativeTime(session.updatedAt)}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground md:hidden">
              <SessionMeta
                icon={<GitBranch className="size-4" />}
                value={agentName}
                label="Open agent details"
                onClick={() => setActiveResource('agent')}
              />
              <SessionMeta
                icon={<Cloud className="size-4" />}
                value={environmentName}
                label="Open environment details"
                onClick={() => setActiveResource('environment')}
                disabled={!session.environmentSnapshot}
              />
              <SessionMeta icon={<Timer className="size-4" />} value={duration} />
              <span className="shrink-0">{formatRelativeTime(session.updatedAt)}</span>
            </div>
            <div className="sr-only">
              <span className="truncate font-mono">Model provider {session.modelProvider}</span>
              <span className="truncate font-mono">Model config {modelName}</span>
              <span className="truncate font-mono">Runtime {session.runtimeEndpointPath}</span>
              <span className="truncate font-mono">Sandbox {session.sandboxId ?? 'unassigned'}</span>
              <span className="truncate font-mono">Pi {session.piRuntimeId ?? 'not started'}</span>
              <span className="truncate font-mono">Process {session.piProcessId ?? 'not started'}</span>
            </div>
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
        canSend={session.status === 'idle' || session.status === 'running'}
      />
      <Sheet open={activeResource !== null} onOpenChange={(open) => !open && setActiveResource(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {activeResource === 'agent' ? (
            <ResourceSheet
              title={agentName}
              description={`Agent snapshot captured for ${session.id}`}
              meta={
                <MetaGrid>
                  <Meta label="Agent id" value={session.agentId} />
                  <Meta label="Version" value={`v${session.agentSnapshot.version}`} />
                  <Meta label="Provider" value={session.agentSnapshot.provider} />
                  <Meta label="Model" value={session.agentSnapshot.model} />
                  <Meta label="Tools" value={session.agentSnapshot.allowedTools.join(', ') || 'None'} />
                  <Meta label="MCP connectors" value={session.agentSnapshot.mcpConnectors.join(', ') || 'None'} />
                </MetaGrid>
              }
              json={{
                instructions: session.agentSnapshot.instructions,
                systemPrompt: session.agentSnapshot.systemPrompt,
                sandboxPolicy: session.agentSnapshot.sandboxPolicy,
                metadata: session.agentSnapshot.metadata,
              }}
            />
          ) : null}
          {activeResource === 'environment' && session.environmentSnapshot ? (
            <ResourceSheet
              title={environmentName}
              description={`Environment snapshot captured for ${session.id}`}
              meta={
                <MetaGrid>
                  <Meta label="Environment id" value={session.environmentId ?? 'None'} />
                  <Meta label="Version" value={`v${session.environmentSnapshot.version}`} />
                  <Meta
                    label="Runtime image"
                    value={String(session.environmentSnapshot.runtimeImage.image ?? 'Default')}
                  />
                  <Meta
                    label="Packages"
                    value={session.environmentSnapshot.packages.map((item) => item.name).join(', ') || 'None'}
                  />
                  <Meta
                    label="Variables"
                    value={Object.keys(session.environmentSnapshot.variables).join(', ') || 'None'}
                  />
                  <Meta
                    label="Secret refs"
                    value={session.environmentSnapshot.secretRefs.map((item) => item.name).join(', ') || 'None'}
                  />
                </MetaGrid>
              }
              json={{
                networkPolicy: session.environmentSnapshot.networkPolicy,
                mcpPolicy: session.environmentSnapshot.mcpPolicy,
                packageManagerPolicy: session.environmentSnapshot.packageManagerPolicy,
                resourceLimits: session.environmentSnapshot.resourceLimits,
                metadata: session.environmentSnapshot.metadata,
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
        onConfirm={() => onStop(session.id)}
      />
      <ConfirmAction
        title="Archive session?"
        description="Archive this session from active operations while preserving persisted events."
        confirmLabel="Archive session"
        destructive
        open={pendingAction === 'archive'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirm={() => onArchive(session.id)}
      />
    </div>
  )
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

function ResourceSheet({
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
