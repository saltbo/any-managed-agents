import { Copy, Download, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { PromptInput } from '@/components/ai-elements/prompt-input'
import { Tool } from '@/components/ai-elements/tool'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, StatusBadge } from '@/console/components'
import { formatTime, stringifyJson } from '@/console/format'
import type { SessionRuntimeState } from './session-runtime'

type EventFilter = 'all' | string
type RuntimeTab = 'transcript' | 'debug'
type TranscriptFilter = 'all' | 'user' | 'agent' | 'tool' | 'error' | 'system'

export function SessionRuntimePanel({
  runtime,
  message,
  setMessage,
  onSend,
  onAbort,
  onReconnect,
  canSend,
}: {
  runtime: SessionRuntimeState
  message: string
  setMessage: (value: string) => void
  onSend: (message: string) => void
  onAbort: () => void
  onReconnect: () => void
  canSend: boolean
}) {
  const [activeTab, setActiveTab] = useState<RuntimeTab>('transcript')
  const [transcriptType, setTranscriptType] = useState<TranscriptFilter>('all')
  const [eventType, setEventType] = useState<EventFilter>('all')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const sessionEvents = runtime.sessionEvents
  const eventsById = useMemo(() => new Map(sessionEvents.map((event) => [event.id, event])), [sessionEvents])
  const eventRows = useMemo(
    () =>
      sessionEvents.map((record) => ({
        id: record.id,
        type: record.type,
        payload: record.payload,
        createdAt: record.createdAt,
      })),
    [sessionEvents],
  )
  const debugEventTypes = useMemo<string[]>(
    () => [...new Set(eventRows.map((event) => event.type))].sort((left, right) => left.localeCompare(right)),
    [eventRows],
  )
  const selectedEventType = eventType === 'all' || debugEventTypes.includes(eventType) ? eventType : 'all'
  const filteredDebugEvents =
    selectedEventType === 'all' ? eventRows : eventRows.filter((event) => event.type === selectedEventType)
  const eventExport = stringifyJson(sessionEvents)
  const transcriptItems = useMemo(
    () =>
      [
        ...runtime.messages.map((message) => ({ type: 'message' as const, at: message.createdAt, message })),
        ...runtime.tools.map((tool) => ({ type: 'tool' as const, at: tool.createdAt, tool })),
      ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    [runtime.messages, runtime.tools],
  )
  const filteredTranscriptItems = useMemo(
    () =>
      transcriptItems.filter((item) => {
        if (transcriptType === 'user') return item.type === 'message' && item.message.role === 'user'
        if (transcriptType === 'agent') return item.type === 'message' && item.message.role === 'assistant'
        if (transcriptType === 'tool') return item.type === 'tool'
        if (transcriptType === 'error') {
          return item.type === 'message' ? item.message.status === 'error' : item.tool.status === 'error'
        }
        if (transcriptType === 'system') return item.type === 'message' && item.message.role === 'system'
        return true
      }),
    [transcriptItems, transcriptType],
  )
  const selectedEvent = selectedEventId ? (eventsById.get(selectedEventId) ?? null) : null
  const sendMessage = () => {
    const trimmed = message.trim()
    if (!trimmed) {
      return
    }
    onSend(trimmed)
    setMessage('')
  }
  const copyEvents = async () => {
    await navigator.clipboard?.writeText(eventExport)
    toast.success('Events copied')
  }
  const downloadEvents = () => {
    const blob = new Blob([eventExport], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'session-events.json'
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('Events downloaded')
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(runtimeTab(value))}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-col gap-3 border-b py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TabsList className="h-9">
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="debug">Debug</TabsTrigger>
          </TabsList>
          <Separator orientation="vertical" className="hidden h-8 lg:block" />
          {activeTab === 'transcript' ? (
            <Select value={transcriptType} onValueChange={(value) => setTranscriptType(transcriptFilter(value))}>
              <SelectTrigger className="h-9 w-44" aria-label="Filter transcript">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All events</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="tool">Tool</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Select value={selectedEventType} onValueChange={(value) => setEventType(eventFilter(value))}>
              <SelectTrigger className="h-9 w-44" aria-label="Filter debug events">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All events</SelectItem>
                  {debugEventTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="Search events">
            <Search data-icon="inline-start" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionStatusControl connection={runtime.connection} onReconnect={onReconnect} />
          <Separator orientation="vertical" className="h-8" />
          <Button type="button" variant="ghost" size="icon" onClick={copyEvents} aria-label="Copy events">
            <Copy data-icon="inline-start" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={downloadEvents} aria-label="Download events">
            <Download data-icon="inline-start" />
          </Button>
        </div>
      </div>

      <TabsContent value="transcript" className="mt-0 flex min-h-0 flex-1 flex-col">
        <div
          className={
            selectedEvent
              ? 'grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_28rem]'
              : 'flex min-h-0 flex-1 overflow-hidden bg-background'
          }
        >
          <Conversation>
            <ConversationContent className="pb-4">
              {filteredTranscriptItems.length === 0 ? (
                <div className="pt-8">
                  <EmptyState title="No messages yet" body="Send a message to start the session transcript." />
                </div>
              ) : null}
              {filteredTranscriptItems.map((item) =>
                item.type === 'message' ? (
                  <Message
                    key={`message:${item.message.id}`}
                    role={item.message.role}
                    timestamp={formatTime(item.message.createdAt)}
                    status={item.message.status}
                    statusDetail={item.message.status === 'error' ? item.message.content : null}
                    onClick={
                      item.message.sourceEventId && eventsById.has(item.message.sourceEventId)
                        ? () => {
                            setSelectedEventId(item.message.sourceEventId ?? null)
                          }
                        : undefined
                    }
                    className={
                      selectedEventId === item.message.sourceEventId && selectedEvent
                        ? 'bg-muted/50 ring-1 ring-border'
                        : undefined
                    }
                  >
                    <MessageContent>
                      <MessageResponse>{item.message.content}</MessageResponse>
                    </MessageContent>
                  </Message>
                ) : (
                  <Tool
                    key={`tool:${item.tool.id}`}
                    name={item.tool.name}
                    status={item.tool.status}
                    input={item.tool.input}
                    output={item.tool.output}
                    error={item.tool.error}
                    durationMs={item.tool.durationMs}
                    createdAt={item.tool.createdAt}
                  />
                ),
              )}
            </ConversationContent>
          </Conversation>
          {selectedEvent ? <EventDetailAside event={selectedEvent} /> : null}
        </div>
        <div className="border-t bg-background">
          <PromptInput
            value={message}
            disabled={!canSend}
            busy={runtime.runState === 'running'}
            onChange={setMessage}
            onSubmit={sendMessage}
            onAbort={onAbort}
          />
        </div>
      </TabsContent>

      <TabsContent value="debug" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
        <div
          className={
            selectedEvent
              ? 'grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_28rem]'
              : 'flex min-h-0 flex-1 overflow-hidden bg-background'
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto py-5">
            <div className="mx-auto w-full max-w-5xl px-4">
              {filteredDebugEvents.length === 0 ? (
                <EmptyState title="No debug events" body="Runtime diagnostics will appear here as the agent runs." />
              ) : (
                <div className="divide-y rounded-lg border">
                  {filteredDebugEvents.map((event) => (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => setSelectedEventId(event.id)}
                      className={
                        selectedEventId === event.id
                          ? 'flex w-full flex-wrap items-center gap-3 bg-muted/50 p-3 text-left ring-1 ring-inset ring-border'
                          : 'flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-muted/40'
                      }
                    >
                      <StatusBadge value={event.type} />
                      <span className="font-mono text-xs text-muted-foreground">{event.id}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selectedEvent ? <EventDetailAside event={selectedEvent} /> : null}
        </div>
      </TabsContent>
    </Tabs>
  )
}

function EventDetailAside({ event }: { event: SessionRuntimeState['sessionEvents'][number] }) {
  return (
    <aside className="min-h-0 overflow-y-auto border-t bg-muted/20 p-4 lg:border-t-0 lg:border-l">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge value={event.type} />
        <span className="font-mono text-xs text-muted-foreground">{event.id}</span>
        <span className="ml-auto text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
      </div>
      <pre className="max-h-[calc(100vh-18rem)] overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap">
        {stringifyJson(event)}
      </pre>
    </aside>
  )
}

function ConnectionStatusControl({
  connection,
  onReconnect,
}: {
  connection: SessionRuntimeState['connection']
  onReconnect: () => void
}) {
  if (connection === 'open') {
    return (
      <span
        role="img"
        aria-label="Session socket connected"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md"
      >
        <span className="size-2.5 rounded-full bg-emerald-500" />
      </span>
    )
  }
  if (connection === 'error') {
    return (
      <Button type="button" variant="ghost" size="icon" onClick={onReconnect} aria-label="Reconnect session socket">
        <RefreshCw data-icon="inline-start" />
      </Button>
    )
  }
  if (connection === 'connecting') {
    return <span className="inline-flex h-9 items-center px-2 text-xs text-muted-foreground">Connecting</span>
  }
  return <span className="h-9 w-9" aria-hidden="true" />
}

export function eventFilter(value: string): EventFilter {
  return value || 'all'
}

export function transcriptFilter(value: string): TranscriptFilter {
  return value === 'all' ||
    value === 'user' ||
    value === 'agent' ||
    value === 'tool' ||
    value === 'error' ||
    value === 'system'
    ? value
    : 'all'
}

function runtimeTab(value: string): RuntimeTab {
  return value === 'debug' ? 'debug' : 'transcript'
}
