import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { dispatchDueScheduledTriggers } from './dispatch-triggers'
import type { ClaimedRun, DueTrigger, SessionRecord } from './ports'

function dueTrigger(overrides: Partial<DueTrigger> = {}): DueTrigger {
  return {
    id: 'trigger_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Nightly Agent',
    agentId: 'agent_1',
    environmentId: 'env_1',
    runtime: 'ama',
    promptTemplate: 'Run the analysis',
    resourceRefs: [],
    metadata: {},
    nextDueAt: '2026-01-01T00:00:00.000Z',
    intervalSeconds: 3600,
    ...overrides,
  }
}

function claimedRun(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: 'run_1',
    scheduledFor: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr_1',
    ...overrides,
  }
}

function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'sess_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: {},
    environmentId: 'env_1',
    environmentVersionId: null,
    environmentSnapshot: null,
    title: null,
    resourceRefs: [],
    env: {},
    secretEnv: [],
    runtimeMetadata: {
      hostingMode: 'cloud',
      runtime: 'ama',
      runtimeConfig: {},
      provider: 'workers-ai',
      model: null,
      driver: null,
      backend: null,
      protocol: null,
    },
    state: 'pending',
    stateReason: null,
    metadata: {},
    startedAt: null,
    stoppedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(
  overrides: {
    triggerDispatch?: Partial<Deps['triggerDispatch']>
    sessionRuntime?: Partial<Deps['sessionRuntime']>
    audit?: Partial<Deps['audit']>
  } = {},
): Deps {
  const triggerDispatch: Deps['triggerDispatch'] = {
    dueTriggers: async () => [],
    claimRun: async () => claimedRun(),
    projectName: async () => 'My Project',
    markRunFailed: async () => {},
    markRunSessionCreated: async () => {},
    ...overrides.triggerDispatch,
  }
  const sessionRuntime: Deps['sessionRuntime'] = {
    createSession: async () => ({ ok: true, value: sessionRecord() }),
    stopSession: async () => ({ ok: true, value: sessionRecord({ state: 'stopped' }) }),
    archiveSession: async () => ({ ok: true, value: sessionRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }) }),
    unarchiveSession: async () => sessionRecord(),
    dispatchPrompt: async () => ({ ok: true, delivery: 'live', state: 'accepted' }),
    decideApproval: async () => ({
      ok: true,
      value: {
        id: 'appr_1',
        sessionId: 'sess_1',
        toolCallId: 'tc_1',
        toolName: 'tool',
        input: {},
        relatedEventIds: [],
        state: 'approved',
        reason: null,
        result: null,
        requestedAt: 'T',
        decidedAt: 'T',
        createdAt: 'T',
        updatedAt: 'T',
      },
    }),
    markExpiredPending: async () => {},
    ...overrides.sessionRuntime,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: undefined as unknown as Deps['vaults'],
    secretStore: undefined as unknown as Deps['secretStore'],
    connectors: undefined as unknown as Deps['connectors'],
    connections: undefined as unknown as Deps['connections'],
    policies: undefined as unknown as Deps['policies'],
    accessRules: undefined as unknown as Deps['accessRules'],
    budgets: undefined as unknown as Deps['budgets'],
    mcp: undefined as unknown as Deps['mcp'],
    sessionEvents: undefined as unknown as Deps['sessionEvents'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    projects: undefined as unknown as Deps['projects'],
    federatedTenants: undefined as unknown as Deps['federatedTenants'],
    runners: undefined as unknown as Deps['runners'],
    workItems: undefined as unknown as Deps['workItems'],
    leases: undefined as unknown as Deps['leases'],
    runtimeSecretEnv: undefined as unknown as Deps['runtimeSecretEnv'],
    cloudTurnQueue: undefined as unknown as Deps['cloudTurnQueue'],
    runnerChannel: undefined as unknown as Deps['runnerChannel'],
    sandboxRuntime: undefined as unknown as Deps['sandboxRuntime'],
    sessionOrchestration: undefined as unknown as Deps['sessionOrchestration'],
    sessions: undefined as unknown as Deps['sessions'],
    audit: { record: async () => {}, ...overrides.audit },
    policy: {
      resolveToolPolicy: async () => ({}),
      resolveMcpPolicy: async () => ({}),
      evaluateMcpTool: async () => ({ allowed: true, category: 'mcp', rule: null, message: '' }),
      resolveEffective: async () => ({
        source: { type: 'platform_default', id: 'workers-ai-default' },
        sources: [],
        accessRules: [],
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
      }),
      evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
      evaluateSandboxRuntime: async () => ({ allowed: true, category: 'sandbox', rule: null, message: '' }),
      policyBlocksSandboxOperation: async () => null,
      toolPolicyRequiresApproval: async () => false,
      evaluateProviderForSession: async () => ({
        decision: { allowed: true, category: 'provider', rule: null, message: '' },
        override: null,
      }),
    },
    triggerDispatch,
    sessionRuntime,
  }
}

// ── dispatchDueScheduledTriggers ─────────────────────────────────────────────

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — empty queue', () => {
  it('returns zero counts when no triggers are due', async () => {
    const result = await dispatchDueScheduledTriggers(fakeDeps())
    expect(result.claimed).toBe(0)
    expect(result.sessionCreated).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.runs).toHaveLength(0)
  })

  it('uses the provided heartbeatAt timestamp', async () => {
    let captured: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          captured = opts.heartbeatAt
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps, { heartbeatAt: '2026-06-01T00:00:00.000Z' })
    expect(captured).toBe('2026-06-01T00:00:00.000Z')
  })

  it('defaults to a current ISO timestamp when heartbeatAt is omitted', async () => {
    let captured: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          captured = opts.heartbeatAt
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(captured).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('filters by projectId when provided', async () => {
    let capturedProjectId: string | undefined
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedProjectId = opts.projectId
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps, { projectId: 'project_x' })
    expect(capturedProjectId).toBe('project_x')
  })

  it('omits projectId from the query when not provided', async () => {
    let capturedOpts: Record<string, unknown> = {}
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedOpts = opts as unknown as Record<string, unknown>
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedOpts).not.toHaveProperty('projectId')
  })

  it('uses the default limit of 50 when not specified', async () => {
    let capturedLimit: number | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedLimit = opts.limit
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedLimit).toBe(50)
  })

  it('forwards a custom limit', async () => {
    let capturedLimit: number | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async (opts) => {
          capturedLimit = opts.limit
          return []
        },
      },
    })
    await dispatchDueScheduledTriggers(deps, { limit: 10 })
    expect(capturedLimit).toBe(10)
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — successful dispatch', () => {
  it('increments claimed and sessionCreated for a successfully dispatched trigger', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.claimed).toBe(1)
    expect(result.sessionCreated).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('records a run entry with session_created status', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]!.status).toBe('session_created')
    expect(result.runs[0]!.sessionId).toBe('sess_1')
    expect(result.runs[0]!.triggerId).toBe('trigger_1')
    expect(result.runs[0]!.errorMessage).toBeNull()
  })

  it('marks the run as session_created in the repo', async () => {
    const trigger = dueTrigger()
    let marked = false
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        markRunSessionCreated: async () => {
          marked = true
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(marked).toBe(true)
  })

  it('records the dispatch outcome in the audit log on success', async () => {
    const trigger = dueTrigger()
    const auditEntries: string[] = []
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
      audit: {
        record: async (_auth, entry) => {
          auditEntries.push(entry.action)
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(auditEntries).toContain('scheduled_trigger.dispatch')
  })

  it('includes trigger metadata in session metadata', async () => {
    const trigger = dueTrigger({ metadata: { env: 'staging' } })
    let capturedMetadata: Record<string, unknown> | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        markRunSessionCreated: async (_t, _r, _sid, meta) => {
          capturedMetadata = meta
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedMetadata).toMatchObject({
      env: 'staging',
      source: 'scheduled-agent-trigger',
      scheduledTriggerId: 'trigger_1',
    })
  })

  it('builds system auth with resolved project name', async () => {
    const trigger = dueTrigger()
    let capturedProjectName: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => 'Resolved Name',
      },
      audit: {
        record: async (authArg) => {
          capturedProjectName = authArg.project.name
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(capturedProjectName).toBe('Resolved Name')
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — skipped (already claimed)', () => {
  it('increments skipped when claimRun returns null', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => null,
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.skipped).toBe(1)
    expect(result.claimed).toBe(0)
    expect(result.runs).toHaveLength(0)
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — failed dispatch', () => {
  it('increments failed and records a run entry when createSession returns an error', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 400, code: 'validation', message: 'Agent not found' },
        }),
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.claimed).toBe(1)
    expect(result.sessionCreated).toBe(0)
    expect(result.runs[0]!.status).toBe('failed')
    expect(result.runs[0]!.errorMessage).toBe('Agent not found')
    expect(result.runs[0]!.sessionId).toBeNull()
  })

  it('marks the run as failed in the repo when createSession errors', async () => {
    const trigger = dueTrigger()
    let markedFailed = false
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        markRunFailed: async () => {
          markedFailed = true
        },
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 500, code: 'runtime_error', message: 'Crash' },
        }),
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(markedFailed).toBe(true)
  })

  it('records failure in audit log when createSession errors', async () => {
    const trigger = dueTrigger()
    let outcome: string | null = null
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
      },
      sessionRuntime: {
        createSession: async () => ({
          ok: false,
          error: { status: 500, code: 'runtime_error', message: 'Crash' },
        }),
      },
      audit: {
        record: async (_auth, entry) => {
          outcome = (entry as { outcome?: string }).outcome ?? null
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(outcome).toBe('failure')
  })

  it('handles thrown error from projectName gracefully, incrementing failed', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => {
          throw new Error('DB connection failed')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.runs[0]!.status).toBe('failed')
    expect(result.runs[0]!.errorMessage).toContain('DB connection failed')
  })

  it('fails the run when projectName returns null', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => null,
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.runs[0]!.errorMessage).toContain('project is unavailable')
  })

  it('redacts sensitive values in error messages', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        projectName: async () => {
          throw new Error('bearer secrettoken123')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs[0]!.errorMessage).toBe('[REDACTED]')
  })
})

describe('[spec: triggers/dispatch] dispatchDueScheduledTriggers — outer exception (dispatchTrigger throws)', () => {
  it('handles a thrown error from claimRun without crashing, incrementing failed', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => {
          throw new Error('Unexpected DB error')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]!.runId).toBe('')
    expect(result.runs[0]!.triggerId).toBe('trigger_1')
    expect(result.runs[0]!.errorMessage).toContain('Unexpected DB error')
  })

  it('processes remaining triggers after one throws', async () => {
    const t1 = dueTrigger({ id: 'trigger_1' })
    const t2 = dueTrigger({ id: 'trigger_2' })
    let firstClaim = true
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [t1, t2],
        claimRun: async () => {
          if (firstClaim) {
            firstClaim = false
            throw new Error('boom')
          }
          return claimedRun()
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.failed).toBe(1)
    expect(result.sessionCreated).toBe(1)
    expect(result.claimed).toBe(1)
  })

  it('uses trigger.nextDueAt as scheduledFor in the outer error run entry', async () => {
    const trigger = dueTrigger({ nextDueAt: '2026-06-01T12:00:00.000Z' })
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => {
          throw new Error('boom')
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs[0]!.scheduledFor).toBe('2026-06-01T12:00:00.000Z')
  })

  it('converts a non-Error thrown value to a string error message', async () => {
    const trigger = dueTrigger()
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [trigger],
        claimRun: async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'string-error'
        },
      },
    })
    const result = await dispatchDueScheduledTriggers(deps)
    expect(result.runs[0]!.errorMessage).toBe('string-error')
  })
})

describe('[spec: triggers/inactive] dispatchDueScheduledTriggers — no-op when inactive', () => {
  it('does not create sessions when dueTriggers returns empty', async () => {
    let created = false
    const deps = fakeDeps({
      triggerDispatch: {
        dueTriggers: async () => [],
      },
      sessionRuntime: {
        createSession: async () => {
          created = true
          return { ok: true, value: sessionRecord() }
        },
      },
    })
    await dispatchDueScheduledTriggers(deps)
    expect(created).toBe(false)
  })
})
