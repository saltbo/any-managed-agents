import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import type { View } from './types'

dayjs.extend(localizedFormat)

export function titleForView(view: View) {
  return view === 'agents' ? 'Agents' : view === 'environments' ? 'Environments' : 'Sessions'
}

export function viewFromPath(pathname: string): View | null {
  if (pathname === '/' || pathname === '/agents') {
    return 'agents'
  }
  if (pathname === '/environments') {
    return 'environments'
  }
  if (pathname === '/sessions') {
    return 'sessions'
  }
  return null
}

export function formatDate(value: string | null) {
  return value ? dayjs(value).format('lll') : 'None'
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

export function matchesSearch(fields: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase()
  return !normalized || fields.some((field) => field?.toLowerCase().includes(normalized))
}
