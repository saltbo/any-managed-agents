export const PI_EVENT_DEFINITIONS = {
  message: { category: 'message', label: 'Message' },
  response: { category: 'lifecycle', label: 'Response' },
  agent_start: { category: 'lifecycle', label: 'Agent start' },
  turn_start: { category: 'lifecycle', label: 'Turn start' },
  message_start: { category: 'message', label: 'Message start' },
  message_update: { category: 'message', label: 'Message update' },
  message_end: { category: 'message', label: 'Message end' },
  tool_execution_start: { category: 'tool', label: 'Tool start' },
  tool_execution_update: { category: 'tool', label: 'Tool update' },
  tool_execution_end: { category: 'tool', label: 'Tool end' },
  agent_end: { category: 'lifecycle', label: 'Agent end' },
  turn_end: { category: 'lifecycle', label: 'Turn end' },
  usage: { category: 'usage', label: 'Usage' },
  error: { category: 'error', label: 'Error' },
  bridge_stderr: { category: 'bridge', label: 'Bridge stderr' },
  bridge_exit: { category: 'bridge', label: 'Bridge exit' },
} as const

export type PiEventType = keyof typeof PI_EVENT_DEFINITIONS
export type PiEventCategory = (typeof PI_EVENT_DEFINITIONS)[PiEventType]['category']

export const PI_EVENT_TYPES = Object.keys(PI_EVENT_DEFINITIONS) as PiEventType[]
export const PI_EVENT_CATEGORIES = [
  'message',
  'tool',
  'lifecycle',
  'usage',
  'error',
  'bridge',
] as const satisfies readonly Exclude<PiEventCategory, 'unknown'>[]

export type PiEventFilterCategory = PiEventCategory | 'unknown'

export function isPiEventType(value: string): value is PiEventType {
  return Object.hasOwn(PI_EVENT_DEFINITIONS, value)
}

export function piEventCategory(type: string): PiEventFilterCategory {
  return isPiEventType(type) ? PI_EVENT_DEFINITIONS[type].category : 'unknown'
}

export function piEventLabel(type: string): string {
  return isPiEventType(type) ? PI_EVENT_DEFINITIONS[type].label : type
}

export function piEventTypeFromPayload(event: Record<string, unknown>): string {
  return typeof event.type === 'string' && event.type ? event.type : 'message'
}
