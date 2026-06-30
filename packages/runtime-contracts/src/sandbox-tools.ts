import type { AmaSandboxToolName } from './agent-tools'

export type ToolExecutionInput = {
  sessionId: string
  sandboxId: string
  toolCallId: string
  toolName: AmaSandboxToolName
  input: Record<string, unknown>
  cwd?: string
}

export type ToolExecutionResult = {
  toolCallId: string
  toolName: AmaSandboxToolName
  output: Record<string, unknown>
  error: Record<string, unknown> | null
  durationMs: number
}
