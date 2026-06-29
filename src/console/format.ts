import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(localizedFormat)
dayjs.extend(relativeTime)

export function formatDate(value: string | null) {
  return value ? dayjs(value).format('lll') : 'None'
}

export function formatTime(value: string | null) {
  return value ? dayjs(value).format('HH:mm:ss') : 'None'
}

export function formatRelativeTime(value: string | null) {
  return value ? dayjs(value).fromNow() : 'None'
}

export function formatDuration(start: string | null, end: string | null) {
  if (!start) return 'None'
  const startAt = dayjs(start)
  const endAt = end ? dayjs(end) : dayjs()
  const seconds = Math.max(0, endAt.diff(startAt, 'second'))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatMillis(value: number) {
  const millis = Math.max(0, Math.round(value))
  if (millis < 1000) return `${millis}ms`
  return `${(millis / 1000).toFixed(1)}s`
}

export function parsePackages(value: string) {
  return {
    type: 'packages' as const,
    apt: [],
    cargo: [],
    gem: [],
    go: [],
    npm: value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    pip: [],
  }
}

export function parseVariables(value: string) {
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

// The console offers "workers-ai" as the platform-default provider option, but
// the v1 control plane resolves the project default from a null/omitted
// provider — "workers-ai" is the platform-default provider option.
export const PLATFORM_DEFAULT_PROVIDER = 'workers-ai'

// Spread into an agent create/update body. An omitted provider lets the
// control plane resolve the project default at session start.
export function providerPatch(provider: string): { provider: string } | Record<string, never> {
  const trimmed = provider.trim()
  return !trimmed || trimmed === PLATFORM_DEFAULT_PROVIDER ? {} : { provider: trimmed }
}

export function parseTools(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function parseJsonObject(value: string, label: string) {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

export function parseJsonObjectArray(value: string, label: string) {
  const parsed = JSON.parse(value || '[]') as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => !item || Array.isArray(item) || typeof item !== 'object')) {
    throw new Error(`${label} must be a JSON array of objects.`)
  }
  return parsed as Record<string, unknown>[]
}

export function formatCostMicros(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 1_000_000)
}

export function matchesSearch(fields: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase()
  return !normalized || fields.some((field) => field?.toLowerCase().includes(normalized))
}

type ArchivableResource = { archivedAt: string | null } | { metadata: { archivedAt: string | null } }

function archivedAt(resource: ArchivableResource) {
  return 'archivedAt' in resource ? resource.archivedAt : resource.metadata.archivedAt
}

export function isArchived(resource: ArchivableResource) {
  return archivedAt(resource) !== null
}

export function archivedLabel(resource: ArchivableResource) {
  return archivedAt(resource) === null ? 'active' : 'archived'
}
