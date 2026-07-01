import type { AmaSandboxToolName } from './agent-tools'
import type { AmaSandboxToolInputByName, AmaSandboxToolOutputByName } from './tool-contracts'

export type ToolExecutionInput<TName extends AmaSandboxToolName = AmaSandboxToolName> = {
  sessionId: string
  sandboxId: string
  toolCallId: string
  toolName: TName
  input: AmaSandboxToolInputByName[TName]
  cwd?: string
}

export type ToolExecutionResult<TName extends AmaSandboxToolName = AmaSandboxToolName> = {
  toolCallId: string
  toolName: TName
  output: AmaSandboxToolOutputByName[TName]
  error: Record<string, unknown> | null
  durationMs: number
}
