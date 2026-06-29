import { resourceMetadata } from '@server/domain/resource'
import type { Trigger } from '@server/domain/trigger'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { type AuthScope, type TriggerConfig, TriggerConflictError, TriggerValidationError } from './ports'
import { createTrigger, deleteTrigger, updateTrigger } from './triggers'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function baseConfig(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    type: 'scheduled',
    agentId: 'agent_1',
    environmentId: 'env_1',
    runtime: 'ama',
    name: 'Heartbeat',
    promptTemplate: 'Do work.',
    env: {},
    envFrom: [],
    volumes: [],
    volumeMounts: [],
    schedule: { intervalSeconds: 3600, windowSeconds: 0 },
    enabled: true,
    nextDueAt: '2026-05-26T12:00:00.000Z',
    metadata: {},
    ...overrides,
  }
}

function triggerRecord(
  overrides: {
    metadata?: Partial<Trigger['metadata']>
    spec?: Partial<Trigger['spec']>
    status?: Partial<Trigger['status']>
  } = {},
): Trigger {
  const base = baseConfig()
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'trigger_1',
        pid: 'project_1',
        name: base.name,
        createdBy: 'user_1',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: {
      type: base.type,
      agentId: base.agentId,
      environmentId: base.environmentId,
      runtime: base.runtime,
      promptTemplate: base.promptTemplate,
      env: base.env,
      envFrom: base.envFrom,
      volumes: base.volumes,
      volumeMounts: base.volumeMounts,
      schedule: base.schedule ? { type: 'interval', ...base.schedule } : null,
      enabled: base.enabled,
      metadata: base.metadata,
      ...overrides.spec,
    },
    status: {
      phase: 'active',
      nextDueAt: base.nextDueAt,
      lastDispatchedAt: null,
      lastRunId: null,
      ...overrides.status,
    },
  }
}

function fakeDeps(repo: Partial<Deps['triggers']> = {}): Deps {
  const triggers: Deps['triggers'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insert: async (input, timestamp) =>
      triggerRecord({
        metadata: {
          uid: 'trigger_1',
          pid: input.projectId,
          name: input.config.name,
          createdBy: input.createdByUserId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        spec: {
          type: input.config.type,
          agentId: input.config.agentId,
          environmentId: input.config.environmentId,
          runtime: input.config.runtime,
          promptTemplate: input.config.promptTemplate,
          env: input.config.env,
          envFrom: input.config.envFrom,
          volumes: input.config.volumes,
          volumeMounts: input.config.volumeMounts,
          schedule: input.config.schedule ? { type: 'interval', ...input.config.schedule } : null,
          enabled: input.config.enabled,
          metadata: input.config.metadata,
        },
        status: { nextDueAt: input.config.nextDueAt },
      }),
    update: async (_p, id, fields, updatedAt) =>
      triggerRecord({
        metadata: { uid: id, name: fields.config.name, archivedAt: fields.archivedAt, updatedAt },
        spec: {
          type: fields.config.type,
          agentId: fields.config.agentId,
          environmentId: fields.config.environmentId,
          runtime: fields.config.runtime,
          promptTemplate: fields.config.promptTemplate,
          env: fields.config.env,
          envFrom: fields.config.envFrom,
          volumes: fields.config.volumes,
          volumeMounts: fields.config.volumeMounts,
          schedule: fields.config.schedule ? { type: 'interval', ...fields.config.schedule } : null,
          enabled: fields.config.enabled,
          metadata: fields.config.metadata,
        },
        status: { phase: fields.archivedAt ? 'archived' : 'active', nextDueAt: fields.config.nextDueAt },
      }),
    delete: async () => true,
    listRuns: async () => ({ rows: [], hasMore: false }),
    findRun: async () => null,
    agentUsable: async () => null,
    environmentUsable: async () => null,
    ...repo,
  }
  return { triggers } as unknown as Deps
}

describe('[spec: triggers/create] createTrigger', () => {
  it('creates a trigger when references are usable', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      agentId: 'agent_1',
      environmentId: 'env_1',
      config: { ...baseConfig(), nextDueAt: '2026-05-26T12:00:00.000Z' },
    })
    expect(trigger.spec.agentId).toBe('agent_1')
    expect(trigger.status.nextDueAt).toBe('2026-05-26T12:00:00.000Z')
  })

  it('creates an HTTP trigger without schedule timing [spec: triggers/http-create]', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      agentId: 'agent_1',
      environmentId: 'env_1',
      config: { ...baseConfig({ type: 'http', schedule: null, nextDueAt: null }), nextDueAt: null },
    })
    expect(trigger.spec.type).toBe('http')
    expect(trigger.spec.schedule).toBeNull()
    expect(trigger.status.nextDueAt).toBeNull()
  })

  it('derives nextDueAt from the interval when omitted', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      agentId: 'agent_1',
      environmentId: 'env_1',
      config: { ...baseConfig(), nextDueAt: null },
    })
    expect(trigger.status.nextDueAt).toEqual(expect.any(String))
  })

  it('rejects scheduled triggers without schedule timing', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        agentId: 'agent_1',
        environmentId: 'env_1',
        config: { ...baseConfig({ schedule: null }), nextDueAt: null },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects HTTP triggers with schedule timing', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        agentId: 'agent_1',
        environmentId: 'env_1',
        config: { ...baseConfig({ type: 'http' }), nextDueAt: null },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects secret metadata [spec: triggers/validation]', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        agentId: 'agent_1',
        environmentId: 'env_1',
        config: { ...baseConfig(), nextDueAt: null, metadata: { private_key: 'x' } },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects envFrom', async () => {
    await expect(
      createTrigger(fakeDeps(), auth, {
        agentId: 'agent_1',
        environmentId: 'env_1',
        config: { ...baseConfig(), nextDueAt: null, env: { AK_API_TOKEN: 'x' } },
      }),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('maps a missing agent to a 404 conflict', async () => {
    const deps = fakeDeps({ agentUsable: async () => ({ status: 404, message: 'Agent not found' }) })
    await expect(
      createTrigger(deps, auth, {
        agentId: 'agent_missing',
        environmentId: 'env_1',
        config: { ...baseConfig(), nextDueAt: null },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError', status: 404 })
  })

  it('maps an archived environment to a 409 conflict', async () => {
    const deps = fakeDeps({
      environmentUsable: async () => ({ status: 409, message: 'Selected environment is archived or unavailable' }),
    })
    await expect(
      createTrigger(deps, auth, {
        agentId: 'agent_1',
        environmentId: 'env_archived',
        config: { ...baseConfig(), nextDueAt: null },
      }),
    ).rejects.toMatchObject({ name: 'TriggerConflictError', status: 409 })
  })
})

describe('[spec: triggers/lifecycle] updateTrigger', () => {
  it('merges field updates and snapshots schedule changes', async () => {
    const result = await updateTrigger(fakeDeps(), auth, triggerRecord(), {
      name: 'Renamed',
      schedule: { intervalSeconds: 1800 },
    })
    expect(result.trigger.metadata.name).toBe('Renamed')
    expect(result.trigger.spec.schedule?.intervalSeconds).toBe(1800)
    expect(result.archived).toBe(false)
  })

  it('archives and reports the transition', async () => {
    const result = await updateTrigger(fakeDeps(), auth, triggerRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.trigger.metadata.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived trigger', async () => {
    const archived = triggerRecord({
      metadata: { archivedAt: '2026-02-01T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    await expect(updateTrigger(fakeDeps(), auth, archived, { name: 'nope' })).rejects.toBeInstanceOf(
      TriggerConflictError,
    )
  })

  it('restores an archived trigger', async () => {
    const archived = triggerRecord({
      metadata: { archivedAt: '2026-02-01T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    const result = await updateTrigger(fakeDeps(), auth, archived, { archived: false })
    expect(result.trigger.metadata.archivedAt).toBeNull()
    expect(result.archived).toBe(false)
  })

  it('re-validates references when the agent changes', async () => {
    const deps = fakeDeps({ agentUsable: async () => ({ status: 404, message: 'Agent not found' }) })
    await expect(updateTrigger(deps, auth, triggerRecord(), { agentId: 'agent_other' })).rejects.toMatchObject({
      name: 'TriggerConflictError',
      status: 404,
    })
  })

  it('converts a scheduled trigger to HTTP and clears timing', async () => {
    const result = await updateTrigger(fakeDeps(), auth, triggerRecord(), { type: 'http', schedule: null })
    expect(result.trigger.spec.type).toBe('http')
    expect(result.trigger.spec.schedule).toBeNull()
    expect(result.trigger.status.nextDueAt).toBeNull()
  })

  it('rejects an HTTP trigger update with schedule timing', async () => {
    await expect(
      updateTrigger(
        fakeDeps(),
        auth,
        triggerRecord({ spec: { type: 'http', schedule: null }, status: { nextDueAt: null } }),
        {
          schedule: { intervalSeconds: 60 },
        },
      ),
    ).rejects.toBeInstanceOf(TriggerValidationError)
  })

  it('rejects clearing schedule timing on a scheduled trigger', async () => {
    await expect(updateTrigger(fakeDeps(), auth, triggerRecord(), { schedule: null })).rejects.toBeInstanceOf(
      TriggerValidationError,
    )
  })
})

describe('[spec: triggers/delete] deleteTrigger', () => {
  it('deletes the trigger scoped to the project and reports that it existed', async () => {
    const calls: Array<{ projectId: string; triggerId: string }> = []
    const deps = fakeDeps({
      delete: async (projectId, triggerId) => {
        calls.push({ projectId, triggerId })
        return true
      },
    })
    const existed = await deleteTrigger(deps, auth, 'trigger_1')
    expect(existed).toBe(true)
    expect(calls).toEqual([{ projectId: 'project_1', triggerId: 'trigger_1' }])
  })

  it('reports a missing trigger so the caller can answer 404', async () => {
    const deps = fakeDeps({ delete: async () => false })
    await expect(deleteTrigger(deps, auth, 'trigger_missing')).resolves.toBe(false)
  })
})
