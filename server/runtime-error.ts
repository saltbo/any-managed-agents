export interface SafeRuntimeError {
  type: 'runtime_error'
  message: string
  code?: string
}

export function safeRuntimeError(error: unknown): SafeRuntimeError {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error) {
    return {
      type: 'runtime_error',
      message,
      ...(error.name ? { code: error.name } : {}),
    }
  }
  return { type: 'runtime_error', message }
}
