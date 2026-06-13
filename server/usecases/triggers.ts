import { hasSecretMaterial, nextDueFromInterval } from '@server/domain/trigger'
import type { Deps } from './deps'
import {
  type AuthScope,
  type TriggerConfig,
  TriggerConflictError,
  type TriggerRecord,
  TriggerValidationError,
} from './ports'

// Raw secrets must be stored as vault references, so trigger metadata, resource
// refs, and plain env are rejected when they carry secret-like material.
function rejectSecretMaterial(input: {
  metadata?: Record<string, unknown> | undefined
  resourceRefs?: Record<string, unknown>[] | undefined
  env?: Record<string, string> | undefined
}) {
  if (input.metadata !== undefined && hasSecretMaterial(input.metadata)) {
    throw new TriggerValidationError('Invalid trigger metadata', {
      metadata: 'Secret material must be stored in vault references.',
    })
  }
  if (
    (input.resourceRefs !== undefined && hasSecretMaterial(input.resourceRefs)) ||
    (input.env !== undefined && hasSecretMaterial(input.env))
  ) {
    throw new TriggerValidationError('Invalid trigger session configuration', {
      resourceRefs: 'Resource references must not contain secret material.',
      env: 'Environment variables must not contain raw secret material.',
    })
  }
}

// The referenced agent and environment must both be live for the trigger to
// dispatch. A missing reference is a 404; an archived/unavailable one is a 409.
async function assertReferencesUsable(deps: Deps, projectId: string, agentId: string, environmentId: string) {
  const agentError = await deps.triggers.agentUsable(projectId, agentId)
  if (agentError) {
    throw new TriggerConflictError(agentError.message, agentError.status)
  }
  const environmentError = await deps.triggers.environmentUsable(projectId, environmentId)
  if (environmentError) {
    throw new TriggerConflictError(environmentError.message, environmentError.status)
  }
}

export interface CreateTriggerInputDto {
  agentId: string
  environmentId: string
  config: Omit<TriggerConfig, 'agentId' | 'environmentId' | 'nextDueAt'> & { nextDueAt: string | null }
}

export async function createTrigger(deps: Deps, auth: AuthScope, input: CreateTriggerInputDto): Promise<TriggerRecord> {
  rejectSecretMaterial(input.config)
  await assertReferencesUsable(deps, auth.project.id, input.agentId, input.environmentId)

  const timestamp = new Date().toISOString()
  const config: TriggerConfig = {
    agentId: input.agentId,
    environmentId: input.environmentId,
    runtime: input.config.runtime,
    name: input.config.name,
    promptTemplate: input.config.promptTemplate,
    resourceRefs: input.config.resourceRefs,
    env: input.config.env,
    secretEnv: input.config.secretEnv,
    schedule: input.config.schedule,
    enabled: input.config.enabled,
    nextDueAt: input.config.nextDueAt ?? nextDueFromInterval(input.config.schedule.intervalSeconds),
    metadata: input.config.metadata,
  }
  return deps.triggers.insert(
    {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      config,
      createdByUserId: auth.user.id,
    },
    timestamp,
  )
}

export interface UpdateTriggerPatch {
  agentId?: string
  environmentId?: string
  runtime?: TriggerConfig['runtime']
  name?: string
  promptTemplate?: string
  resourceRefs?: Record<string, unknown>[]
  env?: Record<string, string>
  secretEnv?: TriggerConfig['secretEnv']
  schedule?: { intervalSeconds?: number; windowSeconds?: number }
  enabled?: boolean
  archived?: boolean
  nextDueAt?: string
  metadata?: Record<string, unknown>
}

export interface UpdateTriggerResult {
  trigger: TriggerRecord
  archived: boolean
}

// Orchestrates a PATCH: archive lifecycle (archive/restore), secret-material
// rejection, agent/environment reference re-validation when changed, field
// merge. Throws TriggerConflictError when field updates target an archived
// trigger.
export async function updateTrigger(
  deps: Deps,
  auth: AuthScope,
  trigger: TriggerRecord,
  patch: UpdateTriggerPatch,
): Promise<UpdateTriggerResult> {
  if (trigger.archivedAt !== null && patch.archived !== false) {
    throw new TriggerConflictError('Archived triggers cannot be updated')
  }
  rejectSecretMaterial({ metadata: patch.metadata, resourceRefs: patch.resourceRefs, env: patch.env })

  const agentId = patch.agentId ?? trigger.agentId
  const environmentId = patch.environmentId ?? trigger.environmentId
  if (patch.agentId !== undefined || patch.environmentId !== undefined) {
    await assertReferencesUsable(deps, auth.project.id, agentId, environmentId)
  }

  const timestamp = new Date().toISOString()
  const archivedAt =
    patch.archived === true ? (trigger.archivedAt ?? timestamp) : patch.archived === false ? null : trigger.archivedAt
  const config: TriggerConfig = {
    agentId,
    environmentId,
    runtime: patch.runtime ?? trigger.runtime,
    name: patch.name ?? trigger.name,
    promptTemplate: patch.promptTemplate ?? trigger.promptTemplate,
    resourceRefs: patch.resourceRefs ?? trigger.resourceRefs,
    env: patch.env ?? trigger.env,
    secretEnv: patch.secretEnv ?? trigger.secretEnv,
    schedule: {
      intervalSeconds: patch.schedule?.intervalSeconds ?? trigger.schedule.intervalSeconds,
      windowSeconds: patch.schedule?.windowSeconds ?? trigger.schedule.windowSeconds,
    },
    enabled: patch.enabled ?? trigger.enabled,
    nextDueAt: patch.nextDueAt ?? trigger.nextDueAt,
    metadata: patch.metadata ?? trigger.metadata,
  }
  const updated = await deps.triggers.update(auth.project.id, trigger.id, { config, archivedAt }, timestamp)
  return { trigger: updated, archived: patch.archived === true && trigger.archivedAt === null }
}
