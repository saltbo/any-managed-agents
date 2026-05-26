import { operations, type AmaOperationId } from './generated/operations.js'

export { operations, type AmaOperationId }

export type AmaClientOptions = {
  origin: string
  accessToken: string
}

export type AmaRequestOptions = {
  path?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

export class AmaClient {
  readonly #origin: string
  readonly #accessToken: string

  constructor(options: AmaClientOptions) {
    this.#origin = options.origin.replace(/\/$/, '')
    this.#accessToken = options.accessToken
  }

  async request<T>(operationId: AmaOperationId, options: AmaRequestOptions = {}) {
    const operation = operations.find((candidate) => candidate.operationId === operationId)
    if (!operation) {
      throw new Error(`Unknown AMA operation: ${operationId}`)
    }

    const url = new URL(`${this.#origin}${formatPath(operation.path, options.path ?? {})}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }

    const requestInit: RequestInit = {
      method: operation.method,
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    }
    if (options.body !== undefined) {
      requestInit.body = JSON.stringify(options.body)
    }

    const response = await fetch(url, requestInit)

    if (!response.ok) {
      throw new AmaApiError(response.status, await response.text())
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }
}

export class AmaApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseText: string,
  ) {
    super(`AMA API request failed with HTTP ${status}`)
  }
}

function formatPath(pathTemplate: string, values: Record<string, string>) {
  return pathTemplate.replaceAll(/\{([^}]+)\}/g, (_, key: string) => {
    const value = values[key]
    if (!value) {
      throw new Error(`Missing path parameter: ${key}`)
    }
    return encodeURIComponent(value)
  })
}
