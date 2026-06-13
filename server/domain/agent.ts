// Pure agent business rules. Zero outward imports — directly unit-testable.

export const BLOCKED_TOOLS = new Set(['secrets.read', 'filesystem.host', 'network.raw'])
export const TOOL_APPROVAL_MODES = ['none', 'per_call', 'always_required', 'project_policy'] as const

export type ToolApprovalMode = (typeof TOOL_APPROVAL_MODES)[number]

export interface AgentToolAttachment {
  name: string
  description: string | null
  inputSchema: Record<string, unknown>
  approvalMode: ToolApprovalMode
  policyMetadata: Record<string, unknown>
}

// Optional fields explicitly admit `undefined` so a zod-inferred request body
// (which carries `T | undefined` under exactOptionalPropertyTypes) is accepted.
export interface AgentToolAttachmentInput {
  name: string
  description?: string | null | undefined
  inputSchema?: Record<string, unknown> | undefined
  approvalMode?: ToolApprovalMode | undefined
  policyMetadata?: Record<string, unknown> | undefined
}

// The runtime-relevant configuration that an agent version snapshots.
export interface AgentConfig {
  instructions: string | null
  providerId: string | null
  model: string | null
  skills: string[]
  subagents: Record<string, unknown>[]
  role: string | null
  capabilityTags: string[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  tools: AgentToolAttachment[]
  mcpConnectors: string[]
  metadata: Record<string, unknown>
}

// Validation failures are keyed by the field that caused them; the http layer
// maps a non-null result to a 400 validation error envelope.
export type FieldErrors = Record<string, string>

export function normalizeToolAttachments(tools: AgentToolAttachmentInput[]): AgentToolAttachment[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? {},
    approvalMode: tool.approvalMode ?? 'project_policy',
    policyMetadata: tool.policyMetadata ?? {},
  }))
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function governanceBlocksTool(toolPolicy: Record<string, unknown>, toolName: string) {
  const blocked = stringList(toolPolicy.blockedTools)
  if (blocked.includes('*') || blocked.includes(toolName)) {
    return true
  }
  const allowed = stringList(toolPolicy.allowedTools)
  if (allowed.length > 0 && !allowed.includes('*') && !allowed.includes(toolName)) {
    return true
  }
  return toolPolicy.defaultEffect === 'deny'
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

function secretString(value: string) {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:sk|ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/.test(value) ||
    value.toLowerCase().includes('raw-secret')
  )
}

export function hasSecretMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    return secretString(value)
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretMaterial)
  }
  return Object.entries(value).some(([key, child]) => {
    return secretKey(key) || hasSecretMaterial(child)
  })
}

// Tool attachments are validated against governance tool policy at save time so
// a policy-blocked tool never reaches an agent version snapshot.
export function validateToolAttachments(
  tools: AgentToolAttachment[],
  toolPolicy: Record<string, unknown>,
): FieldErrors | null {
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) {
      return { tools: `Tool is attached more than once: ${tool.name}` }
    }
    names.add(tool.name)
    if (BLOCKED_TOOLS.has(tool.name) || governanceBlocksTool(toolPolicy, tool.name)) {
      return { tools: `Tool is blocked by policy: ${tool.name}` }
    }
    if (hasSecretMaterial(tool)) {
      return { tools: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

export function validateSkills(skills: string[]): FieldErrors | null {
  for (const skill of skills) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}@[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(skill) ||
      /[\s?#{}"'\\]/.test(skill)
    ) {
      return { skills: `Skill must be a stable <source>@<skill> reference: ${skill}` }
    }
    if (secretString(skill)) {
      return { skills: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

export function validateCapabilityTags(capabilityTags: string[]): FieldErrors | null {
  for (const tag of capabilityTags) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(tag)) {
      return { capabilityTags: `Capability tag must be a stable identifier: ${tag}` }
    }
    if (secretString(tag)) {
      return { capabilityTags: 'Secret material must be stored in a vault.' }
    }
  }
  return null
}

// Secret-material checks for the free-form JSON config fields. Returns a field
// error keyed to the offending field, or null.
export function validateConfigSecrets(config: {
  subagents: Record<string, unknown>[]
  handoffPolicy: Record<string, unknown>
  memoryPolicy: Record<string, unknown>
  metadata: Record<string, unknown>
}): FieldErrors | null {
  if (hasSecretMaterial(config.subagents)) {
    return { subagents: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(config.handoffPolicy)) {
    return { handoffPolicy: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(config.memoryPolicy)) {
    return { memoryPolicy: 'Secret material must be stored in a vault.' }
  }
  if (hasSecretMaterial(config.metadata)) {
    return { metadata: 'Secret material must be stored in a vault.' }
  }
  return null
}

// PATCH metadata semantics: spread the update over current, then drop keys the
// update explicitly set to null (the way callers clear a metadata key).
export function mergeMetadata(current: Record<string, unknown>, update: Record<string, unknown> | undefined) {
  if (!update) {
    return current
  }
  return Object.fromEntries(Object.entries({ ...current, ...update }).filter(([key]) => update[key] !== null))
}

export function nextVersionNumber(latestVersion: number | null) {
  return (latestVersion ?? 0) + 1
}

export function memoryEnabled(memoryPolicy: Record<string, unknown>) {
  return memoryPolicy.enabled === true
}

export interface HandoffTarget {
  role?: string
  capability?: string
}

export function policyHandoffTargets(handoffPolicy: Record<string, unknown>): HandoffTarget[] {
  const targets = Array.isArray(handoffPolicy.targets) ? handoffPolicy.targets : []
  return targets
    .filter((target): target is Record<string, unknown> => Boolean(target) && typeof target === 'object')
    .map((target) => ({
      ...(typeof target.role === 'string' && target.role ? { role: target.role } : {}),
      ...(typeof target.capability === 'string' && target.capability ? { capability: target.capability } : {}),
    }))
    .filter((target) => target.role !== undefined || target.capability !== undefined)
}

export function matchesHandoffTarget(
  targets: HandoffTarget[],
  candidate: { role: string | null; capabilityTags: string[] },
) {
  return targets.some(
    (target) =>
      (target.role !== undefined && candidate.role === target.role) ||
      (target.capability !== undefined && candidate.capabilityTags.includes(target.capability)),
  )
}
