// Pure trigger rules: secret-material detection (so raw secrets are kept out of
// metadata, resource refs, and plain env — they must use vault references) and
// the interval-based next-due computation.

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
