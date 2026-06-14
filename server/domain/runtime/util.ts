// Pure leaf primitives shared across the session runtime clusters: id minting,
// timestamps, JSON shaping, request-id normalization, and a promise timeout box.
// These touch only crypto.randomUUID / Date / Promise, so they sit at the very
// bottom of the runtime DAG with zero outward dependencies.

// Cloud runtime startup window. Used both to time-bound the startup itself
// (cloud-turn) and to expire pending sessions whose window elapsed (lifecycle).
export const RUNTIME_START_TIMEOUT_MS = 300_000

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function now() {
  return new Date().toISOString()
}

export function stringify(value: unknown) {
  return JSON.stringify(value)
}

export function requestIdFrom(requestId: string | null | undefined) {
  return requestId ?? null
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
