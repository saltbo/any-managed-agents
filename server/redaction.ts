const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_KEY =
  /api[_-]?key|authorization|credential|password|secret|(^|[_-])token($|[_-])|access[_-]?token|refresh[_-]?token/i
const SENSITIVE_TEXT = /(bearer\s+|raw-[\w-]*token|secret|token=|api[_-]?key|password=)/i

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED_VALUE : redactSensitiveValue(item),
      ]),
    )
  }
  if (typeof value === 'string' && SENSITIVE_TEXT.test(value)) {
    return REDACTED_VALUE
  }
  return value
}
