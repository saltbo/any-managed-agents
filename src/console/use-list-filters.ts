import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

// URL-backed list filter state: primary resource lists stay deep-linkable
// (filters survive reload and can be shared) instead of living in component
// state.
export function useUrlFilter(key: string, fallback = '') {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const setValue = useCallback(
    (next: string) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next && next !== fallback) {
            updated.set(key, next)
          } else {
            updated.delete(key)
          }
          return updated
        },
        { replace: true },
      )
    },
    [key, fallback, setParams],
  )
  return [value, setValue] as const
}

export function matchesSearch(search: string, ...fields: Array<string | null | undefined>) {
  const needle = search.trim().toLowerCase()
  if (!needle) {
    return true
  }
  return fields.some((field) => field?.toLowerCase().includes(needle))
}
