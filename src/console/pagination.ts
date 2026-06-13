import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const DEFAULT_TABLE_PAGE_SIZE = 8

const FALLBACK_TABLE_CHROME_HEIGHT = 96
const FALLBACK_TABLE_ROW_HEIGHT = 48
const MIN_TABLE_PAGE_SIZE = 4
const MAX_TABLE_PAGE_SIZE = 20

export function useClientPagination<T>(items: T[], pageSize = DEFAULT_TABLE_PAGE_SIZE) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [adaptivePageSize, setAdaptivePageSize] = useState(pageSize)
  const effectivePageSize = adaptivePageSize
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / effectivePageSize))

  const measurePageSize = useCallback(() => {
    const viewport = viewportRef.current
    const height = viewport?.clientHeight
    if (!height) {
      setAdaptivePageSize(pageSize)
      return
    }

    const headerHeight = viewport.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const footerHeight =
      viewport.querySelector('[data-slot="table-pagination-footer"]')?.getBoundingClientRect().height ?? 0
    const rowHeight =
      viewport.querySelector('tbody tr:not([data-empty="true"])')?.getBoundingClientRect().height ??
      FALLBACK_TABLE_ROW_HEIGHT
    const chromeHeight = headerHeight + footerHeight + 1 || FALLBACK_TABLE_CHROME_HEIGHT
    const rows = Math.floor((height - chromeHeight) / rowHeight)
    const nextPageSize = Math.max(MIN_TABLE_PAGE_SIZE, Math.min(MAX_TABLE_PAGE_SIZE, rows))
    setAdaptivePageSize((current) => (current === nextPageSize ? current : nextPageSize))
  }, [pageSize])

  useEffect(() => {
    measurePageSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measurePageSize)
    if (viewportRef.current) observer?.observe(viewportRef.current)
    window.addEventListener('resize', measurePageSize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measurePageSize)
    }
  }, [measurePageSize])

  useEffect(() => {
    measurePageSize()
  }, [measurePageSize])

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  const pageItems = useMemo(() => {
    const start = (page - 1) * effectivePageSize
    return items.slice(start, start + effectivePageSize)
  }, [effectivePageSize, items, page])

  return {
    page,
    pageCount,
    pageItems,
    pageSize: effectivePageSize,
    total: items.length,
    viewportRef,
    setPage,
    firstItem: items.length === 0 ? 0 : (page - 1) * effectivePageSize + 1,
    lastItem: Math.min(page * effectivePageSize, items.length),
  }
}
