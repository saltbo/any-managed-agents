const encoder = new TextEncoder()

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array | string) {
  const data =
    typeof bytes === 'string' ? encoder.encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let value = ''
  for (const byte of data) {
    value += String.fromCharCode(byte)
  }
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function base64UrlDecode(value: string) {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export async function sha256(value: string) {
  return base64UrlEncode(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

export async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return base64UrlEncode(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  }
  return diff === 0
}
