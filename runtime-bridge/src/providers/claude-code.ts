import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { runtimeError, runtimeEvent, textMessage, toolEnd, toolStart, usageEvent } from '../events/ama'
import { agentSystemPrompt, type AmaRuntimeEvent, type RuntimeProvider, type RuntimeProviderHandle, type RuntimeProviderRequest } from '../protocol'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizeToolInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case 'Read':
      return { ...input, filePath: input.file_path ?? input.filePath }
    case 'Write':
      return { ...input, filePath: input.file_path ?? input.filePath }
    case 'Edit':
      return {
        ...input,
        filePath: input.file_path ?? input.filePath,
        oldString: input.old_string ?? input.oldString,
        newString: input.new_string ?? input.newString,
        replaceAll: input.replace_all ?? input.replaceAll,
      }
    default:
      return input
  }
}

function usageFromResult(msg: Record<string, unknown>) {
  const usage = objectValue(msg.usage)
  return {
    inputTokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
    cachedInputTokens: Number(usage.cache_read_input_tokens ?? usage.cachedInputTokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? usage.totalTokens ?? 0),
    costMicros: typeof msg.total_cost_usd === 'number' ? Math.round(msg.total_cost_usd * 1_000_000) : undefined,
  }
}

function parseClaudeOAuthToken(raw: string): string | undefined {
  try {
    const creds = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } }
    return creds.claudeAiOauth?.accessToken || undefined
  } catch {
    return undefined
  }
}

// Resolve the Claude Code OAuth token from the host login. macOS keeps it in the
// keychain, which the bundled SDK never reads; other platforms use the
// credentials file under the host home. Mirrors how the codex provider reads
// `~/.codex/auth.json`. The session runs with a sandboxed HOME, so the keychain
// lookup must point `security` at the host login keychain via HOME.
function readClaudeOAuthToken(home: string | undefined): string | undefined {
  if (process.platform === 'darwin') {
    try {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: home ? { ...process.env, HOME: home } : process.env,
      }).trim()
      const token = parseClaudeOAuthToken(raw)
      if (token) return token
    } catch {
      // fall through to the credentials file
    }
  }
  if (!home) return undefined
  try {
    return parseClaudeOAuthToken(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function sdkEnv(request: RuntimeProviderRequest) {
  const home =
    typeof request.env.AMA_RUNTIME_BRIDGE_HOST_HOME === 'string' && request.env.AMA_RUNTIME_BRIDGE_HOST_HOME
      ? request.env.AMA_RUNTIME_BRIDGE_HOST_HOME
      : undefined
  const env: Record<string, string> = {
    ...request.env,
    ...(home ? { HOME: home, AMA_RUNTIME_BRIDGE_SESSION_HOME: request.env.HOME } : {}),
  }
  if (!env.CLAUDE_CODE_OAUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
    const token = readClaudeOAuthToken(home)
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
  }
  return env
}

function resolveClaudePath(): string | undefined {
  try {
    return execSync('which claude', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    return undefined
  }
}

function* mapClaudeMessage(msg: SDKMessage): Generator<AmaRuntimeEvent> {
  switch (msg.type) {
    case 'assistant': {
      const anyMsg = msg as unknown as Record<string, unknown>
      if (anyMsg.error) {
        yield runtimeError(String(anyMsg.error), 'claude_error', anyMsg)
        return
      }
      yield runtimeEvent('turn_start')
      for (const block of Array.isArray(msg.message.content) ? msg.message.content : []) {
        if (block.type === 'text' && block.text) {
          yield runtimeEvent('message_end', { message: textMessage('assistant', block.text) })
        }
        if (block.type === 'thinking' && block.thinking) {
          yield runtimeEvent('runtime.output', { stream: 'reasoning', content: block.thinking })
        }
        if (block.type === 'tool_use') {
          const args = normalizeToolInput(block.name, objectValue(block.input))
          yield toolStart(block.id, block.name, args)
        }
      }
      return
    }
    case 'user': {
      const content = msg.message.content
      if (!Array.isArray(content)) return
      for (const block of content) {
        if (block.type === 'tool_result') {
          yield toolEnd(block.tool_use_id, 'tool', {}, block.content, Boolean(block.is_error))
        }
      }
      return
    }
    case 'result': {
      yield usageEvent(usageFromResult(msg as unknown as Record<string, unknown>))
      yield runtimeEvent('turn_end', { message: { role: 'assistant', content: [], timestamp: Date.now() }, toolResults: [] })
      return
    }
    case 'system': {
      yield runtimeEvent('runtime.metadata', { data: msg as unknown as Record<string, unknown> })
      return
    }
    default:
      yield runtimeEvent('runtime.metadata', { data: msg as unknown as Record<string, unknown> })
  }
}

export const claudeCodeProvider: RuntimeProvider = {
  name: 'claude-code',
  execute(request: RuntimeProviderRequest): Promise<RuntimeProviderHandle> {
    const abortController = new AbortController()
    const claudePath = resolveClaudePath()
    const systemPrompt =
      typeof request.runtimeConfig?.systemPromptFile === 'string'
        ? readFileSync(request.runtimeConfig.systemPromptFile, 'utf8')
        : agentSystemPrompt(request)
    // The AMA session id is a UUID, so it doubles as Claude Code's own session id
    // for both fresh runs and resumes — keeping the Claude session 1:1 with AMA.
    let resumeToken = request.resumeToken ?? request.sessionId
    const options = {
      ...(request.resume ? { resume: request.resumeToken ?? request.sessionId } : { sessionId: request.sessionId }),
      cwd: request.cwd,
      env: sdkEnv(request),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(request.model ? { model: request.model } : {}),
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      abortController,
      includePartialMessages: true,
    }
    const q = query({
      prompt: request.prompt,
      options,
    })
    const events = (async function* () {
      for await (const msg of q) {
        const sessionId = (msg as unknown as { session_id?: unknown }).session_id
        if (typeof sessionId === 'string' && sessionId) resumeToken = sessionId
        yield* mapClaudeMessage(msg)
        if (msg.type === 'result') break
      }
      q.close()
    })()
    return Promise.resolve({
      events,
      async abort() {
        abortController.abort()
        q.close()
      },
      async send(message: string) {
        const input = async function* () {
          yield { type: 'user' as const, message: { role: 'user' as const, content: message }, parent_tool_use_id: null }
        }
        await q.streamInput(input())
      },
      getResumeToken() {
        return resumeToken
      },
    })
  },
}
