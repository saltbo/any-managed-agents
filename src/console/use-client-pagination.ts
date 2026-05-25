import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'

export const DEFAULT_PAGE_SIZE = 10

export interface ClientPagination<T> {
  items: T[]
  page: number
  pageCount: number
  pageSize: number
  total: number
  start: number
  end: number
  canPrevious: boolean
  canNext: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  previous: () => void
  next: () => void
}

export function useClientPagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE): ClientPagination<T> {
  const [page, setPage] = useState(1)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previousResetRef = useRef<{ items: T[]; page: number; pageSize: number } | null>(null)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const startIndex = (currentPage - 1) * pageSize
  const pagedItems = useMemo(() => items.slice(startIndex, startIndex + pageSize), [items, pageSize, startIndex])

  useEffect(() => {
    if (page !== currentPage) {
      setPage(currentPage)
    }
  }, [currentPage, page])

  useEffect(() => {
    const previous = previousResetRef.current
    previousResetRef.current = { items, page: currentPage, pageSize }
    if (previous?.items === items && previous.page === currentPage && previous.pageSize === pageSize) {
      return
    }
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0
    }
  }, [currentPage, items, pageSize])

  return {
    items: pagedItems,
    page: currentPage,
    pageCount,
    pageSize,
    total: items.length,
    start: items.length === 0 ? 0 : startIndex + 1,
    end: Math.min(startIndex + pagedItems.length, items.length),
    canPrevious: currentPage > 1,
    canNext: currentPage < pageCount,
    viewportRef,
    previous: () => setPage((value) => Math.max(1, value - 1)),
    next: () => setPage((value) => Math.min(pageCount, value + 1)),
  }
}
