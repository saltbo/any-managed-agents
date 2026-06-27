import { describe, expect, it } from 'vitest'
import { decideRelayPermissionRequest } from './runner-channel-ingest'

describe('[spec: runtime/runner-channel] decideRelayPermissionRequest — relay-only permission decision', () => {
  const scope = {
    organizationId: 'org_1',
    projectId: 'project_1',
    sessionId: 'sess_1',
    runnerId: 'runner_1',
  }

  function fakeSession() {
    return {
      id: 'sess_1',
      projectId: 'project_1',
      agentSnapshot: { providerId: 'workers-ai', model: null },
      environmentSnapshot: null,
    }
  }

  function fakeDeps(sessionExists = true) {
    return {
      sessionOrchestration: {
        channelSession: async () => (sessionExists ? fakeSession() : null),
        channelActiveChannel: async () => null,
        channelActiveLease: async () => null,
        channelWorkItem: async () => null,
        channelSessionState: async () => null,
        touchChannel: async () => {},
        closeChannel: async () => {},
        requeueSessionForRunnerRecovery: async () => {},
        appendCanonicalEvent: async () => 'event_1',
      },
      policy: {
        evaluateSandboxRuntime: async () => ({
          allowed: true,
          category: 'sandbox',
          rule: null,
          message: null,
        }),
        resolveToolPolicy: async () => ({}),
        resolveMcpPolicy: async () => ({}),
        evaluateMcpTool: async () => ({ allowed: true, category: 'mcp', rule: null, message: '' }),
        resolveEffective: async () => ({
          source: { type: 'platform_default', id: 'w' },
          sources: [],
          toolPolicy: {},
          mcpPolicy: {},
          sandboxPolicy: {},
        }),
        evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
        evaluateProviderForSession: async () => ({
          decision: { allowed: true, category: 'provider', rule: null, message: '' },
          override: null,
        }),
        toolPolicyRequiresApproval: async () => false,
        policyBlocksSandboxOperation: async () => null,
      },
    }
  }

  it('returns a session.command permissionDecision reply for a known session', async () => {
    const deps = fakeDeps(true)
    const reply = await decideRelayPermissionRequest(deps as never, scope, {
      permissionId: 'perm_1',
      command: 'bash',
      action: 'exec',
    })
    expect(reply).not.toBeNull()
    expect(reply?.type).toBe('session.command')
    expect(reply?.sessionId).toBe('sess_1')
    expect(reply?.runnerId).toBe('runner_1')
    expect(reply?.command.type).toBe('permissionDecision')
    expect(reply?.command.allowed).toBe(true)
  })

  it('returns null for an unknown session', async () => {
    const deps = fakeDeps(false)
    const reply = await decideRelayPermissionRequest(deps as never, scope, { permissionId: 'perm_1', action: 'exec' })
    expect(reply).toBeNull()
  })

  it('does NOT call appendCanonicalEvent (relay-only, no cloud store)', async () => {
    let appended = false
    const deps = fakeDeps(true)
    ;(deps.sessionOrchestration as Record<string, unknown>).appendCanonicalEvent = async () => {
      appended = true
      return 'event_1'
    }
    await decideRelayPermissionRequest(deps as never, scope, { permissionId: 'perm_1', action: 'exec' })
    expect(appended).toBe(false)
  })

  it('omits leaseId and workItemId in the relay reply (the hub routes by sessionId)', async () => {
    const deps = fakeDeps(true)
    const reply = await decideRelayPermissionRequest(deps as never, scope, { permissionId: 'perm_1', action: 'exec' })
    const replyRecord = reply as Record<string, unknown> | null
    expect(replyRecord?.leaseId).toBeUndefined()
    expect(replyRecord?.workItemId).toBeUndefined()
  })
})
