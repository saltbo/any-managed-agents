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

export function parsePackages(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, version] = line.split('@')
      return version ? { name: name ?? line, version } : { name: line }
    })
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
