export const MEMORY_STORE_ACCESS = ['read_only', 'read_write'] as const
export type MemoryStoreAccess = (typeof MEMORY_STORE_ACCESS)[number]

export const MEMORY_STORE_MOUNT_ROOT = '/workspace/.ama/memory-stores'

export function memoryStoreMountPath(storeId: string): string {
  return `${MEMORY_STORE_MOUNT_ROOT}/${storeId}`
}

export function normalizeMemoryPath(path: string): string {
  const requested = path.trim()
  if (!requested) {
    throw new Error('Memory path is required.')
  }
  if (/[\p{C}\\]/u.test(requested)) {
    throw new Error('Memory path contains invalid characters.')
  }
  if (requested.startsWith('/')) {
    throw new Error('Memory path must be relative.')
  }
  const segments = requested.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments[0] === '.ama'
  ) {
    throw new Error('Memory path must use clean relative segments outside .ama.')
  }
  if (!segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Memory path segments may contain only letters, numbers, dots, underscores, and hyphens.')
  }
  return segments.join('/')
}

export function isMemoryStoreAccess(value: unknown): value is MemoryStoreAccess {
  return value === 'read_only' || value === 'read_write'
}
