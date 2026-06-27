export type SandboxToolName = 'sandbox.exec' | 'sandbox.read' | 'sandbox.write' | 'sandbox.fetch'

export type ToolExecutionInput = {
  sessionId: string
  sandboxId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  cwd?: string
}

export type ToolExecutionResult = {
  toolCallId: string
  toolName: string
  output: Record<string, unknown>
  error: Record<string, unknown> | null
  durationMs: number
}
