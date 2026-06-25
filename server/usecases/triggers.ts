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

// The referenced agent must be live for the trigger to dispatch, and a pinned
// environment must be live too. A null environment is left to per-dispatch
// resolution and skips the environment check. A missing reference is a 404; an
// archived/unavailable one is a 409.
async function assertReferencesUsable(deps: Deps, projectId: string, agentId: string, environmentId: string | null) {
  const agentError = await deps.triggers.agentUsable(projectId, agentId)
  if (agentError) {
    throw new TriggerConflictError(agentError.message, agentError.status)
  }
  if (environmentId !== null) {
    const environmentError = await deps.triggers.environmentUsable(projectId, environmentId)
    if (environmentError) {
      throw new TriggerConflictError(environmentError.message, environmentError.status)
    }
  }
}

export interface CreateTriggerInputDto {
  agentId: string
  environmentId: string | null
  config: Omit<TriggerConfig, 'agentId' | 'environmentId' | 'nextDueAt'> & { nextDueAt: string | null }
}

function normalizeScheduleConfig(config: CreateTriggerInputDto['config']) {
  if (config.type === 'scheduled') {
    if (config.schedule === null) {
      throw new TriggerValidationError('Invalid trigger schedule', {
        schedule: 'Scheduled triggers require an interval schedule.',
      })
    }
    return {
      schedule: config.schedule,
      nextDueAt: config.nextDueAt ?? nextDueFromInterval(config.schedule.intervalSeconds),
    }
  }
  if (config.schedule !== null || config.nextDueAt !== null) {
    throw new TriggerValidationError('Invalid trigger schedule', {
      schedule: 'HTTP triggers do not use schedule timing.',
    })
  }
  return { schedule: null, nextDueAt: null }
}

export async function createTrigger(deps: Deps, auth: AuthScope, input: CreateTriggerInputDto): Promise<TriggerRecord> {
  rejectSecretMaterial(input.config)
  await assertReferencesUsable(deps, auth.project.id, input.agentId, input.environmentId)

  const timestamp = new Date().toISOString()
  const timing = normalizeScheduleConfig(input.config)
  const config: TriggerConfig = {
    type: input.config.type,
    agentId: input.agentId,
    environmentId: input.environmentId,
    runtime: input.config.runtime,
    name: input.config.name,
    promptTemplate: input.config.promptTemplate,
    resourceRefs: input.config.resourceRefs,
    env: input.config.env,
    secretEnv: input.config.secretEnv,
    schedule: timing.schedule,
    enabled: input.config.enabled,
    nextDueAt: timing.nextDueAt,
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
  type?: TriggerConfig['type']
  agentId?: string
  environmentId?: string
  runtime?: TriggerConfig['runtime']
  name?: string
  promptTemplate?: string
  resourceRefs?: Record<string, unknown>[]
  env?: Record<string, string>
  secretEnv?: TriggerConfig['secretEnv']
  schedule?: { intervalSeconds?: number; windowSeconds?: number } | null
  enabled?: boolean
  archived?: boolean
  nextDueAt?: string
  metadata?: Record<string, unknown>
}

function mergeSchedule(
  trigger: TriggerRecord,
  patch: UpdateTriggerPatch,
): Pick<TriggerConfig, 'type' | 'schedule' | 'nextDueAt'> {
  const type = patch.type ?? trigger.type
  if (type === 'http') {
    if (patch.schedule !== undefined && patch.schedule !== null) {
      throw new TriggerValidationError('Invalid trigger schedule', {
        schedule: 'HTTP triggers do not use schedule timing.',
      })
    }
    return { type, schedule: null, nextDueAt: null }
  }
  const current = trigger.schedule
  const schedule =
    patch.schedule === null
      ? null
      : {
          intervalSeconds: patch.schedule?.intervalSeconds ?? current?.intervalSeconds,
          windowSeconds: patch.schedule?.windowSeconds ?? current?.windowSeconds ?? 0,
        }
  if (schedule === null || schedule.intervalSeconds === undefined) {
    throw new TriggerValidationError('Invalid trigger schedule', {
      schedule: 'Scheduled triggers require an interval schedule.',
    })
  }
  return { type, schedule: schedule as TriggerConfig['schedule'], nextDueAt: patch.nextDueAt ?? trigger.nextDueAt }
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
  const timing = mergeSchedule(trigger, patch)

  const agentId = patch.agentId ?? trigger.agentId
  const environmentId = patch.environmentId ?? trigger.environmentId
  if (patch.agentId !== undefined || patch.environmentId !== undefined) {
    await assertReferencesUsable(deps, auth.project.id, agentId, environmentId)
  }

  const timestamp = new Date().toISOString()
  const archivedAt =
    patch.archived === true ? (trigger.archivedAt ?? timestamp) : patch.archived === false ? null : trigger.archivedAt
  const config: TriggerConfig = {
    type: timing.type,
    agentId,
    environmentId,
    runtime: patch.runtime ?? trigger.runtime,
    name: patch.name ?? trigger.name,
    promptTemplate: patch.promptTemplate ?? trigger.promptTemplate,
    resourceRefs: patch.resourceRefs ?? trigger.resourceRefs,
    env: patch.env ?? trigger.env,
    secretEnv: patch.secretEnv ?? trigger.secretEnv,
    schedule: timing.schedule,
    enabled: patch.enabled ?? trigger.enabled,
    nextDueAt: timing.nextDueAt,
    metadata: patch.metadata ?? trigger.metadata,
  }
  const updated = await deps.triggers.update(auth.project.id, trigger.id, { config, archivedAt }, timestamp)
  return { trigger: updated, archived: patch.archived === true && trigger.archivedAt === null }
}

// Hard-deletes the trigger and its runs, tenant-scoped. Returns false when no
// matching trigger exists in the project so the http layer can answer 404.
export async function deleteTrigger(deps: Deps, auth: AuthScope, triggerId: string): Promise<boolean> {
  return deps.triggers.delete(auth.project.id, triggerId)
}
