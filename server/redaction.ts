const REDACTED_VALUE = '[REDACTED]'

const SECRET_KEY =
  /(^|[_-])(api[_-]?key|authorization|client[_-]?secret|credential|password|private[_-]?key|refresh[_-]?token|access[_-]?token|token|secret[_-]?key)($|[_-])/i

const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|authorization|client[_-]?secret|password|private[_-]?key|refresh[_-]?token|access[_-]?token|token|secret[_-]?key)\b(\s*[:=]\s*)(["']?)([^\s"',;]+)/gi

const SENSITIVE_TEXT = /(bearer\s+|raw-[\w-]*token|secret|token=|api[_-]?key|password=)/i

const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi
const BASIC_AUTH = /\bBasic\s+[A-Za-z0-9+/=]{16,}/gi
const GITHUB_TOKEN = /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g
const OPENAI_TOKEN = /\bsk-[A-Za-z0-9_-]{20,}\b/g
const ANTHROPIC_TOKEN = /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g
const CLOUDFLARE_TOKEN = /\b(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN)\s*[:=]\s*([A-Za-z0-9._-]{20,})/gi
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

function redactSecretText(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, REDACTED_VALUE)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED_VALUE}`)
    .replace(BASIC_AUTH, `Basic ${REDACTED_VALUE}`)
    .replace(GITHUB_TOKEN, REDACTED_VALUE)
    .replace(OPENAI_TOKEN, REDACTED_VALUE)
    .replace(ANTHROPIC_TOKEN, REDACTED_VALUE)
    .replace(CLOUDFLARE_TOKEN, (match) => match.replace(/([:=]\s*)([A-Za-z0-9._-]{20,})/, `$1${REDACTED_VALUE}`))
    .replace(SECRET_ASSIGNMENT, (_match, key: string, separator: string, quote: string) => {
      return `${key}${separator}${quote}${REDACTED_VALUE}`
    })
}

function redactToolResultValue(value: unknown, parentKey?: string): unknown {
  if (typeof parentKey === 'string' && SECRET_KEY.test(parentKey)) {
    return REDACTED_VALUE
  }
  if (typeof value === 'string') {
    return redactSecretText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactToolResultValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactToolResultValue(child, key)]))
  }
  return value
}

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? REDACTED_VALUE : redactSensitiveValue(item),
      ]),
    )
  }
  if (typeof value === 'string' && SENSITIVE_TEXT.test(value)) {
    return REDACTED_VALUE
  }
  return value
}

function redactToolResultBlock(block: Record<string, unknown>): Record<string, unknown> {
  return {
    ...block,
    ...(block.result !== undefined ? { result: redactToolResultValue(block.result) } : {}),
    ...(block.error !== undefined ? { error: redactToolResultValue(block.error) } : {}),
  }
}

export function redactToolResultsFromPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }
  const message = (payload as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return payload
  }
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) {
    return payload
  }
  const contentBlocks: unknown[] = content
  return {
    ...(payload as Record<string, unknown>),
    message: {
      ...(message as Record<string, unknown>),
      content: contentBlocks.map((block) => {
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
          return block
        }
        const record = block as Record<string, unknown>
        return record.type === 'tool_result' ? redactToolResultBlock(record) : record
      }),
    },
  }
}
