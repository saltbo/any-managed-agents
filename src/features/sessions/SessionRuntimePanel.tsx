import {
  AMA_SESSION_EVENT_CATEGORIES,
  type AmaSessionEventFilterCategory,
  amaSessionEventCategory,
  amaSessionEventLabel,
  isAmaSessionEventType,
} from '@shared/session-events'
import { Copy, Download, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { PromptInput } from '@/components/ai-elements/prompt-input'
import { Tool } from '@/components/ai-elements/tool'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, StatusBadge } from '@/console/components'
import { formatTime, stringifyJson } from '@/console/format'
import type { SessionEvent } from '@/lib/api'
import type { SessionRuntimeState } from './session-runtime'

const EVENT_FILTERS = [
  ...AMA_SESSION_EVENT_CATEGORIES,
  'unknown',
] as const satisfies readonly AmaSessionEventFilterCategory[]
type EventFilter = 'all' | (typeof EVENT_FILTERS)[number]

export function SessionRuntimePanel({
  runtime,
  persistedEvents,
  message,
  setMessage,
  onSend,
  onAbort,
  onRefreshEvents,
  canSend,
}: {
  runtime: SessionRuntimeState
  persistedEvents: SessionEvent[]
  message: string
  setMessage: (value: string) => void
  onSend: (message: string) => void
  onAbort: () => void
  onRefreshEvents: () => void
  canSend: boolean
}) {
  const [eventType, setEventType] = useState<EventFilter>('all')
  const debugEvents = useMemo(() => {
    const persisted = persistedEvents
      .filter((event) => event.visibility !== 'transcript')
      .map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      }))
    return [...persisted, ...runtime.debugEvents.filter((event) => !persisted.some((item) => item.id === event.id))]
  }, [persistedEvents, runtime.debugEvents])
  const filteredDebugEvents =
    eventType === 'all' ? debugEvents : debugEvents.filter((event) => amaSessionEventCategory(event.type) === eventType)
  const eventExport = stringifyJson([...persistedEvents].sort((a, b) => a.sequence - b.sequence))
  const transcriptItems = useMemo(
    () =>
      [
        ...runtime.messages.map((message) => ({ type: 'message' as const, at: message.createdAt, message })),
        ...runtime.tools.map((tool) => ({ type: 'tool' as const, at: tool.createdAt, tool })),
      ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    [runtime.messages, runtime.tools],
  )
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
    <Tabs defaultValue="transcript" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TabsList className="h-9">
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="debug">Debug</TabsTrigger>
          </TabsList>
          <Separator orientation="vertical" className="hidden h-8 lg:block" />
          <Select value={eventType} onValueChange={(value) => setEventType(eventFilter(value))}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {EVENT_FILTERS.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon" aria-label="Search events">
            <Search data-icon="inline-start" />
          </Button>
          <Badge variant={runtime.connection === 'open' ? 'secondary' : 'outline'} className="capitalize">
            {runtime.connection}
          </Badge>
          <Badge variant={runtime.runState === 'running' ? 'secondary' : 'outline'} className="capitalize">
            {runtime.runState}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={onRefreshEvents} aria-label="Refresh events">
            <RefreshCw data-icon="inline-start" />
          </Button>
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
        <Conversation className="bg-background">
          <ConversationContent className="pb-4">
            {runtime.messages.length === 0 && runtime.tools.length === 0 ? (
              <div className="pt-8">
                <EmptyState title="No messages yet" body="Send a message to start the session transcript." />
              </div>
            ) : null}
            {transcriptItems.map((item) =>
              item.type === 'message' ? (
                <Message
                  key={`message:${item.message.id}`}
                  role={item.message.role}
                  timestamp={formatTime(item.message.createdAt)}
                  status={item.message.status}
                  statusDetail={item.message.status === 'error' ? item.message.content : null}
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
        <div className="border-t bg-background">
          <PromptInput
            value={message}
            disabled={!canSend || runtime.connection !== 'open'}
            busy={runtime.runState === 'running'}
            onChange={setMessage}
            onSubmit={sendMessage}
            onAbort={onAbort}
          />
        </div>
      </TabsContent>

      <TabsContent value="debug" className="mt-0 min-h-0 flex-1 overflow-y-auto py-5">
        <div className="mx-auto w-full max-w-5xl">
          {filteredDebugEvents.length === 0 ? (
            <EmptyState title="No debug events" body="Runtime diagnostics will appear here as the agent runs." />
          ) : (
            <div className="divide-y rounded-lg border">
              {filteredDebugEvents.map((event) => (
                <details key={event.id} className="group p-3">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
                    <StatusBadge
                      value={isAmaSessionEventType(event.type) ? amaSessionEventLabel(event.type) : event.type}
                      detail={event.type === 'runtime.error' ? stringifyJson(event.payload) : null}
                    />
                    <Badge variant="outline">{amaSessionEventCategory(event.type)}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{event.id}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                    {stringifyJson(event.payload)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}

export function eventFilter(value: string): EventFilter {
  return value === 'all' || EVENT_FILTERS.includes(value as AmaSessionEventFilterCategory)
    ? (value as EventFilter)
    : 'all'
}
