import type { RunnerChannel } from '@server/usecases/ports'
import type { Env } from '../../env'

const RUNNER_SANDBOX_REQUEST_TIMEOUT_MS = 120_000

// Self-hosted runner session channels live in a Session Durable Object. This
// gateway talks to that DO over its internal fetch protocol and never touches
// control-plane tables, so it is runtime infrastructure rather than the runners
// HTTP resource. The DO instance is resolved per session: a CLI relay session
// routes to its per-runner instance (idFromName(runnerId)), shared across the
// runner's sessions, so a command reaches the live runner channel even after the
// session's own lease ended. `resolveDoName` (injected at composition) owns that
// session→instance mapping; the command always carries its sessionId in the body.
export function createRunnerChannel(env: Env, resolveDoName: (sessionId: string) => Promise<string>): RunnerChannel {
  async function request(sessionId: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const stub = env.SESSION.get(env.SESSION.idFromName(await resolveDoName(sessionId)))
    const response = await stub.fetch('https://session-object/request', {
      method: 'POST',
      body: JSON.stringify({ sessionId, request, timeoutMs: RUNNER_SANDBOX_REQUEST_TIMEOUT_MS }),
    })
    if (!response.ok) {
      throw new Error(`Runner sandbox channel request failed: ${response.status}`)
    }
    const body = (await response.json()) as { ok?: boolean; result?: Record<string, unknown>; error?: string }
    if (body.ok !== true) {
      throw new Error(body.error || 'Runner sandbox channel request failed')
    }
    return body.result ?? {}
  }

  return {
    async isAccepted(sessionId: string): Promise<boolean> {
      const stub = env.SESSION.get(env.SESSION.idFromName(await resolveDoName(sessionId)))
      const response = await stub.fetch('https://session-object/status')
      if (!response.ok) {
        return false
      }
      const body = (await response.json()) as { active?: boolean }
      return body.active === true
    },

    async dispatch(sessionId: string, command: Record<string, unknown>): Promise<boolean> {
      const stub = env.SESSION.get(env.SESSION.idFromName(await resolveDoName(sessionId)))
      // The DO routes the command by sessionId: the per-runner channel multiplexes
      // many sessions, so the target rides in the body alongside the command.
      const response = await stub.fetch('https://session-object/dispatch', {
        method: 'POST',
        body: JSON.stringify({ sessionId, command }),
      })
      return response.status === 202
    },

    async executeSandboxTool(input) {
      const result = await request(input.sessionId, {
        type: 'sandbox.execute',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
        sandboxId: input.sandboxId,
        cwd: input.cwd,
      })
      return {
        toolCallId: String(result.toolCallId ?? input.toolCallId),
        toolName: String(result.toolName ?? input.toolName),
        output:
          result.output && typeof result.output === 'object' && !Array.isArray(result.output)
            ? (result.output as Record<string, unknown>)
            : {},
        error:
          result.error && typeof result.error === 'object' && !Array.isArray(result.error)
            ? (result.error as Record<string, unknown>)
            : null,
        durationMs: typeof result.durationMs === 'number' ? result.durationMs : 0,
      }
    },

    async stopSandbox(sessionId) {
      await request(sessionId, { type: 'sandbox.stop' })
    },

    async readMemoryStoreMemories(input) {
      const result = await request(input.sessionId, {
        type: 'sandbox.readMemoryStores',
        volumes: input.volumes,
        volumeMounts: input.volumeMounts,
      })
      return Array.isArray(result.stores)
        ? (result.stores as Array<{ memoryRef: string; memories: Array<{ path: string; content: string }> }>)
        : []
    },
  }
}
