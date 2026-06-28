import { describe, expect, it, vi } from 'vitest'
import type { AuthScope, SessionRow, WorkItemInsert } from '../ports'
import { dispatchSessionPrompt, type PromptDeps } from './session-prompt'

const auth: AuthScope = {
  user: { id: 'user_1' },
  organization: { id: 'org_1', name: 'org_1' },
  project: { id: 'proj_1', name: 'proj_1' },
  roles: ['system'],
  permissions: ['*'],
}

function selfHostedSession(overrides: Partial<SessionRow> = {}): SessionRow {
  const timestamp = '2026-06-26T17:00:00.000Z'
  return {
    id: 'sess_1',
    agentId: 'agent_1',
    organizationId: auth.organization.id,
    createdByUserId: auth.user.id,
    agentVersionId: 'agentver_1',
    agentSnapshot: JSON.stringify({
      id: 'agentver_1',
      agentId: 'agent_1',
      projectId: auth.project.id,
      version: 1,
      instructions: null,
      providerId: 'openai',
      model: 'gpt-5',
      skills: [],
      subagents: [],
      role: null,
      capabilityTags: [],
      handoffPolicy: {},
      memoryPolicy: {},
      tools: [],
      mcpConnectors: [],
      metadata: {},
      createdAt: timestamp,
    }),
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: JSON.stringify({ id: 'envver_1', hostingMode: 'self_hosted', runtimeConfig: {} }),
    title: 'Self-hosted prompt',
    env: '{}',
    envFrom: '[]',
    volumes: '[]',
    volumeMounts: '[]',
    projectId: auth.project.id,
    durableObjectName: 'sess_1',
    sandboxId: null,
    piRuntimeId: null,
    piProcessId: null,
    runtimeEndpointPath: '/api/v1/runtime/sessions/sess_1/rpc',
    modelProvider: 'openai',
    modelConfig: null,
    state: 'running',
    stateReason: null,
    activeTurnId: null,
    turnLeaseExpiresAt: null,
    continuationDepth: 0,
    metadata: JSON.stringify({ runtime: 'codex' }),
    startedAt: timestamp,
    stoppedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function depsFor(session: SessionRow, queueResult = true) {
  const queueSessionWorkWhenState = vi.fn<
    (
      projectId: string,
      sessionId: string,
      expected: string | string[],
      fields: Record<string, unknown>,
      workItem: WorkItemInsert,
    ) => Promise<boolean>
  >(async () => queueResult)
  const deps = {
    sessionOrchestration: {
      findSession: async () => session,
      recentSessionWorkItems: async () => [
        {
          state: 'succeeded',
          payload: JSON.stringify({ resumeToken: 'payload-token' }),
          result: JSON.stringify({ resumeToken: 'result-token' }),
        },
      ],
      queueSessionWorkWhenState,
    },
    runnerChannel: {
      isAccepted: async () => false,
      dispatch: async () => false,
    },
    audit: { record: vi.fn() },
  } as unknown as PromptDeps
  return { deps, queueSessionWorkWhenState }
}

describe('dispatchSessionPrompt [spec: sessions/prompt]', () => {
  it('queues self-hosted prompts with the session pending transition and work item in one store call', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession())

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'resume after review rejection')

    expect(result).toEqual({ ok: true, delivery: 'queued', state: 'accepted' })
    expect(queueSessionWorkWhenState).toHaveBeenCalledTimes(1)
    const [projectId, sessionId, expected, fields, workItem] = queueSessionWorkWhenState.mock.calls[0]!
    expect(projectId).toBe(auth.project.id)
    expect(sessionId).toBe('sess_1')
    expect(expected).toEqual(['idle', 'running'])
    expect(fields).toMatchObject({ state: 'pending', stateReason: 'waiting-for-runner' })
    expect(workItem).toMatchObject({
      organizationId: auth.organization.id,
      projectId: auth.project.id,
      sessionId: 'sess_1',
      environmentId: 'env_1',
      type: 'session.start',
      state: 'available',
    })
    expect(JSON.parse(workItem.payload)).toMatchObject({
      type: 'session.start',
      sessionId: 'sess_1',
      runtime: 'codex',
      initialPrompt: 'resume after review rejection',
      resume: true,
      resumeToken: 'result-token',
    })
  })

  it('does not accept the prompt when the atomic self-hosted queue transition loses the state race', async () => {
    const { deps, queueSessionWorkWhenState } = depsFor(selfHostedSession(), false)

    const result = await dispatchSessionPrompt(deps, auth, 'sess_1', 'resume after review rejection')

    expect(result).toEqual({ ok: false, status: 409, message: 'Session runtime is no longer active' })
    expect(queueSessionWorkWhenState).toHaveBeenCalledTimes(1)
  })
})
