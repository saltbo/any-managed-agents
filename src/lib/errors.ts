// Normalizes a thrown value to a display string. The api client always throws
// ApiError (extends Error), but tanstack-query `onError` hands back `unknown`,
// so the non-Error fallback lives — and is tested — in exactly one place instead
// of as a dead defensive ternary repeated across every mutation callback.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
