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
const CONDITIONAL_BLOCK =
  /\{\{#if\s+([^{}]+?)\}\}((?:(?!\{\{#if).)*?)(?:\{\{else\}\}((?:(?!\{\{#if).)*?))?\{\{\/if\}\}/gs
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

function parsePathExpression(expression: string) {
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
  return { root, path: segments.slice(1) }
}

function readTemplatePath(expression: string, context: HttpTriggerTemplateContext) {
  const { root, path } = parsePathExpression(expression)
  const source = root === 'body' ? context.body : root === 'query' ? context.query : context.headers
  return readPath(source, path)
}

function truthy(value: unknown) {
  if (value === null || value === undefined || value === false || value === '' || value === 0) {
    return false
  }
  return true
}

function parseLiteral(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) && trimmed !== '' ? numeric : trimmed
}

function tokenizeCondition(expression: string) {
  return expression.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
}

function evaluateCondition(expression: string, context: HttpTriggerTemplateContext): boolean {
  const tokens = tokenizeCondition(expression.trim())
  if (tokens.length === 1) {
    return truthy(readTemplatePath(tokens[0]!, context))
  }
  if ((tokens[0] === 'eq' || tokens[0] === 'ne') && tokens.length === 3) {
    const actual = readTemplatePath(tokens[1]!, context)
    const expected = parseLiteral(tokens[2]!)
    return tokens[0] === 'eq' ? actual === expected : actual !== expected
  }
  throw new PromptTemplateRenderError('Prompt template condition is invalid.', expression)
}

function renderConditionalBlocks(template: string, context: HttpTriggerTemplateContext) {
  let rendered = template
  while (CONDITIONAL_BLOCK.test(rendered)) {
    CONDITIONAL_BLOCK.lastIndex = 0
    rendered = rendered.replace(
      CONDITIONAL_BLOCK,
      (_match: string, rawExpression: string, ifContent: string, elseContent: string | undefined): string =>
        evaluateCondition(rawExpression.trim(), context) ? ifContent : (elseContent ?? ''),
    )
  }
  if (rendered.includes('{{#if') || rendered.includes('{{/if}}') || rendered.includes('{{else}}')) {
    throw new PromptTemplateRenderError('Prompt template conditional block is invalid.', 'if')
  }
  return rendered
}

export function renderHttpPromptTemplate(template: string, context: HttpTriggerTemplateContext): string {
  return renderConditionalBlocks(template, context).replace(TEMPLATE_EXPRESSION, (_match, rawExpression: string) => {
    const expression = rawExpression.trim()
    const value = readTemplatePath(expression, context)
    if (value === undefined) {
      throw new PromptTemplateRenderError(`Prompt template variable "${expression}" was not found.`, expression)
    }
    return stringifyTemplateValue(value)
  })
}
