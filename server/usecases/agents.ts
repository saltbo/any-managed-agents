import {
  type AgentConfig,
  type AgentToolAttachment,
  type HandoffTarget,
  hasSecretMaterial,
  matchesHandoffTarget,
  memoryEnabled,
  mergeMetadata,
  policyHandoffTargets,
  validateCapabilityTags,
  validateConfigSecrets,
  validateSkills,
  validateToolAttachments,
} from '@server/domain/agent'
import type { Deps } from './deps'
import {
  AgentArchivedError,
  type AgentHandoffCandidate,
  type AgentMemoryRecord,
  type AgentRecord,
  AgentValidationError,
  type AuthScope,
} from './ports'

// Validates the runtime config against sibling resources (provider/model,
// connectors), governance tool policy, and secret-material rules. Throws
// AgentValidationError on the first failure. `auth` is needed only to resolve
// the effective tool policy, and only when tools are present.
async function validateConfig(deps: Deps, auth: AuthScope, config: AgentConfig) {
  const providerError = await validateProviderRef(deps, auth.project.id, config.providerId)
  if (providerError) {
    throw new AgentValidationError('Invalid agent configuration', providerError)
  }
  const skillsError = validateSkills(config.skills)
  if (skillsError) {
    throw new AgentValidationError('Invalid agent configuration', skillsError)
  }
  if (hasSecretMaterial(config.subagents)) {
    throw new AgentValidationError('Invalid agent configuration', {
      subagents: 'Secret material must be stored in a vault.',
    })
  }
  const capabilityError = validateCapabilityTags(config.capabilityTags)
  if (capabilityError) {
    throw new AgentValidationError('Invalid agent configuration', capabilityError)
  }
  const toolPolicy = config.tools.length > 0 ? await deps.policy.resolveToolPolicy(auth) : {}
  const toolsError = validateToolAttachments(config.tools, toolPolicy)
  if (toolsError) {
    throw new AgentValidationError('Invalid agent configuration', toolsError)
  }
  const connectorError = await validateMcpConnectors(deps, auth.project.id, config.mcpConnectors)
  if (connectorError) {
    throw new AgentValidationError('Invalid agent configuration', connectorError)
  }
  const secretError = validateConfigSecrets(config)
  if (secretError) {
    throw new AgentValidationError('Invalid agent configuration', secretError)
  }
}

// A null providerId defers project-default resolution to session start, so it
// needs no validation here. The model is NOT checked against the catalog here:
// an agent is environment-agnostic at creation, so the hosting mode is unknown,
// and a self-hosted agent legitimately pins a runner-native model id (e.g.
// `opus`) that never appears in the global catalog. Model validity is therefore
// resolved at session creation, where the environment — and thus whether the
// catalog (cloud) or the runner's capabilities (self-hosted) is authoritative —
// is known.
async function validateProviderRef(deps: Deps, projectId: string, providerId: string | null) {
  if (!providerId) {
    return null
  }
  if (!(await deps.agents.providerEnabled(projectId, providerId))) {
    return { providerId: 'Provider is disabled or unavailable for this project.' }
  }
  return null
}

async function validateMcpConnectors(deps: Deps, projectId: string, connectorIds: string[]) {
  for (const connectorId of connectorIds) {
    if (!(await deps.agents.connectorConnected(projectId, connectorId))) {
      return { mcpConnectors: `MCP connector is not connected for this project: ${connectorId}` }
    }
  }
  return null
}

export async function createAgent(
  deps: Deps,
  auth: AuthScope,
  input: { name: string; description: string | null; config: AgentConfig },
): Promise<AgentRecord> {
  await validateConfig(deps, auth, input.config)
  const createdAt = new Date().toISOString()
  const agent = await deps.agents.insert(
    { projectId: auth.project.id, name: input.name, description: input.description, config: input.config },
    createdAt,
  )
  const version = await deps.agents.insertVersion(agent, input.config, createdAt)
  await deps.agents.setCurrentVersion(agent.id, version.id)
  return { ...agent, currentVersionId: version.id, version: version.version }
}

// The runtime config fields whose presence in a PATCH body forces a new version
// snapshot. (name/description are not runtime config — they never version.)
const RUNTIME_CONFIG_FIELDS = [
  'instructions',
  'providerId',
  'model',
  'skills',
  'subagents',
  'role',
  'capabilityTags',
  'handoffPolicy',
  'memoryPolicy',
  'tools',
  'mcpConnectors',
  'metadata',
] as const

export interface UpdateAgentPatch {
  name?: string
  description?: string | null
  instructions?: string | null
  providerId?: string | null
  model?: string | null
  skills?: string[]
  subagents?: Record<string, unknown>[]
  role?: string | null
  capabilityTags?: string[]
  handoffPolicy?: Record<string, unknown>
  memoryPolicy?: Record<string, unknown>
  tools?: AgentToolAttachment[]
  mcpConnectors?: string[]
  metadata?: Record<string, unknown>
  archived?: boolean
}

export interface UpdateAgentResult {
  agent: AgentRecord
  archived: boolean
}

// Orchestrates a PATCH: archive lifecycle transitions, field merge, config
// validation, and version snapshot creation. Returns the updated record plus
// whether an archive transition happened (so the route can audit). Throws
// AgentArchivedError when field updates target an archived agent.
export async function updateAgent(
  deps: Deps,
  auth: AuthScope,
  agent: AgentRecord,
  patch: UpdateAgentPatch,
): Promise<UpdateAgentResult> {
  const { archived, ...fields } = patch
  const hasFieldUpdates = Object.keys(fields).length > 0

  if (agent.archivedAt) {
    if (hasFieldUpdates) {
      throw new AgentArchivedError()
    }
    if (archived === false) {
      const updatedAt = new Date().toISOString()
      await deps.agents.unarchive(auth.project.id, agent.id, updatedAt)
      return { agent: { ...agent, archivedAt: null, updatedAt }, archived: false }
    }
    // archived: true (idempotent) or empty patch — no change.
    return { agent, archived: false }
  }

  const next: AgentConfig = {
    instructions: fields.instructions !== undefined ? fields.instructions : agent.instructions,
    providerId: fields.providerId !== undefined ? fields.providerId : agent.providerId,
    model: fields.model !== undefined ? fields.model : agent.model,
    skills: fields.skills ?? agent.skills,
    subagents: fields.subagents ?? agent.subagents,
    role: fields.role !== undefined ? fields.role : agent.role,
    capabilityTags: fields.capabilityTags ?? agent.capabilityTags,
    handoffPolicy: fields.handoffPolicy ?? agent.handoffPolicy,
    memoryPolicy: fields.memoryPolicy ?? agent.memoryPolicy,
    tools: fields.tools ?? agent.tools,
    mcpConnectors: fields.mcpConnectors ?? agent.mcpConnectors,
    metadata: mergeMetadata(agent.metadata, fields.metadata),
  }
  await validateConfig(deps, auth, next)

  const updatedAt = new Date().toISOString()
  const runtimeChanged = RUNTIME_CONFIG_FIELDS.some((field) => fields[field] !== undefined)
  // A runtime change snapshots a new immutable version; otherwise the current
  // version (id + number) is retained.
  const version = runtimeChanged ? await deps.agents.insertVersion(agent, next, updatedAt) : null
  const archivedAt = archived === true ? updatedAt : agent.archivedAt
  const name = fields.name ?? agent.name
  const description = fields.description !== undefined ? fields.description : agent.description
  const currentVersionId = version?.id ?? agent.currentVersionId

  await deps.agents.update(
    auth.project.id,
    agent.id,
    { name, description, config: next, archivedAt, currentVersionId },
    updatedAt,
  )

  const updated: AgentRecord = {
    ...agent,
    ...next,
    name,
    description,
    archivedAt,
    currentVersionId,
    version: version?.version ?? agent.version,
    updatedAt,
  }
  return { agent: updated, archived: archived === true }
}

export async function resolveHandoffCandidates(
  deps: Deps,
  projectId: string,
  agent: AgentRecord,
  requested: HandoffTarget,
): Promise<AgentHandoffCandidate[]> {
  const targets =
    requested.role !== undefined || requested.capability !== undefined
      ? [requested]
      : policyHandoffTargets(agent.handoffPolicy)
  if (targets.length === 0) {
    throw new AgentValidationError('No handoff target requested', {
      target: 'Request a role or capability, or configure handoff policy targets on the agent.',
    })
  }
  const rows = await deps.agents.liveAgents(projectId)
  return rows
    .filter((row) => row.id !== agent.id && matchesHandoffTarget(targets, row))
    .map((row) => ({ id: row.id, name: row.name, role: row.role, capabilityTags: row.capabilityTags }))
}

// Reads agent memory, lazily materializing an empty singleton on first read.
// Throws AgentValidationError-free; the route checks memoryEnabled and 409s.
export async function readAgentMemory(deps: Deps, projectId: string, agent: AgentRecord): Promise<AgentMemoryRecord> {
  const existing = await deps.agents.findMemory(projectId, agent.id)
  if (existing) {
    return existing
  }
  const timestamp = new Date().toISOString()
  const created: AgentMemoryRecord = {
    agentId: agent.id,
    projectId,
    content: '',
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await deps.agents.insertMemory(created)
  return created
}

export async function replaceAgentMemory(
  deps: Deps,
  projectId: string,
  agent: AgentRecord,
  input: { content: string; metadata: Record<string, unknown> },
): Promise<AgentMemoryRecord> {
  if (hasSecretMaterial(input.metadata)) {
    throw new AgentValidationError('Invalid agent memory', { metadata: 'Secret material must be stored in a vault.' })
  }
  const existing = await deps.agents.findMemory(projectId, agent.id)
  const timestamp = new Date().toISOString()
  if (!existing) {
    const created: AgentMemoryRecord = {
      agentId: agent.id,
      projectId,
      content: input.content,
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await deps.agents.insertMemory(created)
    return created
  }
  // PUT replaces the whole singleton: content and metadata are overwritten.
  await deps.agents.replaceMemory(projectId, agent.id, input.content, input.metadata, timestamp)
  return { ...existing, content: input.content, metadata: input.metadata, updatedAt: timestamp }
}

export { memoryEnabled }
