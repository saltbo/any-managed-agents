// Pure trigger rules: secret-material detection (so raw secrets are kept out of
// metadata, resource refs, and plain env — they must use vault references),
// interval-based next-due computation, and the constrained HTTP prompt template
// renderer.

export class PromptTemplateRenderError extends Error {
  readonly field: string
  constructor(message: string, field: string) {
    super(message)
    this.name = 'PromptTemplateRenderError'
    this.field = field
  }
}

function secretKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('password') ||
    normalized.includes('privatekey')
  )
}

export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

export function nextDueFromInterval(intervalSeconds: number, from: number = Date.now()) {
  return new Date(from + intervalSeconds * 1000).toISOString()
}

export interface HttpTriggerTemplateContext {
  body: unknown
  query: Record<string, string>
  headers: Record<string, string>
}

const TEMPLATE_EXPRESSION = /{{\s*([^{}]+?)\s*}}/g
const PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$/

function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10)
      return Number.isInteger(index) ? current[index] : undefined
    }
    return (current as Record<string, unknown>)[segment]
  }, source)
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

export function renderHttpPromptTemplate(template: string, context: HttpTriggerTemplateContext): string {
  return template.replace(TEMPLATE_EXPRESSION, (_match, rawExpression: string) => {
    const expression = rawExpression.trim()
    const segments = expression.split('.')
    const root = segments[0]
    if ((root !== 'body' && root !== 'query' && root !== 'headers') || segments.length < 2) {
      throw new PromptTemplateRenderError(
        'Prompt template variables must read body, query, or headers paths.',
        expression,
      )
    }
    if (!segments.every((segment) => PATH_SEGMENT.test(segment) || /^\d+$/.test(segment))) {
      throw new PromptTemplateRenderError('Prompt template variable path is invalid.', expression)
    }
    const source = root === 'body' ? context.body : root === 'query' ? context.query : context.headers
    const value = readPath(source, segments.slice(1))
    if (value === undefined) {
      throw new PromptTemplateRenderError(`Prompt template variable "${expression}" was not found.`, expression)
    }
    return stringifyTemplateValue(value)
  })
}
