import { z } from '@hono/zod-openapi'

const JsonObjectSchema = z.record(z.string(), z.unknown())
const StringMapSchema = z.record(z.string(), z.string())

export const RunnerMemorySnapshotSchema = z
  .object({
    path: z.string().openapi({ example: 'notes/plan.md' }),
    content: z.string().openapi({ example: 'Project notes' }),
  })
  .strict()
  .openapi('RunnerMemorySnapshot')

export const RunnerWorkspaceFileSchema = z
  .object({
    path: z.string().openapi({ example: 'notes/plan.md' }),
    content: z.string().openapi({ example: 'Project notes' }),
  })
  .strict()
  .openapi('RunnerWorkspaceFile')

export const RunnerGitCredentialSchema = z
  .object({
    username: z.string().openapi({ example: 'x-access-token' }),
    password: z.string().openapi({ example: 'secret-value' }),
  })
  .strict()
  .openapi('RunnerGitCredential')

export const RunnerWorkspaceMountSchema = z
  .object({
    name: z.string().openapi({ example: 'source' }),
    type: z.enum(['git_repository', 'memory', 'secret']).openapi({ example: 'git_repository' }),
    mountPath: z.string().openapi({ example: '/workspace/repos/saltbo/any-managed-agents' }),
    url: z.string().optional().openapi({ example: 'https://github.com/saltbo/any-managed-agents.git' }),
    ref: z.string().optional().openapi({ example: 'main' }),
    credential: RunnerGitCredentialSchema.optional(),
    memoryRef: z.string().optional().openapi({ example: 'ama://memories/memstore_abc123' }),
    description: z.string().nullable().optional(),
    access: z.string().optional().openapi({ example: 'read_write' }),
    readOnly: z.boolean().optional(),
    files: z.array(RunnerWorkspaceFileSchema).optional(),
  })
  .strict()
  .openapi('RunnerWorkspaceMount')

export const RunnerWorkspaceManifestSchema = z
  .object({
    root: z.literal('/workspace').openapi({ example: '/workspace' }),
    mounts: z.array(RunnerWorkspaceMountSchema),
  })
  .strict()
  .openapi('RunnerWorkspaceManifest')

export const RunnerVolumeSchema = z
  .object({
    name: z.string().openapi({ example: 'source' }),
    type: z.enum(['secret', 'git_repository', 'memory']).openapi({ example: 'git_repository' }),
    secretRef: z.string().optional(),
    url: z.string().optional().openapi({ example: 'https://github.com/saltbo/any-managed-agents.git' }),
    ref: z.string().optional().openapi({ example: 'main' }),
    memoryRef: z.string().optional().openapi({ example: 'ama://memories/memstore_abc123' }),
    description: z.string().nullable().optional(),
    access: z.string().optional().openapi({ example: 'read_write' }),
    memories: z.array(RunnerMemorySnapshotSchema).optional(),
  })
  .strict()
  .openapi('RunnerVolume')

export const RunnerVolumeMountSchema = z
  .object({
    name: z.string().openapi({ example: 'source' }),
    mountPath: z.string().openapi({ example: '/workspace/repos/saltbo/any-managed-agents' }),
    readOnly: z.boolean().optional(),
  })
  .strict()
  .openapi('RunnerVolumeMount')

export const RunnerToolCallSchema = z
  .object({
    id: z.string().optional().openapi({ example: 'call_abc123' }),
    name: z.string().optional().openapi({ example: 'bash' }),
    arguments: JsonObjectSchema.optional(),
    input: JsonObjectSchema.optional(),
    approved: z.boolean().optional(),
  })
  .strict()
  .openapi('RunnerToolCall')

export const RunnerWorkPayloadSchema = z
  .object({
    protocol: z.literal('ama-runner-work').optional(),
    type: z.string().optional().openapi({ example: 'session.start' }),
    sessionId: z.string().optional().openapi({ example: 'session_abc123' }),
    hostingMode: z.string().optional().openapi({ example: 'self_hosted' }),
    runtime: z.string().optional().openapi({ example: 'codex' }),
    runtimeConfig: JsonObjectSchema.optional(),
    provider: z.string().optional().openapi({ example: 'provider_codex' }),
    model: z.string().optional().openapi({ example: 'gpt-5.3-codex' }),
    agentSnapshot: JsonObjectSchema.optional(),
    environmentSnapshot: JsonObjectSchema.nullable().optional(),
    runtimeDriver: z.string().optional().openapi({ example: 'codex-self-hosted' }),
    requiredRunnerCapability: z.string().nullable().optional(),
    env: StringMapSchema.optional(),
    workspaceManifest: RunnerWorkspaceManifestSchema.optional(),
    initialPrompt: z.string().nullable().optional(),
    resume: z.boolean().optional(),
    resumeToken: z.string().nullable().optional(),
    approved: z.boolean().optional(),
    toolCallId: z.string().optional().openapi({ example: 'call_abc123' }),
    toolName: z.string().optional().openapi({ example: 'bash' }),
    input: JsonObjectSchema.optional(),
    toolCall: RunnerToolCallSchema.optional(),
  })
  .strict()
  .openapi('RunnerWorkPayload')

export const RunnerRuntimeToolCallSchema = z
  .object({
    id: z.string().optional().openapi({ example: 'tool_1' }),
    name: z.string().optional().openapi({ example: 'bash' }),
    input: JsonObjectSchema.optional(),
    arguments: JsonObjectSchema.optional(),
  })
  .strict()
  .openapi('RunnerRuntimeToolCall')

export const RunnerRuntimeRequestSchema = z
  .object({
    toolCalls: z.array(RunnerRuntimeToolCallSchema).optional(),
  })
  .strict()
  .openapi('RunnerRuntimeRequest')

export const RunnerSessionCommandSchema = z
  .object({
    id: z.string().optional().openapi({ example: 'runnercmd_abc123' }),
    type: z.string().openapi({ example: 'send' }),
    path: z.string().optional().openapi({ example: '/rpc' }),
    message: z.string().optional().openapi({ example: 'continue' }),
    reason: z.string().optional().openapi({ example: 'user cancelled' }),
    permissionId: z.string().optional().openapi({ example: 'perm_abc123' }),
    allowed: z.boolean().optional(),
    body: RunnerRuntimeRequestSchema.optional(),
  })
  .strict()
  .openapi('RunnerSessionCommand')

export const RunnerSandboxRequestSchema = z
  .object({
    type: z.string().openapi({ example: 'sandbox.execute' }),
    toolCallId: z.string().optional().openapi({ example: 'call_abc123' }),
    toolName: z.string().optional().openapi({ example: 'bash' }),
    input: JsonObjectSchema.optional(),
    volumes: z.array(RunnerVolumeSchema).optional(),
    volumeMounts: z.array(RunnerVolumeMountSchema).optional(),
  })
  .strict()
  .openapi('RunnerSandboxRequest')

export const RunnerChannelMessageSchema = z
  .object({
    type: z.string().openapi({ example: 'session.command' }),
    eventId: z.string().optional(),
    requestId: z.string().optional(),
    message: z.string().optional(),
    sessionId: z.string().optional().openapi({ example: 'session_abc123' }),
    runnerId: z.string().optional().openapi({ example: 'runner_abc123' }),
    leaseId: z.string().optional().openapi({ example: 'lease_abc123' }),
    workItemId: z.string().optional().openapi({ example: 'work_abc123' }),
    command: RunnerSessionCommandSchema.optional(),
    request: RunnerSandboxRequestSchema.optional(),
  })
  .strict()
  .openapi('RunnerChannelMessage')

export const RUNNER_PROTOCOL_SCHEMAS = {
  RunnerMemorySnapshot: RunnerMemorySnapshotSchema,
  RunnerWorkspaceFile: RunnerWorkspaceFileSchema,
  RunnerGitCredential: RunnerGitCredentialSchema,
  RunnerWorkspaceMount: RunnerWorkspaceMountSchema,
  RunnerWorkspaceManifest: RunnerWorkspaceManifestSchema,
  RunnerVolume: RunnerVolumeSchema,
  RunnerVolumeMount: RunnerVolumeMountSchema,
  RunnerToolCall: RunnerToolCallSchema,
  RunnerWorkPayload: RunnerWorkPayloadSchema,
  RunnerRuntimeToolCall: RunnerRuntimeToolCallSchema,
  RunnerRuntimeRequest: RunnerRuntimeRequestSchema,
  RunnerSessionCommand: RunnerSessionCommandSchema,
  RunnerSandboxRequest: RunnerSandboxRequestSchema,
  RunnerChannelMessage: RunnerChannelMessageSchema,
} as const

export type RunnerWorkPayload = z.infer<typeof RunnerWorkPayloadSchema>
export type RunnerChannelMessage = z.infer<typeof RunnerChannelMessageSchema>
