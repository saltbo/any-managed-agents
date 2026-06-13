// Pure session rules. No drizzle, no env, no hono. The operational state
// machine, hosting-mode derivation, prompt-delivery decision, approval-state
// purity, and the pure parts of snapshot construction live here so the usecase
// and runtime layers share one source of truth that is unit-testable in
// milliseconds.

export const SESSION_STATES = ['pending', 'running', 'idle', 'stopped', 'error'] as const
export type SessionState = (typeof SESSION_STATES)[number]

export const MESSAGE_DELIVERIES = ['live', 'queued'] as const
export type MessageDelivery = (typeof MESSAGE_DELIVERIES)[number]

export const MESSAGE_STATES = ['accepted', 'delivered', 'failed'] as const
export type MessageState = (typeof MESSAGE_STATES)[number]

export const APPROVAL_STATES = ['pending', 'approved', 'denied'] as const
export type ApprovalState = (typeof APPROVAL_STATES)[number]

export const EVENT_VISIBILITIES = ['runtime', 'transcript', 'debug', 'audit'] as const

export type SessionHostingMode = 'cloud' | 'self_hosted'

// A session accepts prompts only while its runtime is live (idle or running).
export function sessionAcceptsPrompts(state: SessionState): boolean {
  return state === 'idle' || state === 'running'
}

// A session is terminal once it has stopped or errored.
export function sessionIsTerminal(state: SessionState): boolean {
  return state === 'stopped' || state === 'error'
}

// Self-hosted sessions never own a sandbox; cloud sessions always do. The
// sandboxId presence is therefore the canonical hosting-mode discriminator at
// the runtime layer, where the environment snapshot is not always rehydrated.
export function hostingModeFromSandbox(sandboxId: string | null): SessionHostingMode {
  return sandboxId ? 'cloud' : 'self_hosted'
}

// Derives the hosting mode from a (normalized) environment snapshot. A missing
// or non-self-hosted snapshot defaults to cloud.
export function hostingModeFromSnapshot(hostingMode: unknown): SessionHostingMode {
  return hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud'
}

// Detects raw secret material in caller-provided config so it is rejected
// before it can be persisted: any key that looks like a secret, or any URL
// carrying embedded credentials, is treated as secret material.
export function hasSecretMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => secretKey(key) || hasSecretMaterial(child))
}

function secretKey(key: string) {
  return /secret|token|password|api[_-]?key/i.test(key)
}

export function hasEmbeddedCredentialUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      return Boolean(url.username || url.password)
    } catch {
      return false
    }
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasEmbeddedCredentialUrl)
  }
  return Object.values(value).some(hasEmbeddedCredentialUrl)
}

// Merges a metadata patch onto the current metadata, dropping keys the patch
// sets to null (the v1 metadata-delete convention).
export function mergeMetadataUpdate(
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ ...current, ...update }).filter(([key]) => update[key] !== null))
}

// Normalizes a github_repository resource mount path to a clean /workspace
// relative path, rejecting traversal, control characters, the reserved .ama
// root, and disallowed segment characters.
export function normalizeMountPath(resource: { owner: string; repo: string; mountPath?: string }): string {
  const requested = resource.mountPath?.trim() || `repos/${resource.owner}/${resource.repo}`
  if (/[\p{C}\\]/u.test(requested)) {
    throw new Error('Mount path contains invalid characters.')
  }
  if (requested.startsWith('/') && !requested.startsWith('/workspace/')) {
    throw new Error('Mount path must stay under /workspace.')
  }
  const relativePath = requested.startsWith('/workspace/') ? requested.slice('/workspace/'.length) : requested
  const segments = relativePath.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments[0] === '.ama'
  ) {
    throw new Error('Mount path must use clean relative segments outside /workspace/.ama.')
  }
  if (!segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Mount path segments may contain only letters, numbers, dots, underscores, and hyphens.')
  }
  return `/workspace/${segments.join('/')}`
}

// Composes the initial prompt with the agent's persisted memory block when
// memory is enabled and present. Pure given the resolved memory content.
export function composeInitialPrompt(
  memoryContent: string | null,
  initialPrompt: string | undefined,
): string | undefined {
  const content = memoryContent?.trim()
  if (!content) {
    return initialPrompt
  }
  const memoryBlock = ['Agent memory for this agent:', content].join('\n')
  return initialPrompt ? `${memoryBlock}\n\nCurrent task:\n${initialPrompt}` : memoryBlock
}
