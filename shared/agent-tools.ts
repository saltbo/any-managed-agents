export const PI_CODING_AGENT_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export const AMA_SANDBOX_TOOL_NAMES = [...PI_CODING_AGENT_TOOL_NAMES, 'fetch', 'web_search'] as const

export const AMA_ORCHESTRATION_TOOL_NAMES = ['agent'] as const

export const AMA_RUNTIME_TOOL_NAMES = [...AMA_SANDBOX_TOOL_NAMES, ...AMA_ORCHESTRATION_TOOL_NAMES] as const

export type AmaSandboxToolName = (typeof AMA_SANDBOX_TOOL_NAMES)[number]
export type AmaOrchestrationToolName = (typeof AMA_ORCHESTRATION_TOOL_NAMES)[number]
export type AmaRuntimeToolName = AmaSandboxToolName | AmaOrchestrationToolName

export function isAmaSandboxToolName(value: string): value is AmaSandboxToolName {
  return (AMA_SANDBOX_TOOL_NAMES as readonly string[]).includes(value)
}

export function isAmaRuntimeToolName(value: string): value is AmaRuntimeToolName {
  return (AMA_RUNTIME_TOOL_NAMES as readonly string[]).includes(value)
}

// Reference vocabularies from the external agent runtimes AMA bridges today.
// These are not all implemented by AMA's first-party runtime; they document
// provider-native names so adapters can translate intentionally.
export const CLAUDE_CODE_BUILTIN_TOOL_NAMES = [
  'Agent',
  'Bash',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'ListMcpResources',
  'NotebookEdit',
  'Read',
  'ReadMcpResource',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
] as const

export const CODEX_RUNTIME_TOOL_EVENTS = ['command_execution', 'mcp_tool_call', 'web_search'] as const

export const COPILOT_PERMISSION_TOOL_KINDS = [
  'shell',
  'write',
  'read',
  'mcp',
  'url',
  'custom-tool',
  'memory',
  'hook',
] as const

export const MCP_AGENT_TOOL_PREFIX = 'mcp__'

export function agentToolNameForMcp(connectorId: string, toolName: string) {
  return `${MCP_AGENT_TOOL_PREFIX}${toolNamePart(connectorId)}__${toolNamePart(toolName)}`
}

export function mcpConnectorToolWildcard(connectorId: string) {
  return `${MCP_AGENT_TOOL_PREFIX}${toolNamePart(connectorId)}__*`
}

export function isMcpAgentToolName(value: string) {
  return new RegExp(`^${MCP_AGENT_TOOL_PREFIX}[A-Za-z0-9_-]+__[A-Za-z0-9_*.-]+$`).test(value)
}

function toolNamePart(value: string) {
  return value
    .trim()
    .replaceAll(/[^A-Za-z0-9_-]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}
