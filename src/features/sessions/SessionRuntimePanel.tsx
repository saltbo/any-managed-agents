import { Copy, Download, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { PromptInput } from '@/components/ai-elements/prompt-input'
import { Tool } from '@/components/ai-elements/tool'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, StatusBadge } from '@/console/components'
import { formatTime, stringifyJson } from '@/console/format'
import type { EventRecord } from '@/lib/amarpc'
import type { SessionRuntimeState } from './session-runtime'

type EventFilter = 'all' | string
type RuntimeTab = 'transcript' | 'debug'
type TranscriptFilter = 'all' | 'user' | 'agent' | 'tool' | 'error' | 'system'

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
  persistedEvents: EventRecord[]
  message: string
  setMessage: (value: string) => void
  onSend: (message: string) => void
  onAbort: () => void
  onRefreshEvents: () => void
  canSend: boolean
}) {
  const [activeTab, setActiveTab] = useState<RuntimeTab>('transcript')
  const [transcriptType, setTranscriptType] = useState<TranscriptFilter>('all')
  const [eventType, setEventType] = useState<EventFilter>('all')
  const debugEvents = useMemo(() => {
    const persisted = persistedEvents.map((record) => ({
      id: record.id,
      type: record.event.type,
      payload: record.event.payload,
      createdAt: record.createdAt,
    }))
    return [...persisted, ...runtime.debugEvents.filter((record) => !persisted.some((item) => item.id === record.id))]
  }, [persistedEvents, runtime.debugEvents])
  const debugEventTypes = useMemo<string[]>(
    () => [...new Set(debugEvents.map((event) => event.type))].sort((left, right) => left.localeCompare(right)),
    [debugEvents],
  )
  const selectedEventType = eventType === 'all' || debugEventTypes.includes(eventType) ? eventType : 'all'
  const filteredDebugEvents =
    selectedEventType === 'all' ? debugEvents : debugEvents.filter((event) => event.type === selectedEventType)
  const eventExport = stringifyJson([...persistedEvents].sort((a, b) => a.sequence - b.sequence))
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
          <Badge
            variant={runtime.connection === 'open' ? 'secondary' : 'outline'}
            className="min-w-24 justify-center capitalize"
          >
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
            disabled={!canSend}
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
                    <StatusBadge value={event.type} />
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
