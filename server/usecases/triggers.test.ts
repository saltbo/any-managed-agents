import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import {
  type AuthScope,
  type TriggerConfig,
  TriggerConflictError,
  type TriggerRecord,
  TriggerValidationError,
} from './ports'
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
    agentId: 'agent_1',
    environmentId: 'env_1',
    runtime: 'ama',
    name: 'Heartbeat',
    promptTemplate: 'Do work.',
    resourceRefs: [],
    env: {},
    secretEnv: [],
    schedule: { intervalSeconds: 3600, windowSeconds: 0 },
    enabled: true,
    nextDueAt: '2026-05-26T12:00:00.000Z',
    metadata: {},
    ...overrides,
  }
}

function triggerRecord(overrides: Partial<TriggerRecord> = {}): TriggerRecord {
  return {
    ...baseConfig(),
    id: 'trigger_1',
    projectId: 'project_1',
    lastDispatchedAt: null,
    lastRunId: null,
    createdByUserId: 'user_1',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['triggers']> = {}): Deps {
  const triggers: Deps['triggers'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insert: async (input, timestamp) => triggerRecord({ ...input.config, createdAt: timestamp, updatedAt: timestamp }),
    update: async (_p, id, fields, updatedAt) =>
      triggerRecord({ id, ...fields.config, archivedAt: fields.archivedAt, updatedAt }),
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
    expect(trigger.agentId).toBe('agent_1')
    expect(trigger.nextDueAt).toBe('2026-05-26T12:00:00.000Z')
  })

  it('derives nextDueAt from the interval when omitted', async () => {
    const trigger = await createTrigger(fakeDeps(), auth, {
      agentId: 'agent_1',
      environmentId: 'env_1',
      config: { ...baseConfig(), nextDueAt: null },
    })
    expect(trigger.nextDueAt).toEqual(expect.any(String))
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

  it('rejects secret env', async () => {
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
    expect(result.trigger.name).toBe('Renamed')
    expect(result.trigger.schedule.intervalSeconds).toBe(1800)
    expect(result.archived).toBe(false)
  })

  it('archives and reports the transition', async () => {
    const result = await updateTrigger(fakeDeps(), auth, triggerRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.trigger.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived trigger', async () => {
    const archived = triggerRecord({ archivedAt: '2026-02-01T00:00:00.000Z' })
    await expect(updateTrigger(fakeDeps(), auth, archived, { name: 'nope' })).rejects.toBeInstanceOf(
      TriggerConflictError,
    )
  })

  it('restores an archived trigger', async () => {
    const archived = triggerRecord({ archivedAt: '2026-02-01T00:00:00.000Z' })
    const result = await updateTrigger(fakeDeps(), auth, archived, { archived: false })
    expect(result.trigger.archivedAt).toBeNull()
    expect(result.archived).toBe(false)
  })

  it('re-validates references when the agent changes', async () => {
    const deps = fakeDeps({ agentUsable: async () => ({ status: 404, message: 'Agent not found' }) })
    await expect(updateTrigger(deps, auth, triggerRecord(), { agentId: 'agent_other' })).rejects.toMatchObject({
      name: 'TriggerConflictError',
      status: 404,
    })
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
